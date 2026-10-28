import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import {
  AnimalMediaUpload,
  AnimalMediaUploadRepository,
  MediaRevision,
  PinnedMedia,
} from '../domain/animal-media-upload';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

export const ANIMAL_MEDIA_UPLOAD_MODEL = 'AnimalMediaUpload';
export const AnimalMediaUploadSchema = new Schema<AnimalMediaUpload>(
  {
    id: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    animalId: { type: String, required: true },
    finalKey: { type: String, required: true, unique: true },
    stagingKey: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    createdAt: { type: String, required: true },
    mediaPromotionRevision: Number,
    pinned: Schema.Types.Mixed,
    sealed: Schema.Types.Mixed,
    legacy: Schema.Types.Mixed,
  },
  { collection: 'animal_media_uploads' },
);
const MAJORITY = { writeConcern: { w: 'majority' as const } };

@Injectable()
export class MongoAnimalMediaUploadRepository implements AnimalMediaUploadRepository {
  constructor(
    @InjectModel(ANIMAL_MEDIA_UPLOAD_MODEL)
    private readonly uploads: Model<AnimalMediaUpload>,
  ) {}

  async create(upload: AnimalMediaUpload): Promise<void> {
    try {
      await this.uploads.create([upload], { w: 'majority' });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000)
        throw new ConflictError(
          'The upload destination has already been issued',
        );
      throw error;
    }
  }

  async find(finalKey: string): Promise<AnimalMediaUpload | null> {
    return this.uploads
      .findOne({ finalKey })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  async pin(finalKey: string, source: PinnedMedia): Promise<AnimalMediaUpload> {
    await this.uploads
      .updateOne(
        { finalKey, pinned: { $exists: false }, sealed: { $exists: false } },
        { $set: { pinned: source } },
        MAJORITY,
      )
      .exec();
    const upload = await this.find(finalKey);
    if (!upload?.pinned)
      throw new ConflictError('The upload revision could not be pinned');
    return upload;
  }

  async findLegacySource(sourceKey: string): Promise<AnimalMediaUpload | null> {
    return this.uploads
      .findOne({ stagingKey: sourceKey, legacy: { $exists: true } })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  async seal(
    finalKey: string,
    sha256: string,
    revision: MediaRevision,
  ): Promise<void> {
    await this.uploads
      .updateOne(
        { finalKey, 'pinned.sha256': sha256, sealed: { $exists: false } },
        { $set: { sealed: revision } },
        MAJORITY,
      )
      .exec();
    const upload = await this.find(finalKey);
    if (
      !upload?.sealed ||
      upload.pinned?.sha256 !== sha256 ||
      upload.sealed.etag !== revision.etag ||
      upload.sealed.versionId !== revision.versionId ||
      upload.sealed.size !== revision.size
    ) {
      throw new ConflictError('The upload could not be confirmed as sealed');
    }
  }
}
