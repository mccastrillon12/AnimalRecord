import { Inject, Injectable } from "@nestjs/common";
import { PeopleId, PeopleRepository } from "../domain";

@Injectable()
export class PeopleFinder {
   
    constructor( @Inject('PeopleRepository')
    private readonly peopleRepository: PeopleRepository) { }

    async run(id: string) {
        const peopleId = new PeopleId(id);
        return this.peopleRepository.findById(peopleId);
    }
    
}