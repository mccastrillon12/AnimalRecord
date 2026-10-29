import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v5 as uuidv5, validate as isUuid } from 'uuid';
import { AnimalTransferReasonCode } from '../../catalogs/domain/animal-transfer-reason';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  CreateTransferRequestInput,
  TransferRequestRecord,
  TransferRequestStore,
  TransferRequestSummary,
  TransferRequestItemResponse,
  TransferRequestCollision,
} from '../domain/transfer-request';
import { TransferOtp } from './transfer-otp';

export const transferRecordId = (
  kind: string,
  transferId: string,
  scope = '',
) =>
  uuidv5(
    `https://animalrecord.app/transfers/${kind}/${transferId}/${scope}`,
    uuidv5.URL,
  );
const invalid = () =>
  new InvalidArgumentError('Invalid transfer request or cursor');
const summary = (r: TransferRequestRecord): TransferRequestSummary => ({
  id: r._id,
  senderId: r.senderId,
  senderName: r.senderName,
  recipientId: r.recipientId,
  recipientName: r.recipientName,
  reasonCode: r.reasonCode,
  reasonName: r.reasonName,
  status: r.status,
  version: r.version,
  createdAt: r.createdAt,
  animalCount: r.animalCount,
});
const encode = (value: Record<string, string>) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(raw: string, scope: string): Record<string, string> {
  try {
    if (
      typeof raw !== 'string' ||
      raw.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(raw)
    )
      throw invalid();
    const value: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.values(value).some((v) => typeof v !== 'string')
    )
      throw invalid();
    const cursor = value as Record<string, string>;
    if (cursor.scope !== scope || encode(cursor) !== raw) throw invalid();
    return cursor;
  } catch {
    throw invalid();
  }
}
@Injectable()
export class TransferRequests {
  constructor(
    @Inject('TransferRequestStore')
    private readonly store: TransferRequestStore,
    private readonly otp: TransferOtp,
  ) {}
  async create(actorId: string, key: string, raw: CreateTransferRequestInput) {
    if (
      !isUuid(actorId) ||
      !isUuid(key) ||
      !raw ||
      Object.keys(raw).sort().join(',') !==
        'animalIds,authorization,reasonCode,recipientId' ||
      !isUuid(raw.recipientId) ||
      raw.recipientId === actorId ||
      !Object.values(AnimalTransferReasonCode).includes(raw.reasonCode) ||
      !Array.isArray(raw.animalIds) ||
      !raw.animalIds.length ||
      raw.animalIds.some((id) => !isUuid(id)) ||
      new Set(raw.animalIds).size !== raw.animalIds.length ||
      !raw.authorization ||
      Object.keys(raw.authorization).sort().join(',') !== 'challengeId,proof' ||
      !isUuid(raw.authorization.challengeId) ||
      typeof raw.authorization.proof !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(raw.authorization.proof)
    )
      throw invalid();
    const input = Object.freeze({
      recipientId: raw.recipientId,
      reasonCode: raw.reasonCode,
      animalIds: Object.freeze([...raw.animalIds].sort()),
      authorization: Object.freeze({ ...raw.authorization }),
    });
    const bodyHash = createHash('sha256')
      .update(
        JSON.stringify({
          recipientId: input.recipientId,
          reasonCode: input.reasonCode,
          animalIds: input.animalIds,
        }),
      )
      .digest('hex');
    const id = transferRecordId('request', actorId, key.toLowerCase());
    return this.store
      .transaction(async (tx) => {
        const previous = await tx.find(id);
        if (previous) {
          if (previous.senderId !== actorId || previous.bodyHash !== bodyHash)
            throw new ConflictError(
              'Idempotency-Key was already used for another transfer request',
            );
          return { request: summary(previous), replayed: true };
        }
        // Invalid business data later must roll back this consumption in the same session.
        await this.otp.consumeAuthorization(
          actorId,
          input.authorization.challengeId,
          input.authorization.proof,
          tx.session,
        );
        const profiles = new Map<string, { id: string; name: string }>();
        for (const profileId of [actorId, input.recipientId].sort()) {
          const profile = await tx.profile(profileId);
          if (!profile)
            throw new ResourceNotFoundError('Transfer participant not found');
          profiles.set(profileId, profile);
        }
        const reason = await tx.reason(input.reasonCode);
        if (!reason)
          throw new InvalidArgumentError(
            'The transfer reason is not available',
          );
        const animals = await tx.animals(input.animalIds, actorId);
        if (
          animals.length !== input.animalIds.length ||
          new Set(animals.map((a) => a.animalId)).size !==
            input.animalIds.length ||
          animals.some(
            (a) =>
              !input.animalIds.includes(a.animalId) ||
              !Number.isSafeInteger(a.expectedOwnershipVersion) ||
              a.expectedOwnershipVersion < 1,
          )
        )
          throw new ConflictError(
            'The selected animal set or ownership version changed',
          );
        const request: TransferRequestRecord = {
          _id: id,
          senderId: actorId,
          senderName: profiles.get(actorId)!.name,
          recipientId: input.recipientId,
          recipientName: profiles.get(input.recipientId)!.name,
          reasonCode: reason.code,
          reasonName: reason.name,
          status: 'PENDING',
          version: 1,
          createdAt: new Date().toISOString(),
          animalCount: animals.length,
          bodyHash,
          authorizationChallengeId: input.authorization.challengeId,
        };
        await tx.save(
          request,
          animals.map((a) => ({
            ...a,
            _id: transferRecordId('item', id, a.animalId),
            transferId: id,
            expectedOwnerId: actorId,
            status: 'PENDING',
          })),
        );
        return { request: summary(request), replayed: false };
      })
      .catch(async (error: unknown) => {
        if (error instanceof TransferRequestCollision) {
          // Only a durable business receipt resolves this known uniqueness race.
          // Unknown commit/network errors are not converted to success here.
          const previous = await this.store.find(id);
          if (previous) {
            if (previous.senderId !== actorId || previous.bodyHash !== bodyHash)
              throw new ConflictError(
                'Idempotency-Key was already used for another transfer request',
              );
            return { request: summary(previous), replayed: true };
          }
        }
        throw error;
      });
  }
  async list(
    actorId: string,
    direction: 'INCOMING' | 'OUTGOING' = 'INCOMING',
    limit = 20,
    cursor?: string,
  ) {
    if (
      !isUuid(actorId) ||
      !['INCOMING', 'OUTGOING'].includes(direction) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw invalid();
    const scope = `${actorId}:${direction}`;
    const after = cursor ? decode(cursor, scope) : undefined;
    if (
      after &&
      (Object.keys(after).sort().join(',') !== 'at,id,scope' ||
        !isUuid(after.id) ||
        !Number.isFinite(Date.parse(after.at)) ||
        new Date(after.at).toISOString() !== after.at)
    )
      throw invalid();
    const rows = await this.store.list(
      actorId,
      direction,
      limit + 1,
      after ? { at: after.at, id: after.id } : undefined,
    );
    const page = rows.slice(0, limit),
      last = page.at(-1);
    return {
      items: page.map(summary),
      ...(rows.length > limit && last
        ? { nextCursor: encode({ scope, at: last.createdAt, id: last._id }) }
        : {}),
    };
  }
  async detail(
    actorId: string,
    transferId: string,
    limit = 20,
    cursor?: string,
  ) {
    if (
      !isUuid(actorId) ||
      !isUuid(transferId) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw invalid();
    const request = await this.store.find(transferId);
    if (!request) throw new ResourceNotFoundError('Transfer request not found');
    if (request.senderId !== actorId && request.recipientId !== actorId)
      throw new ForbiddenError(
        'Only transfer participants can read this request',
      );
    const scope = `${actorId}:${transferId}`,
      after = cursor ? decode(cursor, scope) : undefined;
    if (
      after &&
      (Object.keys(after).sort().join(',') !== 'animalId,scope' ||
        !isUuid(after.animalId))
    )
      throw invalid();
    const rows = await this.store.items(transferId, limit + 1, after?.animalId),
      page = rows.slice(0, limit),
      last = page.at(-1);
    const items: TransferRequestItemResponse[] = page.map((i) => ({
      id: i._id,
      animalId: i.animalId,
      animalName: i.animalName,
      animalCode: i.animalCode,
      status: i.status,
    }));
    return {
      request: summary(request),
      items,
      ...(rows.length > limit && last
        ? { nextCursor: encode({ scope, animalId: last.animalId }) }
        : {}),
    };
  }
}
