export interface IGenericRepositoryUpdate<T> {
  update(entity: T): Promise<boolean>;
}
