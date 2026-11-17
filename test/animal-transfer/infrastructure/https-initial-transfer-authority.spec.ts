import { createHttpsInitialTransferAuthority } from '../../../src/context/animal-transfer/infrastructure/storage/https-initial-transfer-authority';

const config = {
  url: 'https://authority.example.test/transfer',
  token: 'synthetic-token',
  timeoutMs: 500,
  maxBytes: 1000,
};
const input = {
  expectedManifestHash: 'a'.repeat(64),
  expectedSealHash: 'b'.repeat(64),
} as Parameters<
  ReturnType<typeof createHttpsInitialTransferAuthority>['requiredThrough']
>[0];

it('sends the exact operation and scope to the configured authority over HTTPS', async () => {
  const horizon = '2090-01-01T01:00:00.000Z';
  const send = jest.fn().mockResolvedValue(Response.json({ result: horizon }));
  const authority = createHttpsInitialTransferAuthority(config, send);
  await expect(authority.requiredThrough(input)).resolves.toBe(horizon);
  expect(send).toHaveBeenCalledWith(
    config.url,
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer synthetic-token',
      },
      body: JSON.stringify({
        protocol: 'INITIAL_TRANSFER_AUTHORITY_V1',
        operation: 'requiredThrough',
        input: [input],
      }),
    }),
  );
});

it('distinguishes pending evidence from malformed, oversized or unauthorized responses', async () => {
  const send = jest
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ result: {} }))
    .mockResolvedValueOnce(Response.json({ result: 'x'.repeat(1000) }))
    .mockResolvedValueOnce(new Response('private error', { status: 401 }));
  const authority = createHttpsInitialTransferAuthority(config, send);
  await expect(authority.requiredThrough(input)).resolves.toBeNull();
  for (let index = 0; index < 3; index++)
    await expect(authority.requiredThrough(input)).rejects.toThrow(
      'could not be confirmed',
    );
});

it('rejects a plaintext endpoint and URL credentials', () => {
  for (const url of [
    'http://authority.example.test',
    'https://user:pass@authority.example.test',
  ])
    expect(() =>
      createHttpsInitialTransferAuthority({ ...config, url }),
    ).toThrow('not configured');
});
