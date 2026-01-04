import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { PeopleEntity } from "./typeorm/PeopleEntity";
import { Repository } from "typeorm";
import { PeopleRepository } from "../domain/peopleRepository";
import { Nullable } from "src/context/Shared/domain/Nullable";
import { Uuid } from "src/context/Shared/domain/value-object/Uuid";
import { People } from "../domain";

@Injectable()
export class PeopleTypeOrmRepository implements PeopleRepository {
    constructor(

    ) {
    
    }

    async insert(people: People): Promise<People> {
        DBpeople.push({
            id: people.id.value,
            name: people.name.value,
            age: people.age.value
        });

        return new People(
            people.id,   
            people.name,
            people.age
        );
    }

    async findById(id: Uuid): Promise<Nullable<People>> {
        const found = DBpeople.find(p => p.id === id.value);
        if (!found) return null;
        return People.fromPrimitives({
            id: found.id,   
            name: found.name,
            age: found.age
        });
    }
}


const DBpeople = [
  { id: '907592ee-0523-4aa5-a352-3a981a692a98', name: 'John Doe', age: 30  },
  { id: '907592ee-0523-4aa5-a352-3a981a692a99', name: 'Jane Smith', age: 25 },
  { id: '907592ee-0523-4aa5-a352-3a981a692a97', name: 'Alice Johnson', age: 28  },
  { id: '907592ee-0523-4aa5-a352-3a981a692a96', name: 'Bob Brown', age: 35}  
]