import { Nullable } from "../../shared/domain/Nullable";
import { IGenericRepositoryFindAll } from "../../shared/domain/generic-repository/IGenericRepositoryFindAll";
import { IGenericRepositoryUpdate } from "../../shared/domain/generic-repository/IGenericRepositoryUpdate";
import { IGenericRepositoryFindById, IGenericRepositoryInsert } from "../../shared/domain/generic-repository";
import { User } from "./user";

export interface UserRepository
    extends IGenericRepositoryInsert<User>,
    IGenericRepositoryFindById<User>,
    IGenericRepositoryFindAll<User>,
    IGenericRepositoryUpdate<User> {
    findByEmail(email: string): Promise<Nullable<User>>;
    findByCellPhone(cellPhone: string): Promise<Nullable<User>>;
}
