import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { DomainError } from '../../shared/domain/DomainError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ItemCopyRecordStore,
  ItemHistoricalPutPermissionReadInput,
  historicalPutPermissionReadInput,
} from '../domain/transfer-item-copy-record';
import {
  ItemHistoricalPutVersionReader,
  ItemHistoricalPutVersionScope,
  ItemRecipientFinalPutVersionEvidence,
  ItemStagingPutVersionEvidence,
  assertHistoricalPutConservationWindow,
  buildRecipientFinalPutVersionObservation,
  buildStagingPutVersionObservation,
  historicalPutEvidenceTime,
  matchStagingPutVersionEvidence,
  matchRecipientFinalPutVersionEvidence,
  PublishedHistoryPutVersionEvidence,
  PublishedHistoryStagingVersionEvidence,
  buildPublishedHistoryStagingVersionObservation,
  matchPublishedHistoryStagingVersionEvidence,
  buildPublishedHistoryPutVersionObservation,
  matchPublishedHistoryPutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import type { PublishedHistoryPutPermissionInput } from '../domain/published-history-put-permission';
import type { PublishedHistoryStagingPermissionInput } from '../domain/published-history-staging-permission';
import {
  PublishedHistoryStagingPutReconciliationInput,
  PublishedHistoryStagingPutVersionContext,
  PublishedHistoryStagingVersionEvidenceReader,
  publishedHistoryStagingPutReconciliationInput,
  publishedHistoryStagingPutVersionScope,
} from '../domain/published-history-staging-reconciliation';
import {
  PublishedHistoryPutReconciliationInput,
  PublishedHistoryPutVersionContext,
  PublishedHistoryPutVersionEvidenceReader,
  publishedHistoryPutReconciliationInput,
  publishedHistoryPutVersionScope,
} from '../domain/published-history-put-reconciliation';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemStagingPutVersionEvidenceReader,
  ItemRecipientFinalPutVersionEvidenceReader,
  ItemRecipientFinalPutVersionContext,
  ItemStagingPutVersionContext,
  recipientFinalPutVersionScope,
  stagingPutVersionScope,
} from '../domain/transfer-item-staging-put-reconciliation';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

type ItemVersionedPutReconciliationInput =
  ItemHistoricalPutPermissionReadInput &
    Readonly<{
      expectedPermissionHash: string;
      expectedEvidenceHash: string;
      requiredThrough: string;
    }>;

export type ItemStagingPutReconciliationInput =
  ItemVersionedPutReconciliationInput;
export type ItemRecipientFinalPutReconciliationInput =
  ItemVersionedPutReconciliationInput;

type VersionRecord<Evidence, Observation> = Readonly<{
  observation: Observation;
  evidence: Evidence;
}>;
type ReconciliationSelection<Pins> = Readonly<{
  selection: Pins;
  expectedPermissionHash: string;
  expectedEvidenceHash: string;
  requiredThrough: string;
}>;

function itemVersionedPutSelection(raw: ItemVersionedPutReconciliationInput) {
  const {
    expectedPermissionHash,
    expectedEvidenceHash,
    requiredThrough,
    ...pins
  } = raw ?? {};
  return {
    selection: historicalPutPermissionReadInput(pins),
    expectedPermissionHash,
    expectedEvidenceHash,
    requiredThrough,
  };
}

type VersionedReconciliationAccess<
  Context,
  Evidence,
  Observation,
  Input,
  Pins,
> = Readonly<{
  leg: 'staging' | 'final' | 'published history' | 'published history staging';
  parse(raw: Input): ReconciliationSelection<Pins>;
  readContext(input: Pins): Promise<Context | null>;
  scope(context: Context): ItemHistoricalPutVersionScope;
  readEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedHash: string,
  ): Promise<Evidence>;
  observe(
    scope: ItemHistoricalPutVersionScope,
    evidence: Evidence,
    hash: string,
    at: number,
    horizon: string,
  ): Observation;
  record(
    input: Pins,
    version: VersionRecord<Evidence, Observation>,
  ): Promise<VersionRecord<Evidence, Observation>>;
}>;

class VersionedPutReconciler<
  Evidence extends
    | ItemStagingPutVersionEvidence
    | ItemRecipientFinalPutVersionEvidence
    | PublishedHistoryPutVersionEvidence
    | PublishedHistoryStagingVersionEvidence,
  Observation extends Readonly<{
    evidenceHash: string;
    requiredThrough: string;
  }>,
  Context extends Readonly<{
    permission: Readonly<{ permissionHash: string; admittedAt: string }>;
    versionRecord?: VersionRecord<Evidence, Observation>;
  }>,
  Input = ItemVersionedPutReconciliationInput,
  Pins = ItemHistoricalPutPermissionReadInput,
> {
  constructor(
    private readonly access: VersionedReconciliationAccess<
      Context,
      Evidence,
      Observation,
      Input,
      Pins
    >,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcileAndRecord(raw: Input) {
    const invalid = () =>
      new ConflictError(
        `The ${this.access.leg} PUT version could not be reconciled under the exact permission`,
      );
    const {
      expectedPermissionHash,
      expectedEvidenceHash,
      requiredThrough,
      selection: input,
    } = this.access.parse(raw);
    if (
      !sourceHashValid(expectedPermissionHash) ||
      !sourceHashValid(expectedEvidenceHash)
    )
      throw invalid();
    const horizon = historicalPutEvidenceTime(requiredThrough);
    const context = await this.access.readContext(input);
    if (
      !context ||
      context.permission.permissionHash !== expectedPermissionHash
    )
      throw invalid();
    if (context.versionRecord) {
      const { observation } = context.versionRecord;
      if (
        observation.evidenceHash !== expectedEvidenceHash ||
        observation.requiredThrough !== requiredThrough
      )
        throw new ConflictError(
          `The original ${this.access.leg} PUT version observation cannot be replaced`,
        );
      return context.versionRecord;
    }

    const scope = this.access.scope(context);
    const evidence = await this.access.readEvidence(
      scope,
      expectedEvidenceHash,
    );
    const startedAt = this.now().getTime();
    if (startedAt < historicalPutEvidenceTime(context.permission.admittedAt))
      throw invalid();
    assertHistoricalPutConservationWindow(evidence, horizon, startedAt);
    try {
      const read = await this.versions.readVersion(
        scope.target,
        evidence.revision,
      );
      await verifyHistoricalObjectBytes(
        read,
        evidence.revision,
        scope.sha256,
        invalid,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        `The exact ${this.access.leg} PUT version could not be read`,
      );
    }
    const current = await this.access.readContext(input);
    if (
      !current ||
      archiveHash(this.access.scope(current)) !== evidence.scopeHash
    )
      throw invalid();
    return this.access.record(input, {
      observation: this.access.observe(
        scope,
        evidence,
        expectedEvidenceHash,
        this.now().getTime(),
        requiredThrough,
      ),
      evidence,
    });
  }
}

export class ItemStagingPutReconciler extends VersionedPutReconciler<
  ItemStagingPutVersionEvidence,
  ReturnType<typeof buildStagingPutVersionObservation>,
  ItemStagingPutVersionContext
> {
  constructor(
    store: Pick<
      ItemCopyRecordStore,
      'readStagingPutReconciliationContext' | 'recordStagingPutVersion'
    >,
    evidenceReader: ItemStagingPutVersionEvidenceReader,
    versions: ItemHistoricalPutVersionReader,
    now?: () => Date,
  ) {
    super(
      {
        leg: 'staging',
        parse: itemVersionedPutSelection,
        readContext: (input) =>
          store.readStagingPutReconciliationContext(input),
        scope: stagingPutVersionScope,
        readEvidence: async (scope, hash) =>
          matchStagingPutVersionEvidence(
            scope,
            await evidenceReader.readStagingVersionEvidence(scope, hash),
            hash,
          ),
        observe: buildStagingPutVersionObservation,
        record: (input, version) =>
          store.recordStagingPutVersion(input, version),
      },
      versions,
      now,
    );
  }
}

export class ItemRecipientFinalPutReconciler extends VersionedPutReconciler<
  ItemRecipientFinalPutVersionEvidence,
  ReturnType<typeof buildRecipientFinalPutVersionObservation>,
  ItemRecipientFinalPutVersionContext
> {
  constructor(
    store: Pick<
      ItemCopyRecordStore,
      | 'readRecipientFinalPutReconciliationContext'
      | 'recordRecipientFinalPutVersion'
    >,
    evidenceReader: ItemRecipientFinalPutVersionEvidenceReader,
    versions: ItemHistoricalPutVersionReader,
    now?: () => Date,
  ) {
    super(
      {
        leg: 'final',
        parse: itemVersionedPutSelection,
        readContext: (input) =>
          store.readRecipientFinalPutReconciliationContext(input),
        scope: recipientFinalPutVersionScope,
        readEvidence: async (scope, hash) =>
          matchRecipientFinalPutVersionEvidence(
            scope,
            await evidenceReader.readRecipientFinalVersionEvidence(scope, hash),
            hash,
          ),
        observe: buildRecipientFinalPutVersionObservation,
        record: (input, version) =>
          store.recordRecipientFinalPutVersion(input, version),
      },
      versions,
      now,
    );
  }
}

export class PublishedHistoryPutReconciler extends VersionedPutReconciler<
  PublishedHistoryPutVersionEvidence,
  ReturnType<typeof buildPublishedHistoryPutVersionObservation>,
  PublishedHistoryPutVersionContext,
  PublishedHistoryPutReconciliationInput,
  PublishedHistoryPutPermissionInput
> {
  constructor(
    store: Required<
      Pick<
        OwnershipArchiveHistoryRepository,
        'readPublishedCopyVersionContext' | 'recordPublishedCopyVersion'
      >
    >,
    evidenceReader: PublishedHistoryPutVersionEvidenceReader,
    versions: ItemHistoricalPutVersionReader,
    now?: () => Date,
  ) {
    super(
      {
        leg: 'published history',
        parse: publishedHistoryPutReconciliationInput,
        readContext: (input) => store.readPublishedCopyVersionContext(input),
        scope: publishedHistoryPutVersionScope,
        readEvidence: async (scope, hash) =>
          matchPublishedHistoryPutVersionEvidence(
            scope,
            await evidenceReader.readVersionEvidence(scope, hash),
            hash,
          ),
        observe: buildPublishedHistoryPutVersionObservation,
        record: (input, version) =>
          store.recordPublishedCopyVersion(input, version),
      },
      versions,
      now,
    );
  }
}

export class PublishedHistoryStagingPutReconciler extends VersionedPutReconciler<
  PublishedHistoryStagingVersionEvidence,
  ReturnType<typeof buildPublishedHistoryStagingVersionObservation>,
  PublishedHistoryStagingPutVersionContext,
  PublishedHistoryStagingPutReconciliationInput,
  PublishedHistoryStagingPermissionInput
> {
  constructor(
    store: Required<
      Pick<
        OwnershipArchiveHistoryRepository,
        'readPublishedStagingVersionContext' | 'recordPublishedStagingVersion'
      >
    >,
    evidenceReader: PublishedHistoryStagingVersionEvidenceReader,
    versions: ItemHistoricalPutVersionReader,
    now?: () => Date,
  ) {
    super(
      {
        leg: 'published history staging',
        parse: publishedHistoryStagingPutReconciliationInput,
        readContext: (input) => store.readPublishedStagingVersionContext(input),
        scope: publishedHistoryStagingPutVersionScope,
        readEvidence: async (scope, hash) =>
          matchPublishedHistoryStagingVersionEvidence(
            scope,
            await evidenceReader.readVersionEvidence(scope, hash),
            hash,
          ),
        observe: buildPublishedHistoryStagingVersionObservation,
        record: (input, version) =>
          store.recordPublishedStagingVersion(input, version),
      },
      versions,
      now,
    );
  }
}
