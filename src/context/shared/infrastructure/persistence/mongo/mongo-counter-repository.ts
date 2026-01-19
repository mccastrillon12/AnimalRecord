import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CounterEntity, CounterDocument } from './counter.schema';

@Injectable()
export class MongoCounterRepository {
    constructor(
        @InjectModel(CounterEntity.name) private counterModel: Model<CounterDocument>
    ) { }

    async getNextSequence(key: string): Promise<number> {
        const ret = await this.counterModel.findByIdAndUpdate(
            key,
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );
        return ret ? ret.seq : 1;
    }
}
