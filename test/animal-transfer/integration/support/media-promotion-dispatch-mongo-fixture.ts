import {
  MediaPromotionCopyDispatcher,
  PromotionDispatchInput,
} from '../../../../src/context/animal-media/infrastructure/media-promotion-copy-dispatcher';
import { PromotionStoredCommand } from '../../../../src/context/animal-media/domain/media-promotion-persistence';
import { LocalMongoTestSettings } from './local-mongo-test-safety';
import { MediaPromotionMongoFixture } from './media-promotion-mongo-fixture';
import {
  assertOwnedDispatchTestDatabase,
  createDispatchTestNamespace,
  readPromotionDispatchMongoSettings,
} from './media-promotion-dispatch-mongo-safety';
import { PromotionDispatchTransport } from './promotion-dispatch-transport';
import { bounded, deferred } from './write-race-gate';

export type DispatchSeed = Awaited<
  ReturnType<MediaPromotionMongoFixture['seedPromotion']>
>;

export class PromotionDispatchMongoFixture extends MediaPromotionMongoFixture {
  override readonly namespace = createDispatchTestNamespace();
  transport!: PromotionDispatchTransport;
  private readonly dispatchers: MediaPromotionCopyDispatcher[] = [];
  private readonly replies: Array<() => void> = [];

  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ): void {
    assertOwnedDispatchTestDatabase(this.namespace, name, marker, collections);
  }

  override async open(settings: LocalMongoTestSettings): Promise<void> {
    const checked = readPromotionDispatchMongoSettings({
      MEDIA_PROMOTION_DISPATCH_MONGO_TESTS: '1',
      MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    this.transport = new PromotionDispatchTransport(checked);
    await super.open(checked);
  }

  async declare(
    kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
  ) {
    const seed = await this.seedPromotion(kind);
    await this.left.repository.open(seed.selection);
    await this.left.repository.apply(seed.selection, 0, seed.declaration);
    return seed;
  }

  async dispatcher(
    seed: DispatchSeed,
    side: 'left' | 'right' = 'left',
    options: Partial<
      Pick<
        PromotionDispatchInput,
        'regions' | 'maxAttempts' | 'followRegionRedirects'
      >
    > = {},
  ) {
    const dispatcher = await MediaPromotionCopyDispatcher.create(
      this[side].repository,
      {
        selection: seed.selection,
        scope: seed.initial.scope,
        effectId: seed.effectId,
        dispatcherInstanceId: seed.id(side === 'left' ? 30 : 31),
        regions: options.regions ?? ['us-east-1'],
        credentials: {
          accessKeyId: 'SYNTHETIC',
          secretAccessKey: 'synthetic-secret',
        },
        maxAttempts: options.maxAttempts ?? 3,
        followRegionRedirects: options.followRegionRedirects ?? false,
      },
    );
    this.dispatchers.push(dispatcher);
    return dispatcher;
  }

  pauseReply(type: PromotionStoredCommand['type']) {
    const entered = deferred(),
      resume = deferred();
    const apply = this.left.repository.apply.bind(this.left.repository);
    const spy = jest
      .spyOn(this.left.repository, 'apply')
      .mockImplementation(async (...args) => {
        const result = await apply(...args);
        if (args[2].type === type) {
          spy.mockRestore();
          entered.resolve();
          await bounded(resume.promise, `${type}:reply`);
        }
        return result;
      });
    this.replies.push(resume.resolve);
    return {
      entered: () => bounded(entered.promise, `${type}:committed`),
      release: resume.resolve,
    };
  }

  override async drain(): Promise<void> {
    for (const release of this.replies.splice(0)) release();
    this.transport?.releaseAll();
    await super.drain();
    for (const dispatcher of this.dispatchers.splice(0)) dispatcher.destroy();
  }

  override async close(): Promise<void> {
    try {
      await super.close();
    } finally {
      this.transport?.restore();
    }
  }
}
