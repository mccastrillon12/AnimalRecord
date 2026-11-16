import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Schema } from 'mongoose';
import {
  TransferOtpState,
  TransferOtpStore,
} from '../../../domain/transfer-otp';

export const TRANSFER_OTP_MODEL = 'AnimalTransferOtp';
export const TransferOtpSchema = new Schema<TransferOtpState>(
  {
    _id: { type: String, required: true },
    challengeId: { type: String, required: true },
    revision: { type: Number, required: true },
    purpose: { type: String, enum: ['ANIMAL_TRANSFER'], required: true },
    channel: { type: String, enum: ['EMAIL', 'PHONE'], required: true },
    contactHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['DELIVERY_PENDING', 'READY', 'VERIFIED', 'CONSUMED'],
      required: true,
    },
    codeHash: String,
    codeExpiresAt: { type: Date, required: true },
    resendAvailableAt: { type: Date, required: true },
    attempts: { type: Number, required: true },
    sendWindowStartedAt: { type: Date, required: true },
    sendCount: { type: Number, required: true },
    proofHash: String,
    proofExpiresAt: Date,
  },
  {
    collection: 'animal_transfer_otp',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
const majority = { writeConcern: { w: 'majority' as const } };
@Injectable()
export class MongoTransferOtp implements TransferOtpStore {
  constructor(
    @InjectModel(TRANSFER_OTP_MODEL)
    private readonly model: Model<TransferOtpState>,
  ) {}
  find(actorId: string) {
    return this.model
      .findById(actorId)
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }
  async put(
    state: TransferOtpState,
    expectedRevision: number | undefined,
  ): Promise<boolean> {
    if (expectedRevision === undefined) {
      try {
        await this.model.create([state], { w: 'majority' });
        return true;
      } catch (error) {
        if ((error as { code?: number })?.code === 11000) return false;
        throw error;
      }
    }
    const { _id, ...set } = state;
    const result = await this.model
      .updateOne(
        { _id, revision: expectedRevision },
        { $set: set, $unset: { proofHash: 1, proofExpiresAt: 1 } },
        majority,
      )
      .exec();
    return result.matchedCount === 1;
  }
  async activate(
    actorId: string,
    challengeId: string,
    revision: number,
    now: Date,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: actorId,
          challengeId,
          revision,
          status: 'DELIVERY_PENDING',
          codeExpiresAt: { $gt: now },
          $expr: { $gt: ['$codeExpiresAt', '$$NOW'] },
        },
        { $set: { status: 'READY' }, $inc: { revision: 1 } },
        majority,
      )
      .exec();
    return result.matchedCount === 1;
  }
  claimAttempt(
    actorId: string,
    challengeId: string,
    revision: number,
    now: Date,
    limit: number,
  ) {
    return this.model
      .findOneAndUpdate(
        {
          _id: actorId,
          challengeId,
          revision,
          purpose: 'ANIMAL_TRANSFER',
          status: 'READY',
          codeExpiresAt: { $gt: now },
          $expr: { $gt: ['$codeExpiresAt', '$$NOW'] },
          attempts: { $lt: limit },
        },
        { $inc: { attempts: 1, revision: 1 } },
        { ...majority, new: true },
      )
      .lean()
      .exec();
  }
  async authorize(
    actorId: string,
    challengeId: string,
    revision: number,
    now: Date,
    hash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: actorId,
          challengeId,
          revision,
          purpose: 'ANIMAL_TRANSFER',
          status: 'READY',
          codeExpiresAt: { $gt: now },
          $expr: { $gt: ['$codeExpiresAt', '$$NOW'] },
        },
        {
          $set: {
            status: 'VERIFIED',
            proofHash: hash,
            proofExpiresAt: expiresAt,
          },
          $unset: { codeHash: 1 },
          $inc: { revision: 1 },
        },
        majority,
      )
      .exec();
    return result.matchedCount === 1;
  }
  async consume(
    actorId: string,
    challengeId: string,
    hash: string,
    now: Date,
    session: ClientSession,
  ): Promise<boolean> {
    if (
      !session?.inTransaction() ||
      (session as unknown as { client?: unknown }).client !==
        this.model.db.getClient()
    )
      throw new Error(
        'Transfer authorization consumption requires the business transaction on the same client',
      );
    const result = await this.model
      .updateOne(
        {
          _id: actorId,
          challengeId,
          purpose: 'ANIMAL_TRANSFER',
          status: 'VERIFIED',
          proofHash: hash,
          proofExpiresAt: { $gt: now },
          $expr: { $gt: ['$proofExpiresAt', '$$NOW'] },
        },
        {
          $set: { status: 'CONSUMED' },
          $unset: { proofHash: 1, proofExpiresAt: 1 },
          $inc: { revision: 1 },
        },
        { session },
      )
      .exec();
    return result.matchedCount === 1;
  }
}
