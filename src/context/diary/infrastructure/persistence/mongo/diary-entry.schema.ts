import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DiaryEntryDocument = HydratedDocument<DiaryEntryEntity>;

@Schema({ _id: false })
export class AttachmentSubdocument {
    @Prop({ required: true })
    id: string;

    @Prop({ required: true })
    fileName: string;

    @Prop({ required: true })
    fileType: string;

    @Prop({ required: true })
    mimeType: string;

    @Prop({ required: true })
    url: string;

    @Prop({ required: true })
    size: number;

    @Prop({ required: true })
    createdAt: string;
}

export const AttachmentSubdocumentSchema = SchemaFactory.createForClass(AttachmentSubdocument);

@Schema({ collection: 'diary_entries' })
export class DiaryEntryEntity {
    @Prop({ unique: true, required: true })
    id: string;

    @Prop({ required: true, index: true })
    animalId: string;

    @Prop({ required: true })
    title: string;

    @Prop({ required: true })
    content: string;

    @Prop({ required: true })
    date: string;

    @Prop({ type: [AttachmentSubdocumentSchema], default: [] })
    attachments: AttachmentSubdocument[];

    @Prop({ required: true })
    createdAt: string;

    @Prop({ required: true })
    updatedAt: string;
}

export const DiaryEntrySchema = SchemaFactory.createForClass(DiaryEntryEntity);
