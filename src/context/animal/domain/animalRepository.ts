import { Animal } from "./animal";
import { Uuid } from "../../shared/domain/value-object/Uuid";
import { Nullable } from "../../shared/domain/Nullable";

export interface AnimalRepository {
    insert(animal: Animal): Promise<Animal>;
    findById(id: Uuid): Promise<Nullable<Animal>>;
    findAll(): Promise<Animal[]>;
    findByOwner(ownerId: Uuid): Promise<Animal[]>;
    update(animal: Animal): Promise<boolean>;
}
