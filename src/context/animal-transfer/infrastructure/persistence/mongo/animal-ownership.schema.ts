import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { OwnershipPeriodStartProvenance } from '../../../domain/animal-ownership';

export enum AnimalOwnershipPeriodStatus {
  Active = 'ACTIVE',
  Closed = 'CLOSED',
}

export type AnimalOwnershipPeriodDocument =
  HydratedDocument<AnimalOwnershipPeriodEntity>;

@Schema({ collection: 'animal_ownership_periods' })
export class AnimalOwnershipPeriodEntity {
  @Prop({ unique: true, required: true })
  id: string;

  @Prop({ required: true })
  animalId: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, min: 1 })
  ownershipVersion: number;

  @Prop()
  startedAt?: string;

  @Prop({ required: true, default: false })
  startedAtKnown: boolean;

  @Prop({ required: true, enum: Object.values(OwnershipPeriodStartProvenance) })
  startProvenance: OwnershipPeriodStartProvenance;

  @Prop()
  endedAt?: string;

  @Prop()
  sourceTransferId?: string;

  @Prop()
  archiveId?: string;

  @Prop({ required: true, enum: Object.values(AnimalOwnershipPeriodStatus) })
  status: AnimalOwnershipPeriodStatus;
}

export const AnimalOwnershipPeriodSchema = SchemaFactory.createForClass(
  AnimalOwnershipPeriodEntity,
);
AnimalOwnershipPeriodSchema.index(
  { animalId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: AnimalOwnershipPeriodStatus.Active },
  },
);
AnimalOwnershipPeriodSchema.index({ ownerId: 1, status: 1, startedAt: -1 });

@Schema({ _id: false })
export class AnimalTransferLockSubdocument {
  @Prop({ required: true })
  transferId: string;

  @Prop({ required: true })
  lockedAt: string;
}

export const AnimalTransferLockSubdocumentSchema = SchemaFactory.createForClass(
  AnimalTransferLockSubdocument,
);

export type AnimalOwnershipControlDocument =
  HydratedDocument<AnimalOwnershipControlEntity>;

@Schema({ collection: 'animal_ownership_controls' })
export class AnimalOwnershipControlEntity {
  @Prop({ unique: true, required: true })
  animalId: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, min: 1, default: 1 })
  ownershipVersion: number;

  @Prop({ type: AnimalTransferLockSubdocumentSchema })
  transferLock?: AnimalTransferLockSubdocument;

  @Prop({
    type: [
      {
        _id: false,
        token: String,
        startedAt: String,
        operationId: String,
        instanceId: String,
      },
    ],
    default: [],
  })
  activeWrites: Array<{
    token: string;
    startedAt: string;
    operationId?: string;
    instanceId?: string;
  }>;

  @Prop()
  uploadsValidUntil?: string;

  @Prop()
  mediaMigrationRevision?: number;

  @Prop()
  archiveReferencePlanRevision?: number;

  @Prop()
  archiveMaterializationRevision?: number;

  @Prop()
  reservationEpoch?: number;

  @Prop()
  archivePreparationRevision?: number;

  @Prop()
  mediaPromotionRevision?: number;
}

export const AnimalOwnershipControlSchema = SchemaFactory.createForClass(
  AnimalOwnershipControlEntity,
);
AnimalOwnershipControlSchema.index({ 'transferLock.transferId': 1 });
