import { v4 as uuidv4 } from 'uuid';
import { DiaryEntryId } from './diaryEntryId';
import { DiaryEntryTitle } from './diaryEntryTitle';
import { AnimalId } from '../../animal/domain/animalId';

export type AttachmentPrimitiveType = {
    id: string;
    fileName: string;
    fileType: string;      // 'image' | 'audio'
    mimeType: string;
    url: string;
    size: number;
    createdAt: string;
};

export type DiaryEntryPrimitiveType = {
    id: string;
    animalId: string;
    title: string;
    content?: string;
    date: string;
    attachments: AttachmentPrimitiveType[];
    createdAt: string;
    updatedAt: string;
};

export class Attachment {
    constructor(
        public readonly id: string,
        public readonly fileName: string,
        public readonly fileType: string,
        public readonly mimeType: string,
        public readonly url: string,
        public readonly size: number,
        public readonly createdAt: string
    ) { }

    toPrimitives(): AttachmentPrimitiveType {
        return {
            id: this.id,
            fileName: this.fileName,
            fileType: this.fileType,
            mimeType: this.mimeType,
            url: this.url,
            size: this.size,
            createdAt: this.createdAt
        };
    }

    static fromPrimitives(data: AttachmentPrimitiveType): Attachment {
        return new Attachment(
            data.id,
            data.fileName,
            data.fileType,
            data.mimeType,
            data.url,
            data.size,
            data.createdAt
        );
    }
}

export class DiaryEntry {
    id: DiaryEntryId;
    animalId: AnimalId;
    title: DiaryEntryTitle;
    content?: string;
    date: string;
    attachments: Attachment[];
    createdAt: string;
    updatedAt: string;

    constructor(
        id: DiaryEntryId,
        animalId: AnimalId,
        title: DiaryEntryTitle,
        content: string | undefined,
        date: string,
        attachments: Attachment[],
        createdAt: string,
        updatedAt: string
    ) {
        this.id = id;
        this.animalId = animalId;
        this.title = title;
        this.content = content;
        this.date = date;
        this.attachments = attachments;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    addAttachment(attachment: Attachment): void {
        this.attachments.push(attachment);
        this.updatedAt = new Date().toISOString();
    }

    removeAttachment(attachmentId: string): Attachment | undefined {
        const index = this.attachments.findIndex(a => a.id === attachmentId);
        if (index === -1) return undefined;
        const [removed] = this.attachments.splice(index, 1);
        this.updatedAt = new Date().toISOString();
        return removed;
    }

    updateContent(title: string, content?: string): void {
        this.title = new DiaryEntryTitle(title);
        this.content = content;
        this.updatedAt = new Date().toISOString();
    }

    toPrimitives(): DiaryEntryPrimitiveType {
        return {
            id: this.id.value,
            animalId: this.animalId.value,
            title: this.title.value,
            content: this.content,
            date: this.date,
            attachments: this.attachments.map(a => a.toPrimitives()),
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    static fromPrimitives(data: DiaryEntryPrimitiveType): DiaryEntry {
        return new DiaryEntry(
            new DiaryEntryId(data.id),
            new AnimalId(data.animalId),
            new DiaryEntryTitle(data.title),
            data.content,
            data.date,
            (data.attachments || []).map(a => Attachment.fromPrimitives(a)),
            data.createdAt,
            data.updatedAt
        );
    }

    static create(animalId: string, title: string, content?: string, date?: string): DiaryEntry {
        const now = new Date().toISOString();
        return new DiaryEntry(
            new DiaryEntryId(uuidv4()),
            new AnimalId(animalId),
            new DiaryEntryTitle(title),
            content,
            date || now,
            [],
            now,
            now
        );
    }
}
