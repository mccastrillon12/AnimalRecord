import { request } from 'node:https';
import {
  type NotificationPushProvider,
  type PushProviderResult,
  TRANSFER_RECEIVED_NOTICE,
} from '../domain/notification-push';

type FcmReply = { status: number; body: string; retryAfter?: string };
type FcmPost = (url: URL, token: string, body: string) => Promise<FcmReply>;
const fcmErrorType = 'type.googleapis.com/google.firebase.fcm.v1.FcmError';

// A raw request has no SDK retry or redirect. The timeout covers the full exchange.
const postOnce: FcmPost = (url, token, body) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent: false,
        signal: AbortSignal.timeout(8_000),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = '';
        let bytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 16_384)
            response.destroy(new Error('FCM reply exceeded the size limit'));
          else text += chunk;
        });
        response.once('error', reject);
        response.once('end', () => {
          if (!response.complete)
            return reject(new Error('Incomplete FCM reply'));
          resolve({
            status: response.statusCode ?? 0,
            body: text,
            retryAfter: response.headers['retry-after'],
          });
        });
      },
    );
    req.once('error', reject);
    req.end(body);
  });

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function outcome(reply: FcmReply, now: number): PushProviderResult {
  let decoded: Record<string, unknown>;
  try {
    decoded = record(JSON.parse(reply.body));
  } catch {
    return 'UNKNOWN';
  }
  if (
    reply.status === 200 &&
    typeof decoded.name === 'string' &&
    /^projects\/[^/\s]+\/messages\/[^/\s]+$/.test(decoded.name)
  )
    return 'ACCEPTED';
  const error = record(decoded.error);
  if (error.code !== reply.status) return 'UNKNOWN';
  const details = Array.isArray(error.details)
    ? (error.details as unknown[]).map(record)
    : [];
  const fcmCode = details.find(
    (entry) => entry['@type'] === fcmErrorType,
  )?.errorCode;
  if (
    reply.status === 404 &&
    error.status === 'NOT_FOUND' &&
    fcmCode === 'UNREGISTERED'
  )
    return 'INVALID_TOKEN';
  if (
    reply.status === 429 &&
    error.status === 'RESOURCE_EXHAUSTED' &&
    (fcmCode === 'QUOTA_EXCEEDED' ||
      details.some(
        (entry) =>
          entry['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure',
      ))
  ) {
    const value = reply.retryAfter?.trim();
    const delay =
      value === undefined
        ? 0
        : /^\d+$/.test(value)
          ? Number(value) * 1000
          : Math.max(0, Date.parse(value) - now);
    if (!Number.isSafeInteger(delay) || delay > 366 * 86_400_000)
      return 'UNKNOWN';
    return {
      outcome: 'RETRYABLE_REJECTION',
      retryAfterMs: Math.max(60_000, delay),
    };
  }
  const permanent: Record<number, string> = {
    400: 'INVALID_ARGUMENT',
    401: 'UNAUTHENTICATED',
    403: 'PERMISSION_DENIED',
    404: 'NOT_FOUND',
  };
  return permanent[reply.status] && permanent[reply.status] === error.status
    ? 'PERMANENT_REJECTION'
    : 'UNKNOWN';
}

export class FcmNotificationPush {
  private readonly url: URL;
  constructor(
    projectId: string,
    private readonly accessToken: () => Promise<string | null | undefined>,
    private readonly post: FcmPost = postOnce,
    private readonly clock: () => number = Date.now,
  ) {
    this.url = new URL(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    );
  }

  // Obtain credentials before touching the queue. A credential failure leaves pending work intact.
  async authorize(): Promise<NotificationPushProvider> {
    const bearer = await this.accessToken();
    if (!bearer) throw new Error('FCM access token is unavailable');
    return {
      send: async ({ token, animalCount, data }) => {
        const count =
          animalCount === 1 ? '1 animal' : `${animalCount} animales`;
        const reply = await this.post(
          this.url,
          bearer,
          JSON.stringify({
            message: {
              token,
              notification: {
                title: `¡Te acaban de transferir ${count}!`,
                body:
                  animalCount === 1
                    ? 'Acéptalo y hazle seguimiento a su información.'
                    : 'Acéptalos y hazle seguimiento a su información.',
              },
              data: {
                schemaVersion: '1',
                type: TRANSFER_RECEIVED_NOTICE,
                notificationId: data.notificationId,
                transferId: data.transferId,
              },
              android: {
                priority: 'HIGH',
                notification: { channel_id: 'animal_transfers' },
              },
              apns: {
                headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
                payload: { aps: { sound: 'default' } },
              },
            },
          }),
        );
        return outcome(reply, this.clock());
      },
    };
  }
}
