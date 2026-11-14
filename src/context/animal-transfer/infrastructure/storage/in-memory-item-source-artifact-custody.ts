import { constants as bufferLimits } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../../shared/domain/errors/InvalidArgumentError';
import {
  captureLaterPeriodLivePutArtifact,
  LaterPeriodLivePutArtifactSeal,
} from '../../domain/later-period-live-put';
import {
  ItemArtifactSeal,
  ItemSourceArtifactDraft,
  ItemSourceArtifactIdentity,
  ItemSourceArtifactReader,
  ItemSourceArtifactSeal,
  OpenItemSourceArtifact,
  captureItemSourceArtifactIdentity,
  captureItemSourceArtifactSeal,
} from '../../domain/transfer-item-source-artifact';
import {
  ItemStagingPutArtifactSeal,
  ItemRecipientFinalPutArtifactSeal,
  captureStagingPutArtifactSeal,
  captureRecipientFinalPutArtifactSeal,
  PublishedHistoryPutArtifactSeal,
  capturePublishedHistoryPutArtifactSeal,
  PublishedHistoryStagingPutArtifactSeal,
  capturePublishedHistoryStagingPutArtifactSeal,
} from '../../domain/transfer-item-staging-put-artifact';

type Limits = Readonly<{
  maxArtifactBytes: number;
  maxTotalBytes: number;
  maxArtifacts: number;
  maxOpenReaders: number;
}>;

type Entry<Seal extends ItemArtifactSeal> = {
  identity: ItemSourceArtifactIdentity;
  bytes: Buffer;
  written: number;
  readers: number;
  seal?: Seal;
};

type OwnedDraft<Seal extends ItemArtifactSeal> = ItemSourceArtifactDraft<Seal> &
  Readonly<{
    /** Explicit owner cleanup. The caller must establish that cleanup is authorized. */
    releaseSealed(expectedArtifactHash: string): boolean;
  }>;

const readChunkSize = 64 * 1024;
const positiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0;

/** Explicit, process-local custody. Quotas cover reserved backing bytes and live handles. */
class InMemoryArtifactCustody<
  Seal extends ItemArtifactSeal,
> implements ItemSourceArtifactReader<Seal> {
  readonly #entries = new Map<string, Entry<Seal>>();
  readonly #instanceId = randomUUID();
  readonly #limits: Limits;
  #sequence = 0;
  #reservedBytes = 0;
  #openReaders = 0;

  constructor(
    { maxArtifactBytes, maxTotalBytes, maxArtifacts, maxOpenReaders }: Limits,
    private readonly captureSeal: (raw: Seal) => Seal,
  ) {
    if (
      ![maxArtifactBytes, maxTotalBytes, maxArtifacts, maxOpenReaders].every(
        positiveInteger,
      ) ||
      maxArtifactBytes > maxTotalBytes ||
      maxArtifactBytes > bufferLimits.MAX_LENGTH
    )
      throw new InvalidArgumentError(
        'Invalid in-memory source artifact limits',
      );
    this.#limits = {
      maxArtifactBytes,
      maxTotalBytes,
      maxArtifacts,
      maxOpenReaders,
    };
  }

  createDraft(size: number): OwnedDraft<Seal> {
    if (!positiveInteger(size))
      throw new InvalidArgumentError('Invalid source artifact size');
    const { maxArtifactBytes, maxTotalBytes, maxArtifacts } = this.#limits;
    if (
      size > maxArtifactBytes ||
      size > maxTotalBytes - this.#reservedBytes ||
      this.#entries.size >= maxArtifacts ||
      this.#sequence === Number.MAX_SAFE_INTEGER
    )
      throw new ConflictError('Source artifact custody capacity exceeded');

    const bytes = Buffer.alloc(size);
    const generation = String(++this.#sequence);
    const identity = Object.freeze({
      id: `${this.#instanceId}-${generation}`,
      generation,
    });
    this.#entries.set(generation, { identity, bytes, written: 0, readers: 0 });
    this.#reservedBytes += size;

    return Object.freeze({
      identity,
      write: async (chunk: Uint8Array) =>
        Promise.resolve(this.#write(identity, chunk)),
      seal: async (receipt: Seal) =>
        Promise.resolve(this.#seal(identity, receipt)),
      discard: async () => {
        const entry = this.#entry(identity);
        if (entry && !entry.seal) this.#drop(entry);
        return Promise.resolve();
      },
      releaseSealed: (expectedArtifactHash: string) => {
        const entry = this.#entry(identity);
        if (!entry) return false;
        if (
          !entry.seal ||
          entry.seal.artifactHash !== expectedArtifactHash ||
          entry.readers !== 0
        )
          throw new ConflictError('The source artifact cannot be released');
        this.#drop(entry);
        return true;
      },
    });
  }

  async open(
    raw: ItemSourceArtifactIdentity,
  ): Promise<OpenItemSourceArtifact<Seal> | null> {
    const identity = captureItemSourceArtifactIdentity(raw);
    const entry = this.#entry(identity);
    if (!entry?.seal) return Promise.resolve(null);
    if (this.#openReaders >= this.#limits.maxOpenReaders)
      throw new ConflictError('Source artifact reader capacity exceeded');
    entry.readers++;
    this.#openReaders++;
    return Promise.resolve(this.#handle(identity, entry.seal));
  }

  #entry({ id, generation }: ItemSourceArtifactIdentity) {
    const entry = this.#entries.get(generation);
    return entry?.identity.id === id ? entry : undefined;
  }

  #draft(identity: ItemSourceArtifactIdentity) {
    const entry = this.#entry(identity);
    if (!entry || entry.seal)
      throw new ConflictError('The source artifact draft is unavailable');
    return entry;
  }

  #write(identity: ItemSourceArtifactIdentity, bytes: Uint8Array) {
    const entry = this.#draft(identity);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > entry.bytes.length - entry.written
    )
      throw new ConflictError(
        'The source artifact write exceeds its reservation',
      );
    entry.bytes.set(bytes, entry.written);
    entry.written += bytes.byteLength;
  }

  #seal(identity: ItemSourceArtifactIdentity, raw: Seal) {
    const entry = this.#draft(identity);
    const seal = this.captureSeal(raw);
    if (
      seal.id !== identity.id ||
      seal.generation !== identity.generation ||
      seal.size !== entry.bytes.length ||
      entry.written !== seal.size ||
      createHash('sha256').update(entry.bytes).digest('hex') !== seal.sha256
    )
      throw new ConflictError(
        'The source artifact draft does not match the seal',
      );
    entry.seal = seal;
  }

  #drop(entry: Entry<Seal>) {
    this.#entries.delete(entry.identity.generation);
    this.#reservedBytes -= entry.bytes.length;
  }

  #handle(
    identity: ItemSourceArtifactIdentity,
    seal: Seal,
  ): OpenItemSourceArtifact<Seal> {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.#entry(identity)!.readers--;
      this.#openReaders--;
    };
    const readChunk = (offset: number) => {
      if (closed)
        throw new ConflictError('The source artifact reader is closed');
      const bytes = this.#entry(identity)!.bytes;
      return Uint8Array.from(bytes.subarray(offset, offset + readChunkSize));
    };
    const body = (async function* () {
      try {
        for (let offset = 0; offset < seal.size; offset += readChunkSize)
          yield Promise.resolve(readChunk(offset));
      } finally {
        close();
      }
    })();
    return Object.freeze({ seal, body, close });
  }
}

export class InMemoryItemSourceArtifactCustody extends InMemoryArtifactCustody<ItemSourceArtifactSeal> {
  constructor(limits: Limits) {
    super(limits, captureItemSourceArtifactSeal);
  }
}

export class InMemoryItemStagingPutArtifactCustody extends InMemoryArtifactCustody<ItemStagingPutArtifactSeal> {
  constructor(limits: Limits) {
    super(limits, captureStagingPutArtifactSeal);
  }
}

export class InMemoryItemRecipientFinalPutArtifactCustody extends InMemoryArtifactCustody<ItemRecipientFinalPutArtifactSeal> {
  constructor(limits: Limits) {
    super(limits, captureRecipientFinalPutArtifactSeal);
  }
}

export class InMemoryPublishedHistoryPutArtifactCustody extends InMemoryArtifactCustody<PublishedHistoryPutArtifactSeal> {
  constructor(limits: Limits) {
    super(limits, capturePublishedHistoryPutArtifactSeal);
  }
}

export class InMemoryPublishedHistoryStagingPutArtifactCustody extends InMemoryArtifactCustody<PublishedHistoryStagingPutArtifactSeal> {
  constructor(limits: Limits) {
    super(limits, capturePublishedHistoryStagingPutArtifactSeal);
  }
}

export class InMemoryLaterPeriodLivePutArtifactCustody extends InMemoryArtifactCustody<LaterPeriodLivePutArtifactSeal> {
  constructor(limits: Limits) {
    super(limits, captureLaterPeriodLivePutArtifact);
  }
}
