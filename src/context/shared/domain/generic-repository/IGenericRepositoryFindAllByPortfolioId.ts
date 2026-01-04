import { ValueObject } from '../value-object/ValueObject';
import { Uuid } from '../value-object/Uuid';

export interface IGenericRepositoryFindAllByPortFolioId<T> {
  findAllByPortfolioId(param: Uuid | ValueObject<string>): Promise<T[]>;
}
