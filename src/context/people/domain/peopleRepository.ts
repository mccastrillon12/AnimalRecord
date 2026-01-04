import { IGenericRepositoryInsert, IGenericRepositoryFindById } from "src/context/Shared/domain/generic-repository";
import { People } from "./people";

export interface PeopleRepository
  extends IGenericRepositoryInsert<People>,
  IGenericRepositoryFindById<People> { }