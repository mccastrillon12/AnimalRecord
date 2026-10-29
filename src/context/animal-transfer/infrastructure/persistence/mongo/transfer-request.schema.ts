import { Schema } from 'mongoose';
import {
  TransferRequestItem,
  TransferRequestRecord,
} from '../../../domain/transfer-request';
export const TRANSFER_REQUEST_MODEL = 'AnimalTransferRequest';
export const TRANSFER_REQUEST_ITEM_MODEL = 'AnimalTransferRequestItem';
export const TRANSFER_REQUEST_CLAIM_MODEL = 'AnimalTransferRequestClaim';
export const TRANSFER_NOTICE_MODEL = 'AnimalTransferNotice';
export const TRANSFER_OUTBOX_MODEL = 'AnimalTransferOutbox';
export const TRANSFER_EVENT_MODEL = 'AnimalTransferEvent';
export type RequestClaim = { _id: string; transferId: string };
export type TransferNotice = {
  _id: string;
  userId: string;
  transferId: string;
  type: 'TRANSFER_REQUEST_SENT' | 'TRANSFER_REQUEST_RECEIVED';
  itemIds: string[];
  title: string;
  text: string;
  createdAt: string;
  readAt?: string;
};
export type TransferOutbox = {
  _id: string;
  notificationId: string;
  userId: string;
  transferId: string;
  status: 'PENDING';
  createdAt: string;
  attempts: number;
};
export type TransferEvent = {
  _id: string;
  transferId: string;
  actorId: string;
  type: 'REQUEST_CREATED';
  createdAt: string;
};
const id = { type: String, required: true };
const options = (collection: string) => ({
  collection,
  autoCreate: false,
  autoIndex: false,
  versionKey: false as const,
});
export const TransferRequestSchema = new Schema<TransferRequestRecord>(
  {
    _id: id,
    senderId: id,
    senderName: String,
    recipientId: id,
    recipientName: String,
    reasonCode: id,
    reasonName: id,
    status: { type: String, enum: ['PENDING'], required: true },
    createdAt: id,
    animalCount: { type: Number, required: true },
    version: { type: Number, required: true },
    bodyHash: id,
    authorizationChallengeId: id,
  },
  options('animal_transfers'),
);
TransferRequestSchema.index({ senderId: 1, createdAt: -1, _id: -1 });
TransferRequestSchema.index({ recipientId: 1, createdAt: -1, _id: -1 });
export const TransferRequestItemSchema = new Schema<TransferRequestItem>(
  {
    _id: id,
    transferId: id,
    animalId: id,
    animalName: id,
    animalCode: id,
    expectedOwnerId: id,
    expectedOwnershipVersion: { type: Number, required: true },
    status: { type: String, enum: ['PENDING'], required: true },
  },
  options('animal_transfer_items'),
);
TransferRequestItemSchema.index({ transferId: 1, animalId: 1 });
export const TransferRequestClaimSchema = new Schema<RequestClaim>(
  { _id: id, transferId: id },
  options('animal_transfer_active_items'),
);
export const TransferNoticeSchema = new Schema<TransferNotice>(
  {
    _id: id,
    userId: id,
    transferId: id,
    type: {
      type: String,
      enum: ['TRANSFER_REQUEST_SENT', 'TRANSFER_REQUEST_RECEIVED'],
      required: true,
    },
    itemIds: { type: [String], required: true },
    title: id,
    text: id,
    createdAt: id,
    readAt: String,
  },
  options('notifications'),
);
TransferNoticeSchema.index({ userId: 1, createdAt: -1, _id: -1 });
export const TransferOutboxSchema = new Schema<TransferOutbox>(
  {
    _id: id,
    notificationId: id,
    userId: id,
    transferId: id,
    status: { type: String, enum: ['PENDING'], required: true },
    createdAt: id,
    attempts: { type: Number, required: true },
  },
  options('notification_outbox'),
);
TransferOutboxSchema.index({ status: 1, createdAt: 1, _id: 1 });
export const TransferEventSchema = new Schema<TransferEvent>(
  {
    _id: id,
    transferId: id,
    actorId: id,
    type: { type: String, enum: ['REQUEST_CREATED'], required: true },
    createdAt: id,
  },
  options('animal_transfer_events'),
);
export const TRANSFER_REQUEST_MODELS = [
  { name: TRANSFER_REQUEST_MODEL, schema: TransferRequestSchema },
  { name: TRANSFER_REQUEST_ITEM_MODEL, schema: TransferRequestItemSchema },
  { name: TRANSFER_REQUEST_CLAIM_MODEL, schema: TransferRequestClaimSchema },
  { name: TRANSFER_NOTICE_MODEL, schema: TransferNoticeSchema },
  { name: TRANSFER_OUTBOX_MODEL, schema: TransferOutboxSchema },
  { name: TRANSFER_EVENT_MODEL, schema: TransferEventSchema },
];
