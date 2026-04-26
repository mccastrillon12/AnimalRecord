import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DiaryRepository } from '../../../domain/diary-repository';
import { DiaryEntry } from '../../../domain/diary-entry';
import { DiaryEntryEntity, DiaryEntryDocument } from './diary-entry.schema';

@Injectable()
export class MongoDiaryRepository implements DiaryRepository {
    constructor(
        @InjectModel(DiaryEntryEntity.name) private diaryModel: Model<DiaryEntryDocument>
    ) { }

    async save(entry: DiaryEntry): Promise<DiaryEntry> {
        const primitives = entry.toPrimitives();
        const created = new this.diaryModel(primitives);
        await created.save();
        return entry;
    }

    async findById(entryId: string): Promise<DiaryEntry | null> {
        const doc = await this.diaryModel.findOne({ id: entryId }).exec();
        if (!doc) return null;
        return this.toDomain(doc);
    }

    async findByAnimalId(animalId: string): Promise<DiaryEntry[]> {
        const docs = await this.diaryModel
            .find({ animalId })
            .sort({ date: -1 })
            .exec();
        return docs.map(doc => this.toDomain(doc));
    }

    async update(entry: DiaryEntry): Promise<boolean> {
        const primitives = entry.toPrimitives();
        const result = await this.diaryModel.updateOne({ id: primitives.id }, primitives).exec();
        return result.modifiedCount > 0;
    }

    async delete(entryId: string): Promise<boolean> {
        const result = await this.diaryModel.deleteOne({ id: entryId }).exec();
        return result.deletedCount > 0;
    }

    private toDomain(doc: DiaryEntryDocument): DiaryEntry {
        return DiaryEntry.fromPrimitives({
            id: doc.id,
            animalId: doc.animalId,
            title: doc.title,
            content: doc.content,
            date: doc.date,
            attachments: (doc.attachments || []).map(a => ({
                id: a.id,
                fileName: a.fileName,
                fileType: a.fileType,
                mimeType: a.mimeType,
                url: a.url,
                size: a.size,
                createdAt: a.createdAt
            })),
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        });
    }
}
