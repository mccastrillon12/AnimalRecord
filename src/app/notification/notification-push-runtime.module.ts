import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import { isAbsolute } from 'node:path';
import { NotificationPushProcessor } from '../../context/notification/application/notification-push';
import {
  type NotificationPushStore,
  PUSH_ACTIVATION_FROM,
} from '../../context/notification/domain/notification-push';
import { FcmNotificationPush } from '../../context/notification/infrastructure/fcm-notification-push';
import { NotificationPushPersistenceModule } from './notification-push-persistence.module';

@Injectable()
export class NotificationPushRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationPushRunner.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    @Inject('NotificationPushStore')
    private readonly store: NotificationPushStore,
    @Inject(PUSH_ACTIVATION_FROM) private readonly from: string,
    private readonly fcm: FcmNotificationPush,
  ) {}

  onModuleInit() {
    this.schedule(0);
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.runBatch().finally(() => this.schedule(30_000));
    }, delay).unref();
  }

  private async runBatch() {
    if (new Date().toISOString() < this.from) return;
    try {
      const provider = await this.fcm.authorize();
      if (this.stopped) return;
      const processor = new NotificationPushProcessor(this.store, provider, {
        maxAttempts: 3,
        delayMs: 60_000,
      });
      let failures = 0;
      const outcomes = await processor.work(20, {
        onFailure: () => {
          failures++;
        },
        stopped: () => this.stopped,
      });
      const unconfirmed = outcomes.filter(
        (outcome) => outcome === 'UNKNOWN',
      ).length;
      const rejected = outcomes.filter(
        (outcome) => outcome === 'PERMANENT_REJECTION',
      ).length;
      if (failures || unconfirmed || rejected)
        this.logger.warn({
          event: 'transfer-push-batch-incomplete',
          failures,
          unconfirmed,
          rejected,
        });
    } catch {
      this.logger.warn('transfer-push-batch-unavailable');
    }
  }
}

@Module({})
class NotificationPushRuntimeModule {}

export function configuredNotificationPush(
  env: NodeJS.ProcessEnv,
): DynamicModule | undefined {
  const enabled = env.TRANSFER_PUSH_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false')
    return undefined;
  const from = env.TRANSFER_PUSH_FROM ?? '';
  const start = Date.parse(from);
  const project = env.TRANSFER_PUSH_FCM_PROJECT_ID ?? '';
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS ?? '';
  if (
    enabled !== 'true' ||
    !Number.isFinite(start) ||
    new Date(start).toISOString() !== from ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
    !isAbsolute(keyFile)
  )
    throw new Error(
      'Transfer push requires an explicit UTC cutoff, Firebase project ID and absolute credentials file',
    );
  const auth = new GoogleAuth({
    keyFilename: keyFile,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    clientOptions: { transporterOptions: { timeout: 8_000 } },
  });
  return {
    module: NotificationPushRuntimeModule,
    imports: [NotificationPushPersistenceModule.withActivation(from)],
    providers: [
      { provide: PUSH_ACTIVATION_FROM, useValue: from },
      {
        provide: FcmNotificationPush,
        useValue: new FcmNotificationPush(project, () => auth.getAccessToken()),
      },
      NotificationPushRunner,
    ],
  };
}
