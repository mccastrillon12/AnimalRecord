;
import { IGenericRepositoryFindById, IGenericRepositoryInsert } from "../../shared/domain/generic-repository";
import { User } from "./user";

export interface UserRepository
    extends IGenericRepositoryInsert<User>,
    IGenericRepositoryFindById<User> { }
