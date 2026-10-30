import {
  AcceptanceSelection,
  AcceptanceSnapshot,
} from '../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import { transferRecordId } from '../../../src/context/animal-transfer/domain/transfer-record-id';
import { promotionTestId as id } from './media-promotion.fixture';
import { otpActor, otpOther } from './transfer-otp.fixture';
export const acceptanceAt = '2026-10-29T12:00:00.000Z';
export function acceptanceFixture(count = 2) {
  const input: AcceptanceSelection = {
    actorId: otpOther,
    transferId: id(1),
    operationId: id(2),
    expectedVersion: 1,
    acceptedAnimalIds: [id(100)],
  };
  const snapshot: AcceptanceSnapshot = {
    request: {
      _id: id(1),
      senderId: otpActor,
      recipientId: otpOther,
      status: 'PENDING',
      version: 1,
      animalCount: count,
    },
    items: Array.from({ length: count }, (_, n) => ({
      _id: transferRecordId('item', id(1), id(100 + n)),
      transferId: id(1),
      animalId: id(100 + n),
      expectedOwnerId: otpActor,
      expectedOwnershipVersion: 1,
      status: 'PENDING',
    })),
    claims: Array.from({ length: count }, (_, n) => ({
      _id: id(100 + n),
      transferId: id(1),
    })),
    animals: [{ id: id(100), ownerId: otpActor, isActive: true }],
    controls: [
      {
        animalId: id(100),
        ownerId: otpActor,
        ownershipVersion: 1,
        lockPresent: false,
        writersPresent: false,
      },
    ],
    periods: [
      {
        id: id(200),
        animalId: id(100),
        ownerId: otpActor,
        ownershipVersion: 1,
        status: 'ACTIVE',
      },
    ],
    pendingMedicalAnimalIds: [],
  };
  return { input, snapshot, id, actorId: otpActor, recipientId: otpOther };
}
