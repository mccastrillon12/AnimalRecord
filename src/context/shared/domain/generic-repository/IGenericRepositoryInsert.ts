export interface IGenericRepositoryInsert<T> {
  insert(entity: T): Promise<T>;
}
