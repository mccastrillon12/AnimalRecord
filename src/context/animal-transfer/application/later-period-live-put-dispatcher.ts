import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { DomainError } from '../../shared/domain/DomainError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import {
  assertLaterPeriodLivePutWindow,
  buildLaterPeriodLivePutArtifact,
  buildLaterPeriodLivePutPermission,
  captureLaterPeriodLivePutArtifact,
  laterPeriodLivePutKey,
  laterPeriodLivePutPermissionSelection,
  LaterPeriodLivePutHeldEvidence,
  LaterPeriodLivePutKey,
  LaterPeriodLivePutPermission,
  LaterPeriodLivePutPermissionSelection,
  LaterPeriodLivePutRecord,
} from '../domain/later-period-live-put';
import { archiveHash } from '../domain/ownership-archive';
import {
  itemCaptureInput,
  ItemCaptureInput,
} from '../domain/transfer-item-capture';
import type { ItemHistoricalPutVersionReader } from '../domain/transfer-item-historical-put-reconciliation';
import type { ItemPutTransport } from '../domain/transfer-item-historical-put-transport';
import type {
  ItemSourceArtifactDraft,
  ItemSourceArtifactReader,
} from '../domain/transfer-item-source-artifact';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';
import { prepareItemPutTransport } from './item-put-transport';

type Seal = ReturnType<typeof buildLaterPeriodLivePutArtifact>;
type Store = Readonly<{
  observe(
    item: ItemCaptureInput,
    selection: LaterPeriodLivePutKey,
  ): Promise<LaterPeriodLivePutRecord | null>;
  permit(
    item: ItemCaptureInput,
    selection: LaterPeriodLivePutPermissionSelection,
    held: () => LaterPeriodLivePutHeldEvidence | null,
  ): Promise<
    Readonly<{ recorded: boolean; permission: LaterPeriodLivePutPermission }>
  >;
}>;
type AttemptSelection = LaterPeriodLivePutKey &
  Pick<
    LaterPeriodLivePutPermissionSelection,
    'expectedAttemptHash' | 'expectedProtectionHash'
  >;
const invalid = () =>
  new ConflictError(
    'The later-period live PUT does not match its declaration and custody',
  );

/** Explicit composition with a private custodian and one-shot transport. */
export class LaterPeriodLivePutDispatcher {
  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: Store,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly transport: ItemPutTransport,
    private readonly now: () => Date,
  ) {}

  async prepare(
    rawItem: ItemCaptureInput,
    raw: AttemptSelection,
    draft: ItemSourceArtifactDraft<Seal>,
  ) {
    let sealing = false;
    try {
      const { item, pins } = this.selection(rawItem, raw);
      const declaration = await this.readDeclaration(item, pins);
      const {
        bucket,
        key,
        expectedBucketOwner,
        versionId,
        ifMatch,
        contentLength,
        sha256,
      } = declaration.attempt.read;
      const target = { bucket, key, expectedBucketOwner };
      const revision = { versionId, etag: ifMatch, size: contentLength };
      try {
        await verifyHistoricalObjectBytes(
          await this.versions.readVersion(target, revision),
          revision,
          sha256,
          invalid,
          (bytes) => draft.write(bytes),
        );
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new ExternalServiceError(
          'The sealed live PUT source could not be read',
        );
      }
      await this.readDeclaration(item, pins);
      const seal = buildLaterPeriodLivePutArtifact(declaration, draft.identity);
      sealing = true;
      await draft.seal(seal);
      await this.readDeclaration(item, pins);
      return seal;
    } catch (error) {
      if (!sealing) await draft.discard().catch(() => undefined);
      throw error;
    }
  }

  async dispatch(
    rawItem: ItemCaptureInput,
    raw: AttemptSelection,
    rawSeal: Seal,
    custody: ItemSourceArtifactReader<Seal>,
  ) {
    const { item, pins } = this.selection(rawItem, raw);
    const seal = captureLaterPeriodLivePutArtifact(rawSeal);
    const declaration = await this.readDeclaration(item, pins);
    if (
      archiveHash(buildLaterPeriodLivePutArtifact(declaration, seal)) !==
      archiveHash(seal)
    )
      throw invalid();
    const opened = await custody.open({
      id: seal.id,
      generation: seal.generation,
    });
    if (!opened) throw invalid();
    try {
      if (archiveHash(opened.seal) !== archiveHash(seal)) throw invalid();
      const { delegate, transportRequestHash } = await prepareItemPutTransport(
        this.transport,
        declaration.attempt.request,
        invalid,
      );
      const selection = laterPeriodLivePutPermissionSelection({
        ...pins,
        expectedArtifactHash: seal.artifactHash,
        transportRequestHash,
      });
      const held = Object.freeze({ artifact: seal, transportRequestHash });
      let holding = true;
      let receipt: Awaited<ReturnType<Store['permit']>>;
      try {
        receipt = await this.store.permit(item, selection, () =>
          holding ? held : null,
        );
      } finally {
        holding = false;
      }
      const { recorded, permission } = receipt;
      const expected = buildLaterPeriodLivePutPermission(
        selection,
        declaration,
        held,
        permission.admittedAt,
      );
      if (archiveHash(expected) !== archiveHash(permission)) throw invalid();
      if (recorded !== true)
        return {
          permissionHash: permission.permissionHash,
          delegated: false as const,
          remoteEffect: 'UNKNOWN' as const,
        };
      const now = this.now().getTime();
      assertLaterPeriodLivePutWindow(declaration, now);
      if (now < Date.parse(permission.admittedAt)) throw invalid();
      const localReturn = await delegate(opened.body);
      return {
        permissionHash: permission.permissionHash,
        delegated: true as const,
        localReturn,
        remoteEffect: 'UNKNOWN' as const,
      };
    } finally {
      opened.close();
    }
  }

  private selection(rawItem: ItemCaptureInput, raw: AttemptSelection) {
    return {
      item: itemCaptureInput(rawItem),
      pins: Object.freeze({
        ...laterPeriodLivePutKey(raw),
        expectedAttemptHash: raw.expectedAttemptHash,
        expectedProtectionHash: raw.expectedProtectionHash,
      }),
    };
  }

  private async readDeclaration(
    item: ItemCaptureInput,
    pins: AttemptSelection,
  ) {
    const stored = await this.store.observe(item, pins);
    const declaration = stored?.livePut.declaration;
    if (
      !declaration ||
      stored.livePut.permission ||
      declaration.attempt.dispatcherInstanceId !== this.dispatcherInstanceId ||
      declaration.attempt.definitionHash !== pins.expectedAttemptHash ||
      declaration.protection.protectionHash !== pins.expectedProtectionHash
    )
      throw invalid();
    assertLaterPeriodLivePutWindow(declaration, this.now().getTime());
    return declaration;
  }
}
