import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity } from '../../../../user/infrastructure/persistence/mongo/user.schema';
import { MedicalDocumentUploaderNames } from '../../../domain/medical-document';

@Injectable()
export class MongoMedicalDocumentUploaderName implements MedicalDocumentUploaderNames {
  constructor(
    @InjectModel(UserEntity.name) private readonly users: Model<UserEntity>,
  ) {}
  async findName(id: string): Promise<string | undefined> {
    const user = await this.users
      .findOne({ id })
      .select({ _id: 0, name: 1 })
      .lean()
      .exec();
    return user?.name;
  }
}
