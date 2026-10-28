import {
  CopyObjectCommand,
  CopyObjectCommandOutput,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  mediaConfirmationContext,
  MediaConfirmationContext,
} from '../domain/media-confirmation-context';
import { promotionId } from '../domain/media-promotion-effect';
import {
  assertPromotionSelection,
  decodePromotionRow,
  MediaPromotionPersistence,
  PromotionEffectRow,
  PromotionGateRow,
  PromotionSelection,
  validatePromotionSelection,
} from '../domain/media-promotion-persistence';

type Stage = 'SETUP' | 'LIFECYCLE' | 'REQUEST' | 'PERMISSION' | 'RESPONSE';
/** Terminal local error: never expose raw persistence errors as retryable S3 errors. */
export class MediaPromotionDispatchError extends Error {
  readonly name = 'MediaPromotionDispatchError';
  constructor(readonly stage: Stage) {
    super(`Media promotion dispatch stopped at ${stage}`);
  }
}
export type PromotionDispatchInput = {
  selection: PromotionSelection;
  scope: MediaConfirmationContext;
  effectId: string;
  dispatcherInstanceId: string;
  regions: readonly string[];
  credentials: NonNullable<S3ClientConfig['credentials']>;
  maxAttempts?: number;
  followRegionRedirects?: boolean;
};

/** Internal, deliberately not registered in Nest or used by existing S3 callers. */
export class MediaPromotionCopyDispatcher {
  private readonly transport = new NodeHttpHandler();
  private readonly client: S3Client;
  private used = false;
  private active = false;
  private busy = false;
  private stopped = false;
  private previous?: { id: string; ordinal: number };

  private constructor(
    private readonly persistence: MediaPromotionPersistence,
    private readonly input: PromotionDispatchInput,
    private readonly effect: PromotionEffectRow,
  ) {
    this.client = new S3Client({
      region: input.regions[0],
      credentials: input.credentials,
      maxAttempts: input.maxAttempts ?? 3,
      retryMode: 'standard',
      defaultsMode: 'standard',
      followRegionRedirects: input.followRegionRedirects ?? false,
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
      useArnRegion: false,
      disableS3ExpressSessionAuth: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: this,
    });
  }

  static async create(
    persistence: MediaPromotionPersistence,
    raw: PromotionDispatchInput,
  ) {
    try {
      const input: PromotionDispatchInput = {
        ...raw,
        selection: validatePromotionSelection(raw.selection),
        scope: mediaConfirmationContext(raw.scope),
        regions: [...raw.regions],
        credentials:
          typeof raw.credentials === 'function'
            ? raw.credentials
            : { ...raw.credentials },
      };
      // UUIDs without trusting caller-provided effect/dispatcher identity strings.
      promotionId(input.effectId);
      promotionId(input.dispatcherInstanceId);
      if (
        !raw.credentials ||
        !input.regions.length ||
        input.regions.some((r) => !/^[a-z]{2}-[a-z]+-\d+$/.test(r)) ||
        (input.maxAttempts !== undefined &&
          (!Number.isSafeInteger(input.maxAttempts) ||
            input.maxAttempts < 1)) ||
        (input.followRegionRedirects !== undefined &&
          typeof input.followRegionRedirects !== 'boolean')
      )
        throw new MediaPromotionDispatchError('SETUP');
      const state = await persistence.read(input.selection, input.effectId);
      const gate = decodePromotionRow(state.gate);
      if (gate.kind !== 'GATE' || gate.data.effectCount < 1)
        throw new MediaPromotionDispatchError('SETUP');
      assertPromotionSelection(gate, input.selection);
      const effect = decodePromotionRow(state.record, gate);
      if (
        effect.kind !== 'EFFECT' ||
        effect.id !== input.effectId ||
        effect.data.attemptCount !== 0 ||
        gate.data.gate.state !== 'OPEN' ||
        JSON.stringify(gate.data.scope) !== JSON.stringify(input.scope)
      )
        throw new MediaPromotionDispatchError('SETUP');
      return new MediaPromotionCopyDispatcher(persistence, input, effect);
    } catch {
      throw new MediaPromotionDispatchError('SETUP');
    }
  }

  async send(): Promise<CopyObjectCommandOutput> {
    if (this.used || this.stopped)
      throw new MediaPromotionDispatchError('LIFECYCLE');
    this.used = true;
    this.active = true;
    const d = this.effect.data.definition;
    const source = [d.bucket, ...d.source.key.split('/')]
      .map(encodeURIComponent)
      .join('/');
    try {
      return await this.client.send(
        new CopyObjectCommand({
          Bucket: d.bucket,
          Key: d.destinationKey,
          CopySource: d.source.versionId
            ? `${source}?versionId=${encodeURIComponent(d.source.versionId)}`
            : source,
          CopySourceIfMatch: d.source.etag,
          IfNoneMatch: '*',
          MetadataDirective: 'REPLACE',
          ContentType: d.mimeType,
          Metadata: {
            'animal-upload-id': d.uploadId,
            'animal-upload-sha256': d.source.sha256,
          },
        }),
      );
    } finally {
      this.active = false;
      this.client.destroy();
    }
  }

  async handle(
    request: HttpRequest,
    options?: Parameters<NodeHttpHandler['handle']>[1],
  ): Promise<{ response: HttpResponse }> {
    if (!this.active || this.stopped || this.busy)
      throw new MediaPromotionDispatchError('LIFECYCLE');
    this.busy = true;
    let copy: HttpRequest;
    let gate: PromotionGateRow;
    const attemptId = randomUUID();
    try {
      try {
        copy = HttpRequest.clone(request);
        this.checkRequest(copy);
        // No mutable headers/query/body shared with SDK middleware or a paused caller.
        copy.headers = Object.freeze({ ...copy.headers });
        copy.query = Object.freeze({ ...copy.query });
        copy.body = undefined;
        Object.freeze(copy);
      } catch {
        this.stopped = true;
        throw new MediaPromotionDispatchError('REQUEST');
      }
      try {
        gate = await this.current();
        if (gate.data.gate.state !== 'OPEN') throw new Error('closed');
        gate = this.ack(
          await this.persistence.apply(
            this.input.selection,
            gate.gateRevision,
            {
              type: 'INTEND_ATTEMPT',
              effectId: this.effect.id,
              attemptId,
              dispatcherInstanceId: this.input.dispatcherInstanceId,
              origin: this.previous ? 'SDK_RETRY' : 'INITIAL',
              ...(this.previous ? { previousAttemptId: this.previous.id } : {}),
            },
          ),
          gate.gateRevision + 1,
        );
        gate = this.ack(
          await this.persistence.apply(
            this.input.selection,
            gate.gateRevision,
            {
              type: 'AUTHORIZE_ATTEMPT',
              effectId: this.effect.id,
              attemptId,
              dispatcherInstanceId: this.input.dispatcherInstanceId,
              authorizationId: randomUUID(),
            },
          ),
          gate.gateRevision + 1,
        );
        if (gate.data.gate.state !== 'OPEN') throw new Error('closed');
        this.previous = {
          id: attemptId,
          ordinal: (this.previous?.ordinal ?? 0) + 1,
        };
      } catch {
        this.stopped = true;
        throw new MediaPromotionDispatchError('PERMISSION');
      }

      let result: { response: HttpResponse } | undefined;
      let transportError: unknown;
      let failed = false;
      try {
        result = await this.transport.handle(copy, options);
      } catch (error) {
        transportError = error;
        failed = true;
      }
      try {
        // Even HTTP 200 may hold an Error. This evidence never discharges a grant.
        gate = await this.current();
        this.ack(
          await this.persistence.apply(
            this.input.selection,
            gate.gateRevision,
            {
              type: 'RECORD_RESPONSE',
              effectId: this.effect.id,
              attemptId,
              responseId: randomUUID(),
              outcome: 'UNKNOWN',
              evidenceRef: `transport:${randomUUID()}`,
            },
          ),
          gate.gateRevision + 1,
        );
      } catch {
        this.stopped = true;
        const body: unknown = result?.response.body;
        if (body instanceof Readable) body.destroy();
        throw new MediaPromotionDispatchError('RESPONSE');
      }
      if (failed) throw transportError;
      return result!;
    } finally {
      this.busy = false;
    }
  }

  private ack(raw: PromotionGateRow, revision?: number): PromotionGateRow {
    const gate = decodePromotionRow(raw);
    if (gate.kind !== 'GATE' || gate.data.effectCount < 1)
      throw new Error('gate');
    assertPromotionSelection(gate, this.input.selection);
    if (
      JSON.stringify(gate.data.scope) !== JSON.stringify(this.input.scope) ||
      (revision !== undefined && gate.gateRevision !== revision)
    )
      throw new Error('scope/revision');
    return gate;
  }
  private async current(): Promise<PromotionGateRow> {
    const state = await this.persistence.read(
      this.input.selection,
      this.effect.id,
    );
    const gate = this.ack(state.gate!);
    const effect = decodePromotionRow(state.record, gate);
    if (
      effect.kind !== 'EFFECT' ||
      effect.id !== this.effect.id ||
      effect.data.definitionHash !== this.effect.data.definitionHash ||
      effect.data.attemptCount !== (this.previous?.ordinal ?? 0) ||
      effect.data.lastAttemptId !== this.previous?.id
    )
      throw new Error('effect advanced');
    return gate;
  }

  private checkRequest(r: HttpRequest): void {
    const d = this.effect.data.definition;
    const hosts = this.input.regions.flatMap((region) => [
      { host: `${d.bucket}.s3.${region}.amazonaws.com`, prefix: '' },
      { host: `s3.${region}.amazonaws.com`, prefix: `/${d.bucket}` },
    ]);
    const endpoint = hosts.find((e) => e.host === r.hostname);
    const path = d.destinationKey
      .split('/')
      .map((s) =>
        encodeURIComponent(s).replace(
          /[!'()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .join('/');
    const source =
      [d.bucket, ...d.source.key.split('/')].map(encodeURIComponent).join('/') +
      (d.source.versionId
        ? `?versionId=${encodeURIComponent(d.source.versionId)}`
        : '');
    const headers: Record<string, string> = {};
    const allowed = new Set([
      'host',
      'authorization',
      'x-amz-date',
      'x-amz-security-token',
      'x-amz-content-sha256',
      'amz-sdk-invocation-id',
      'amz-sdk-request',
      'x-amz-user-agent',
      'user-agent',
      'content-length',
      'content-type',
      'x-amz-copy-source',
      'x-amz-copy-source-if-match',
      'if-none-match',
      'x-amz-metadata-directive',
      'x-amz-meta-animal-upload-id',
      'x-amz-meta-animal-upload-sha256',
    ]);
    for (const [key, value] of Object.entries(r.headers)) {
      const lower = key.toLowerCase();
      if (
        !allowed.has(lower) ||
        headers[lower] !== undefined ||
        typeof value !== 'string'
      )
        throw new Error('header');
      headers[lower] = value;
    }
    if (
      r.method !== 'PUT' ||
      r.protocol !== 'https:' ||
      !endpoint ||
      (r.port !== undefined && r.port !== 443) ||
      r.username ||
      r.password ||
      r.fragment ||
      r.path !== `${endpoint.prefix}/${path}` ||
      Object.entries(r.query).some(
        ([k, v]) => k !== 'x-id' || v !== 'CopyObject',
      ) ||
      (r.body !== undefined &&
        r.body !== '' &&
        !(r.body instanceof Uint8Array && r.body.byteLength === 0)) ||
      headers.host !== r.hostname ||
      (headers['content-length'] !== undefined &&
        headers['content-length'] !== '0') ||
      headers['x-amz-copy-source'] !== source ||
      headers['x-amz-copy-source-if-match'] !== d.source.etag ||
      headers['if-none-match'] !== '*' ||
      headers['x-amz-metadata-directive'] !== 'REPLACE' ||
      headers['content-type'] !== d.mimeType ||
      headers['x-amz-meta-animal-upload-id'] !== d.uploadId ||
      headers['x-amz-meta-animal-upload-sha256'] !== d.source.sha256
    )
      throw new Error('request');
  }

  updateHttpClientConfig(): void {
    throw new MediaPromotionDispatchError('LIFECYCLE');
  }
  httpHandlerConfigs() {
    return {};
  }
  destroy(): void {
    this.stopped = true;
    this.transport.destroy();
  }
}
