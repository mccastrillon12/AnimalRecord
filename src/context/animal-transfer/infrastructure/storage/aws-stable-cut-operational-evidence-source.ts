import type { S3Client } from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import {
  STABLE_CUT_COVERAGE_GROUPS,
  stableCutScopeBinding,
  type CutScope,
  type StableCutOperationalEvidenceSource,
  type StableCutWriterFindings,
  type StableCutWriterInventory,
} from '../../application/stable-cut-writer-evidence';
import { sourceHashValid } from '../../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import { readVersionedS3Json } from './read-versioned-s3-json';

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
const initialInventoryFields = [...inventoryFields, 'initialCopyAttempts'];

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

/** Read-only access to the versioned bucket written by the independent collector. */
export class AwsStableCutOperationalEvidenceSource implements StableCutOperationalEvidenceSource {
  private readonly config: Configuration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
  ) {
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.evidenceBucket) ||
      !/^\d{12}$/.test(config.evidenceBucketOwner) ||
      !Number.isSafeInteger(config.maxBytes) ||
      config.maxBytes < 1
    )
      throw new ConflictError(
        'The stable-cut operational evidence source is not configured',
      );
    this.config = Object.freeze({ ...config });
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
    const prefix = `stable-cut-operational-evidence/v1/${scopeHash}/${controlsHash}`;
    const key = writerInventoryHash
      ? `${prefix}/findings/${writerInventoryHash}.json`
      : `${prefix}/inventory.json`;
    const snapshot = await readVersionedS3Json(
      this.client,
      {
        Bucket: this.config.evidenceBucket,
        ExpectedBucketOwner: this.config.evidenceBucketOwner,
        Key: key,
      },
      this.config.maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read the stable-cut operational evidence',
      },
    );
    if (!snapshot) return null;
    const document = snapshot.value;
    const hasInitialCopyAttempts =
      initial &&
      writerInventoryHash === undefined &&
      exactObject(document, initialInventoryFields);
    if (
      !exactObject(
        document,
        writerInventoryHash ? findingsFields : inventoryFields,
      ) &&
      !hasInitialCopyAttempts
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
      ...(hasInitialCopyAttempts
        ? { initialCopyAttempts: document.initialCopyAttempts }
        : {}),
    };
  }
}
