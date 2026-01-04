import { Uuid } from '../value-object/Uuid';

export interface IGenericRepositoryRemove {
  remove(id: Uuid): Promise<boolean>;
}
