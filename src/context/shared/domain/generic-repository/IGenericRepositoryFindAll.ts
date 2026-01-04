export interface IGenericRepositoryFindAll<T> {
  findAll(): Promise<T[]>;
}
