import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<CounterEntity>;

@Schema({ collection: 'counters' })
export class CounterEntity {
    @Prop({ required: true })
    _id: string; // key like 'animal_code_C'

    @Prop({ required: true, default: 0 })
    seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(CounterEntity);
