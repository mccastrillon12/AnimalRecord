import { AnimalMediaUpload } from '../../../src/context/animal-media/domain/animal-media-upload';
import {
  MediaPromotionCommand,
  advanceMediaPromotion,
  createMediaPromotionModel,
} from '../../../src/context/animal-media/domain/media-promotion-machine';
import {
  ANIMAL_WRITE_PROTOCOL,
  AnimalWriteJournal,
} from '../../../src/context/animal-transfer/domain/animal-write-journal';

export const promotionTestId = (n: number) =>
  `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export function promotionFixture(
  kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
) {
  const id = promotionTestId;
  const animalId = id(1),
    ownerId = id(2),
    effectId = id(5),
    attemptId = id(6);
  const at = '2026-10-26T12:00:00.000Z';
  const journal: AnimalWriteJournal = {
    id: id(3),
    instanceId: id(4),
    actorId: ownerId,
    kind,
    protocol: ANIMAL_WRITE_PROTOCOL,
    instanceStartedAt: at,
    createdAt: at,
    updatedAt: at,
    issuesUploadUrl: false,
    lifecycle: 'OPEN',
    callback: 'MAY_RUN',
    callbackPermittedAt: at,
    claims: [
      { animalId, ownershipVersion: 2, state: 'ACQUIRED', updatedAt: at },
    ],
  };
  const prefix = `users/${ownerId}/animals/${animalId}/`;
  const upload: AnimalMediaUpload = {
    id: id(7),
    ownerId,
    animalId,
    finalKey: `${prefix}${kind === 'PROFILE_CONFIRM' ? 'profile_123.jpeg' : `diary/${id(8)}/${id(9)}.m4a`}`,
    stagingKey: `${prefix}upload-intake/${id(7)}/source`,
    mimeType: kind === 'PROFILE_CONFIRM' ? 'image/jpeg' : 'audio/mp4',
    size: 32,
    createdAt: at,
    pinned: { etag: '"source"', size: 32, sha256: 'a'.repeat(64) },
  };
  const initial = createMediaPromotionModel(journal, animalId);
  const declaration: MediaPromotionCommand = {
    type: 'DECLARE_EFFECT',
    bucket: 'animalrecord-test-media',
    effectId,
    upload,
  };
  const declared = advanceMediaPromotion(initial, 0, declaration);
  const intention: MediaPromotionCommand = {
    type: 'INTEND_ATTEMPT',
    effectId,
    attemptId,
    dispatcherInstanceId: id(10),
    origin: 'INITIAL',
  };
  const intended = advanceMediaPromotion(declared, 1, intention);
  const authorize: MediaPromotionCommand = {
    type: 'AUTHORIZE_ATTEMPT',
    effectId,
    attemptId,
    authorizationId: id(11),
  };
  const revoke: MediaPromotionCommand = {
    type: 'REVOKE',
    requestId: id(12),
    evidenceRef: 'incident:promotion-30',
  };
  return {
    id,
    journal,
    animalId,
    upload,
    initial,
    declaration,
    declared,
    intention,
    intended,
    authorize,
    revoke,
    effectId,
    attemptId,
  };
}
