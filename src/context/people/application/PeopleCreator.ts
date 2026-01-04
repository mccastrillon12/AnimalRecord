import { Inject, Injectable } from "@nestjs/common";
import { PeopleRepository } from "../domain/peopleRepository";
import { PeopleCreatorRequest } from "./dto/PeopleCreatorRequest";
import { People } from "../domain";

@Injectable()
export class PeopleCreator {

  constructor(
    @Inject("PeopleRepository")
    private readonly peopleRepository: PeopleRepository) {}

    async run(peopleRequest: PeopleCreatorRequest): Promise<People> {
        const newPeople = People.fromPrimitives(peopleRequest);
        return this.peopleRepository.insert(newPeople);
    }
}

