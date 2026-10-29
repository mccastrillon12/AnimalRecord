import { MediaConfirmationContext } from './media-confirmation-context';
import { PromotionSelection } from './media-promotion-persistence';

type Stage = 'SETUP' | 'LIFECYCLE' | 'REQUEST' | 'PERMISSION' | 'RESPONSE';
/** Terminal local error; never treat its SDK metadata as a copy conflict. */
export class MediaPromotionDispatchError extends Error {
  readonly name = 'MediaPromotionDispatchError';
  constructor(readonly stage: Stage) {
    super(`Media promotion dispatch stopped at ${stage}`);
  }
}

export type PromotionDispatchIdentity = {
  selection: PromotionSelection;
  scope: MediaConfirmationContext;
  effectId: string;
  dispatcherInstanceId: string;
};

/** Trusted backend dependency. Production must use the controlled copy dispatcher. */
export interface MediaPromotionDispatcherFactory {
  create(identity: PromotionDispatchIdentity): Promise<{
    send(): Promise<unknown>;
    destroy(): void;
  }>;
}
