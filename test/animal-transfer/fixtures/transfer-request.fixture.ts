import { ClientSession } from 'mongoose';
import { ServiceUnavailableException } from '@nestjs/common';
import { TransferRequests } from '../../../src/context/animal-transfer/application/transfer-requests';
import {
  CreateTransferRequestInput,
  TransferRequestCollision,
  TransferRequestItem,
  TransferRequestRecord,
  TransferRequestStore,
  TransferRequestTransaction,
} from '../../../src/context/animal-transfer/domain/transfer-request';
import { AnimalTransferReasonCode } from '../../../src/context/catalogs/domain/animal-transfer-reason';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../../src/context/shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../../src/context/shared/domain/errors/ResourceNotFoundError';
import { transferOtpFixture, otpActor, otpOther } from './transfer-otp.fixture';
import { promotionTestId as id } from './media-promotion.fixture';

export function transferRequestFixture(count = 2) {
  const otp = transferOtpFixture();
  let state = {
    profiles: [
      { id: otpActor, name: 'Ana', revision: 0 },
      { id: otpOther, name: 'Luis', revision: 0 },
    ],
    reason: {
      code: AnimalTransferReasonCode.Other,
      name: 'Otro',
      isActive: true,
      revision: 0,
    },
    animals: Array.from({ length: count }, (_, i) => ({
      id: id(100 + i),
      name: `Animal ${i + 1}`,
      code: `AR-${i + 1}`,
      ownerId: otpActor,
      isActive: true as boolean | undefined,
      revision: 0,
    })),
    controls: Array.from({ length: count }, (_, i) => ({
      animalId: id(100 + i),
      ownerId: otpActor,
      ownershipVersion: 2,
      revision: 0,
      activeWrites: ['existing-writer'],
      transferLock: undefined as string | undefined,
    })),
    requests: [] as TransferRequestRecord[],
    items: [] as TransferRequestItem[],
    claims: [] as Array<{ animalId: string; transferId: string }>,
    notices: [] as string[],
    outbox: [] as string[],
    events: [] as string[],
  };
  const fault = { save: false, lostReply: false };
  const sessions: ClientSession[] = [];
  const copy = <T>(v: T): T => structuredClone(v);
  let tail = Promise.resolve();
  const store: TransferRequestStore = {
    // Serialized simulated transactions; not evidence of Mongo concurrency/rollback.
    async transaction<T>(
      work: (tx: TransferRequestTransaction) => Promise<T>,
    ): Promise<T> {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const before = copy(state),
        beforeProof = otp.state();
      const session = { inTransaction: () => true } as ClientSession;
      sessions.push(session);
      let result: T;
      try {
        result = await work({
          session,
          find: (requestId) =>
            Promise.resolve(
              copy(state.requests.find((r) => r._id === requestId) ?? null),
            ),
          items: (transferId, limit, after) =>
            Promise.resolve(
              copy(
                state.items
                  .filter(
                    (i) =>
                      i.transferId === transferId &&
                      (!after || i.animalId > after),
                  )
                  .sort((a, b) => a.animalId.localeCompare(b.animalId))
                  .slice(0, limit),
              ),
            ),
          rejectAll: (request, operationId, at) => {
            const current = state.requests.find((r) => r._id === request._id);
            if (
              !current ||
              current.version !== request.version ||
              current.status !== 'PENDING'
            )
              throw new ConflictError('Decision changed');
            const items = state.items.filter(
              (i) => i.transferId === request._id,
            );
            if (
              items.length !== request.animalCount ||
              new Set(items.map((i) => i.animalId)).size !== items.length ||
              items.some((i) => i.status !== 'PENDING')
            )
              throw new ConflictError('Item set inconsistent');
            if (
              items.some(
                (i) =>
                  !state.claims.some(
                    (c) =>
                      c.animalId === i.animalId && c.transferId === request._id,
                  ),
              ) ||
              state.claims.filter((c) => c.transferId === request._id)
                .length !== items.length
            )
              throw new ConflictError('Claims inconsistent');
            Object.assign(current, {
              status: 'REJECTED',
              version: current.version + 1,
              decidedAt: at,
              decisionOperationId: operationId,
              decisionExpectedVersion: request.version,
            });
            items.forEach((i) => {
              i.status = 'REJECTED';
            });
            state.claims = state.claims.filter(
              (c) => c.transferId !== request._id,
            );
            state.notices.push(
              `rejected-sender:${request._id}`,
              `rejected-recipient:${request._id}`,
            );
            if (fault.save)
              throw new ServiceUnavailableException('Synthetic outbox failure');
            state.outbox.push(...state.notices.slice(-2));
            state.events.push(`rejected:${request._id}`);
            return Promise.resolve(copy(current));
          },
          profile: (userId) => {
            const p = state.profiles.find((p) => p.id === userId);
            if (p) p.revision++;
            return Promise.resolve(p ? { id: p.id, name: p.name } : null);
          },
          reason: (code) => {
            if (!state.reason.isActive || state.reason.code !== code)
              return Promise.resolve(null);
            state.reason.revision++;
            return Promise.resolve({ code, name: state.reason.name });
          },
          animals: (ids, actor) => {
            const selected = ids.map((animalId) => {
              const a = state.animals.find((a) => a.id === animalId);
              if (!a)
                throw new ResourceNotFoundError('Selected animal not found');
              if (a.ownerId !== actor)
                throw new ForbiddenError(
                  'Selected animal does not belong to the sender',
                );
              if (a.isActive === false)
                throw new ConflictError('Only active animals');
              const c = state.controls.find((c) => c.animalId === animalId);
              if (!c || c.ownerId !== actor || c.ownershipVersion < 1)
                throw new ConflictError('Ownership inconsistent');
              a.revision++;
              c.revision++;
              return {
                animalId,
                animalName: a.name,
                animalCode: a.code,
                expectedOwnershipVersion: c.ownershipVersion,
              };
            });
            return Promise.resolve(selected);
          },
          save: (request, items) => {
            if (
              items.some((i) =>
                state.claims.some((c) => c.animalId === i.animalId),
              )
            )
              throw new TransferRequestCollision();
            state.requests.push(copy(request));
            state.items.push(...copy(items));
            state.claims.push(
              ...items.map((i) => ({
                animalId: i.animalId,
                transferId: request._id,
              })),
            );
            state.notices.push(
              `sent:${request._id}`,
              `received:${request._id}`,
            );
            if (fault.save)
              throw new ServiceUnavailableException('Synthetic outbox failure');
            state.outbox.push(...state.notices.slice(-2));
            state.events.push(request._id);
            return Promise.resolve();
          },
        });
      } catch (error) {
        state = before;
        otp.restoreTransactionSnapshot(beforeProof);
        release();
        throw error;
      }
      release();
      if (fault.lostReply) {
        fault.lostReply = false;
        throw new ServiceUnavailableException(
          'Synthetic reply lost after simulated commit',
        );
      }
      return result;
    },
    find: (requestId) =>
      Promise.resolve(
        copy(state.requests.find((r) => r._id === requestId) ?? null),
      ),
    list: (actor, direction, limit, after, status) =>
      Promise.resolve(
        copy(
          state.requests
            .filter(
              (r) =>
                (direction === 'INCOMING' ? r.recipientId : r.senderId) ===
                  actor &&
                (!status || r.status === status) &&
                (!after ||
                  r.createdAt < after.at ||
                  (r.createdAt === after.at && r._id < after.id)),
            )
            .sort(
              (a, b) =>
                b.createdAt.localeCompare(a.createdAt) ||
                b._id.localeCompare(a._id),
            )
            .slice(0, limit),
        ),
      ),
    items: (transferId, limit, after) =>
      Promise.resolve(
        copy(
          state.items
            .filter(
              (i) =>
                i.transferId === transferId && (!after || i.animalId > after),
            )
            .sort((a, b) => a.animalId.localeCompare(b.animalId))
            .slice(0, limit),
        ),
      ),
  };
  const service = new TransferRequests(store, otp.service);
  async function authorized(): Promise<CreateTransferRequestInput> {
    const challenge = await otp.service.issue(otpActor);
    const proof = await otp.service.verify(
      otpActor,
      challenge.challengeId,
      otp.code(),
    );
    return {
      recipientId: otpOther,
      reasonCode: AnimalTransferReasonCode.Other,
      animalIds: state.animals.map((a) => a.id),
      authorization: { challengeId: proof.challengeId, proof: proof.proof },
    };
  }
  return {
    otp,
    store,
    service,
    authorized,
    sessions,
    fault,
    db: () => state,
    snapshot: () => copy(state),
    id,
  };
}
