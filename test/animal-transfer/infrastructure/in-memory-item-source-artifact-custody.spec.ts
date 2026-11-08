import { createHash } from 'node:crypto';
import {
  ItemSourceArtifactIdentity,
  OpenItemSourceArtifact,
  buildItemSourceArtifactSeal,
} from '../../../src/context/animal-transfer/domain/transfer-item-source-artifact';
import { InMemoryItemSourceArtifactCustody } from '../../../src/context/animal-transfer/infrastructure/storage/in-memory-item-source-artifact-custody';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';

const limits = {
  maxArtifactBytes: 10,
  maxTotalBytes: 12,
  maxArtifacts: 3,
  maxOpenReaders: 2,
};
const source = Buffer.from('sample');

function receipt(identity: ItemSourceArtifactIdentity, bytes = source) {
  return buildItemSourceArtifactSeal({
    ...identity,
    anchorHash: 'a'.repeat(64),
    selectorHash: 'b'.repeat(64),
    profileDefinitionHash: 'c'.repeat(64),
    profileObservationHash: 'd'.repeat(64),
    expectedBucketOwner: '123456789012',
    observedAt: '2026-11-07T15:00:00.000Z',
    fixedRetainUntil: '2027-01-01T00:00:00.000Z',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

async function sealArtifact(
  custody: InMemoryItemSourceArtifactCustody,
  bytes = source,
) {
  const draft = custody.createDraft(bytes.length);
  const seal = receipt(draft.identity, bytes);
  await draft.write(bytes);
  await draft.seal(seal);
  return { draft, seal };
}

async function read(handle: OpenItemSourceArtifact) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of handle.body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('In-memory source artifact custody', () => {
  it.each([
    { maxArtifactBytes: 0 },
    { maxTotalBytes: 9 },
    { maxArtifacts: 1.5 },
    { maxOpenReaders: Infinity },
  ])('rejects invalid limits %j', (overrides) => {
    expect(
      () => new InMemoryItemSourceArtifactCustody({ ...limits, ...overrides }),
    ).toThrow(InvalidArgumentError);
  });

  it('reserves declared bytes for drafts and reclaims only their own capacity', async () => {
    const custody = new InMemoryItemSourceArtifactCustody(limits);
    expect(() => custody.createDraft(0)).toThrow(InvalidArgumentError);
    expect(() => custody.createDraft(11)).toThrow('capacity exceeded');
    const first = custody.createDraft(6),
      second = custody.createDraft(6);
    expect(() => custody.createDraft(1)).toThrow('capacity exceeded');
    await first.discard();
    await first.discard();
    await expect(first.write(source)).rejects.toThrow('draft is unavailable');
    const replacement = custody.createDraft(6);
    expect(replacement.identity).not.toEqual(first.identity);
    expect(() => custody.createDraft(1)).toThrow('capacity exceeded');
    await second.write(source);
    await second.seal(receipt(second.identity));
    expect(await custody.open(first.identity)).toBeNull();
    expect(await custody.open(replacement.identity)).toBeNull();
    expect(() => custody.createDraft(1)).toThrow('capacity exceeded');
  });

  it('limits entry count and uses a copy of its explicit configuration', async () => {
    const configured = { ...limits, maxArtifacts: 1 };
    const custody = new InMemoryItemSourceArtifactCustody(configured);
    configured.maxArtifacts = 10;
    const draft = custody.createDraft(1);
    expect(() => custody.createDraft(1)).toThrow('capacity exceeded');
    await draft.discard();
    expect(custody.createDraft(1).identity).not.toEqual(draft.identity);
  });

  it('rejects an overrun without appending partial bytes', async () => {
    const custody = new InMemoryItemSourceArtifactCustody(limits);
    const draft = custody.createDraft(source.length);
    await draft.write(source.subarray(0, 3));
    await expect(draft.write(source)).rejects.toThrow(
      'exceeds its reservation',
    );
    await draft.write(source.subarray(3));
    const seal = receipt(draft.identity);
    await draft.seal(seal);
    expect(await read((await custody.open(draft.identity))!)).toEqual(source);
  });

  it.each([
    'short body',
    'different digest',
    'foreign generation',
    'corrupt receipt',
  ] as const)('keeps a draft private on %s', async (kind) => {
    const custody = new InMemoryItemSourceArtifactCustody(limits);
    const draft = custody.createDraft(source.length);
    const expected = receipt(draft.identity);
    await draft.write(kind === 'short body' ? source.subarray(0, 1) : source);
    const seal =
      kind === 'different digest'
        ? receipt(draft.identity, Buffer.alloc(source.length))
        : kind === 'foreign generation'
          ? receipt({ ...draft.identity, generation: 'other' })
          : kind === 'corrupt receipt'
            ? { ...expected, sha256: '0'.repeat(64) }
            : expected;
    await expect(draft.seal(seal)).rejects.toThrow();
    expect(await custody.open(draft.identity)).toBeNull();
    await draft.discard();
    expect(custody.createDraft(limits.maxArtifactBytes).identity).not.toEqual(
      draft.identity,
    );
  });

  it('snapshots input bytes and gives concurrent readers detached chunks of the sealed generation', async () => {
    const custody = new InMemoryItemSourceArtifactCustody(limits);
    const input = Buffer.from(source);
    const draft = custody.createDraft(input.length);
    await draft.write(input);
    input.fill(0);
    const seal = receipt(draft.identity);
    const seals = await Promise.allSettled([
      draft.seal(seal),
      draft.seal(seal),
    ]);
    expect(seals.map(({ status }) => status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(draft.write(source)).rejects.toThrow('draft is unavailable');
    await draft.discard();
    const [first, second] = await Promise.all([
      custody.open(draft.identity),
      custody.open(draft.identity),
    ]);
    expect(first!.seal).toEqual(seal);
    expect(Object.isFrozen(first!.seal)).toBe(true);
    await expect(custody.open(draft.identity)).rejects.toThrow(
      'reader capacity exceeded',
    );
    const it = first!.body[Symbol.asyncIterator]();
    const chunk = await it.next();
    if (chunk.done) throw new Error('Missing first artifact chunk');
    chunk.value.fill(0);
    expect(await read(second!)).toEqual(source);
    first!.close();
    first!.close();
    expect(await read((await custody.open(draft.identity))!)).toEqual(source);
  });

  it('pins readers across release attempts and reclaims capacity after the last close', async () => {
    const custody = new InMemoryItemSourceArtifactCustody(limits);
    const { draft, seal } = await sealArtifact(custody);
    expect(() => draft.releaseSealed('0'.repeat(64))).toThrow(
      'cannot be released',
    );
    const first = (await custody.open(draft.identity))!;
    const second = (await custody.open(draft.identity))!;
    expect(() => draft.releaseSealed(seal.artifactHash)).toThrow(
      'cannot be released',
    );
    first.close();
    first.close();
    expect(() => draft.releaseSealed(seal.artifactHash)).toThrow(
      'cannot be released',
    );
    for await (const chunk of second.body) {
      expect(Buffer.from(chunk)).toEqual(source);
      break;
    }
    expect(draft.releaseSealed(seal.artifactHash)).toBe(true);
    expect(draft.releaseSealed(seal.artifactHash)).toBe(false);
    expect(await custody.open(draft.identity)).toBeNull();
    expect(custody.createDraft(limits.maxArtifactBytes).identity).not.toEqual(
      draft.identity,
    );
  });

  it('bounds emitted chunks and rejects reads after explicit close', async () => {
    const bytes = Buffer.alloc(140_000, 7);
    const custody = new InMemoryItemSourceArtifactCustody({
      ...limits,
      maxArtifactBytes: bytes.length,
      maxTotalBytes: bytes.length,
    });
    const { draft, seal } = await sealArtifact(custody, bytes);
    const handle = (await custody.open(draft.identity))!;
    const iterator = handle.body[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error('Missing first artifact chunk');
    expect(Buffer.from(first.value)).toEqual(bytes.subarray(0, 64 * 1024));
    handle.close();
    expect(draft.releaseSealed(seal.artifactHash)).toBe(true);
    await expect(iterator.next()).rejects.toThrow('reader is closed');
  });

  it('never adopts a generation from another custody instance or a changed identity', async () => {
    const original = new InMemoryItemSourceArtifactCustody(limits);
    const replacement = new InMemoryItemSourceArtifactCustody(limits);
    const left = await sealArtifact(original),
      right = await sealArtifact(replacement);
    expect(right.draft.identity.generation).toBe(
      left.draft.identity.generation,
    );
    expect(right.draft.identity.id).not.toBe(left.draft.identity.id);
    expect(await replacement.open(left.draft.identity)).toBeNull();
    expect(
      await original.open({ ...left.draft.identity, generation: '2' }),
    ).toBeNull();
    expect(await read((await replacement.open(right.draft.identity))!)).toEqual(
      source,
    );
  });
});
