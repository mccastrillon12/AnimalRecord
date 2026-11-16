import type { S3Client } from '@aws-sdk/client-s3';
import type { KeyObject } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import {
  STABLE_CUT_COVERAGE_GROUPS,
  STABLE_CUT_COMPLETENESS_GROUPS,
  StableCutInventoryEvidenceReader,
  stableCutScopeBinding,
  type CutScope,
  type StableCutOperationalEvidenceSource,
  type StableCutWriterCompleteness,
  type StableCutWriterCompletenessSource,
  type StableCutWriterFindings,
  type StableCutWriterInventory,
} from '../../application/stable-cut-writer-evidence';
import {
  profileIdValid,
  sourceHashValid,
} from '../../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import { createVersionedS3Json } from './create-versioned-s3-json';
import { readVersionedS3Json } from './read-versioned-s3-json';
import { stableCutSignatureValid } from './signed-stable-cut-coverage';

type Configuration = Readonly<{
  evidenceBucket: string;
  evidenceBucketOwner: string;
  maxBytes: number;
}>;

const invalid = () =>
  new ConflictError(
    'The stable-cut operational evidence document is inconsistent',
  );

const inventoryFields = [
  'scopeHash',
  'controlsHash',
  'validFrom',
  'validUntil',
  'groups',
];
const findingsFields = [...inventoryFields, 'writerInventoryHash'];

function exactObject(
  value: unknown,
  names: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.prototype.hasOwnProperty.call(value, name))
  );
}

function evidenceArchiveConfig<Config extends Configuration>(config: Config) {
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.evidenceBucket) ||
    !/^\d{12}$/.test(config.evidenceBucketOwner) ||
    !Number.isSafeInteger(config.maxBytes) ||
    config.maxBytes < 1
  )
    throw new ConflictError(
      'The stable-cut operational evidence source is not configured',
    );
  return Object.freeze({ ...config });
}

function evidenceLocation(
  config: Configuration,
  scopeHash: string,
  controlsHash: string,
  writerInventoryHash?: string,
) {
  const prefix = `stable-cut-operational-evidence/v1/${scopeHash}/${controlsHash}`;
  return {
    Bucket: config.evidenceBucket,
    ExpectedBucketOwner: config.evidenceBucketOwner,
    Key: writerInventoryHash
      ? `${prefix}/findings/${writerInventoryHash}.json`
      : `${prefix}/inventory.json`,
  };
}

export const WRITER_COMPLETENESS_SIGNATURE_PROTOCOL =
  'STABLE_CUT_WRITER_COMPLETENESS_SIGNATURE_V1';

type CompletenessConfiguration = Configuration &
  Readonly<{ issuerId: string; controlsHash: string; publicKey: KeyObject }>;

function completenessGroup(value: unknown) {
  if (!exactObject(value, ['completenessEvidenceHash', 'identityHashes']))
    throw invalid();
  const { completenessEvidenceHash, identityHashes: raw } = value;
  if (!sourceHashValid(completenessEvidenceHash) || !Array.isArray(raw))
    throw invalid();
  const identityHashes = Array.from<unknown>(raw);
  if (
    !identityHashes.every(sourceHashValid) ||
    new Set(identityHashes).size !== identityHashes.length
  )
    throw invalid();
  return Object.freeze({
    completenessEvidenceHash,
    identityHashes: Object.freeze(identityHashes),
  });
}

/** Reads census attestations signed by an authority independent of the operational collector. */
export class AwsSignedStableCutWriterCompletenessSource implements StableCutWriterCompletenessSource {
  private readonly config: CompletenessConfiguration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: CompletenessConfiguration,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      !profileIdValid(config.issuerId) ||
      !sourceHashValid(config.controlsHash) ||
      config.publicKey?.type !== 'public' ||
      config.publicKey.asymmetricKeyType !== 'ed25519'
    )
      throw new ConflictError(
        'The signed stable-cut writer completeness source is not configured',
      );
    this.config = evidenceArchiveConfig(config);
  }

  async readCompleteness(
    scope: CutScope,
    controlsHash: string,
  ): Promise<StableCutWriterCompleteness | null> {
    const { scopeHash, horizon } = stableCutScopeBinding(scope, invalid);
    if (controlsHash !== this.config.controlsHash) throw invalid();
    const snapshot = await readVersionedS3Json(
      this.client,
      {
        Bucket: this.config.evidenceBucket,
        ExpectedBucketOwner: this.config.evidenceBucketOwner,
        Key: `stable-cut-writer-completeness/v1/${scopeHash}/${controlsHash}.json`,
      },
      this.config.maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read signed stable-cut writer completeness',
      },
    );
    if (!snapshot) return null;
    const envelope = snapshot.value;
    if (!exactObject(envelope, ['protocol', 'report', 'signature']))
      throw invalid();
    const { protocol, report, signature } = envelope;
    if (
      protocol !== WRITER_COMPLETENESS_SIGNATURE_PROTOCOL ||
      !exactObject(report, [...inventoryFields, 'issuerId']) ||
      report.issuerId !== this.config.issuerId ||
      report.scopeHash !== scopeHash ||
      report.controlsHash !== controlsHash
    )
      throw invalid();
    const { groups, validFrom, validUntil } = report;
    if (
      !exactObject(groups, STABLE_CUT_COMPLETENESS_GROUPS) ||
      typeof validFrom !== 'string' ||
      typeof validUntil !== 'string'
    )
      throw invalid();
    const checkedAt = this.now().getTime();
    if (
      !Number.isSafeInteger(checkedAt) ||
      historicalPutEvidenceTime(validFrom) > checkedAt ||
      checkedAt > horizon ||
      historicalPutEvidenceTime(validUntil) <= horizon
    )
      throw invalid();
    const verifiedGroups = Object.freeze({
      applicationDeployments: completenessGroup(groups.applicationDeployments),
      priorCapabilities: completenessGroup(groups.priorCapabilities),
    });
    if (
      !stableCutSignatureValid(
        protocol,
        report,
        signature,
        this.config.publicKey,
      )
    )
      throw invalid();
    return Object.freeze({
      scopeHash,
      controlsHash,
      validFrom,
      validUntil,
      groups: verifiedGroups,
    });
  }
}

/** Read-only access to the versioned bucket written by the independent collector. */
export class AwsStableCutOperationalEvidenceSource implements StableCutOperationalEvidenceSource {
  private readonly config: Configuration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
  ) {
    this.config = evidenceArchiveConfig(config);
  }

  async readInventory(scope: CutScope, controlsHash: string) {
    const document = await this.readDocument(scope, controlsHash);
    if (!document) return null;
    const { groups } = document;
    for (const group of STABLE_CUT_COVERAGE_GROUPS) {
      const entry = groups[group];
      if (
        !exactObject(entry, ['completenessEvidenceHash', 'identityHashes']) ||
        !sourceHashValid(entry.completenessEvidenceHash) ||
        !Array.isArray(entry.identityHashes) ||
        !entry.identityHashes.every(sourceHashValid)
      )
        throw invalid();
    }
    return {
      ...document,
      groups: groups as StableCutWriterInventory['groups'],
    };
  }

  async readFindings(
    scope: CutScope,
    controlsHash: string,
    writerInventoryHash: string,
  ) {
    if (!sourceHashValid(writerInventoryHash)) throw invalid();
    const document = await this.readDocument(
      scope,
      controlsHash,
      writerInventoryHash,
    );
    if (!document) return null;
    const { groups } = document;
    for (const group of STABLE_CUT_COVERAGE_GROUPS) {
      const entries = groups[group];
      if (!Array.isArray(entries)) throw invalid();
      for (const entry of entries as readonly unknown[]) {
        if (
          !exactObject(entry, [
            'identityHash',
            'disposition',
            'evidenceHash',
          ]) ||
          !sourceHashValid(entry.identityHash) ||
          !sourceHashValid(entry.evidenceHash) ||
          (entry.disposition !== 'ISOLATED' &&
            entry.disposition !== 'RECONCILED_AND_CONTROLLED')
        )
          throw invalid();
      }
    }
    return {
      ...document,
      writerInventoryHash,
      groups: groups as StableCutWriterFindings['groups'],
    };
  }

  private async readDocument(
    scope: CutScope,
    controlsHash: string,
    writerInventoryHash?: string,
  ) {
    const { scopeHash, initial } = stableCutScopeBinding(scope, invalid);
    if (!sourceHashValid(controlsHash)) throw invalid();
    const snapshot = await readVersionedS3Json(
      this.client,
      evidenceLocation(
        this.config,
        scopeHash,
        controlsHash,
        writerInventoryHash,
      ),
      this.config.maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read the stable-cut operational evidence',
      },
    );
    if (!snapshot) return null;
    const document = snapshot.value;
    const proofField = initial ? 'initialCopyAttempts' : 'laterCopyEvidence';
    const hasCopyProof =
      writerInventoryHash === undefined &&
      exactObject(document, [...inventoryFields, proofField]);
    if (
      !exactObject(
        document,
        writerInventoryHash ? findingsFields : inventoryFields,
      ) &&
      !hasCopyProof
    )
      throw invalid();
    const { groups, validFrom, validUntil } = document;
    if (
      document.scopeHash !== scopeHash ||
      document.controlsHash !== controlsHash ||
      document.writerInventoryHash !== writerInventoryHash ||
      !exactObject(groups, STABLE_CUT_COVERAGE_GROUPS) ||
      typeof validFrom !== 'string' ||
      typeof validUntil !== 'string' ||
      historicalPutEvidenceTime(validFrom) >=
        historicalPutEvidenceTime(validUntil)
    )
      throw invalid();

    return {
      scopeHash,
      controlsHash,
      validFrom,
      validUntil,
      groups,
      ...(hasCopyProof ? { [proofField]: document[proofField] } : {}),
    };
  }
}

/** Archives a complete pair collected from an independent source. */
export class AwsStableCutOperationalEvidenceArchive {
  private readonly config: Configuration;
  private readonly reader: StableCutInventoryEvidenceReader;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
    source: StableCutOperationalEvidenceSource,
    completeness: StableCutWriterCompletenessSource,
  ) {
    this.config = evidenceArchiveConfig(config);
    if (typeof completeness?.readCompleteness !== 'function')
      throw new ConflictError(
        'The independent stable-cut writer completeness source is required',
      );
    this.reader = new StableCutInventoryEvidenceReader(source, completeness);
  }

  async archive(scope: CutScope, controlsHash: string) {
    const verified = await this.reader.readVerifiedEvidence(
      scope,
      controlsHash,
    );
    if (!verified) return null;
    const { inventory, findings } = verified;
    const { writerInventoryHash } = findings;
    const inventoryBody = Buffer.from(JSON.stringify(inventory));
    const findingsBody = Buffer.from(JSON.stringify(findings));
    if (
      Math.max(inventoryBody.length, findingsBody.length) > this.config.maxBytes
    )
      throw invalid();
    const findingsLocation = evidenceLocation(
      this.config,
      inventory.scopeHash,
      controlsHash,
      writerInventoryHash,
    );
    const inventoryLocation = evidenceLocation(
      this.config,
      inventory.scopeHash,
      controlsHash,
    );
    const errors = {
      invalid,
      unavailable:
        'The stable-cut operational evidence archive write was not confirmed',
    };

    // The inventory is the index that lets the issuer discover a complete pair.
    const findingsVersionId = await createVersionedS3Json(
      this.client,
      findingsLocation,
      findingsBody,
      this.config.maxBytes,
      errors,
    );
    const inventoryVersionId = await createVersionedS3Json(
      this.client,
      inventoryLocation,
      inventoryBody,
      this.config.maxBytes,
      errors,
    );
    return Object.freeze({
      writerInventoryHash,
      inventoryVersionId,
      findingsVersionId,
    });
  }
}
