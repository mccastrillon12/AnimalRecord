import { Nullable } from '../Nullable';
import { Uuid } from '../value-object/Uuid';

export interface IGenericRepositoryFindById<T> {
  findById(id: Uuid): Promise<Nullable<T>>;
}
