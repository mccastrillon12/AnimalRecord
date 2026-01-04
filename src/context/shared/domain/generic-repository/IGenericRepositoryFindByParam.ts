import { ValueObject } from '../value-object/ValueObject';
import { Uuid } from '../value-object/Uuid';

export interface IGenericRepositoryFindByParam<T> {
  findByParam(param: Uuid | ValueObject<string>): Promise<T>;
}
