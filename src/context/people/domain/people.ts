import { PeopleAge } from "./peopleAge";
import { PeopleId } from "./peopleId";
import { PeopleName } from "./peopleName";

export type PeoplePrimitiveType = {
  id: string;
  name: string;
  age: number;
};

export class People {
  id: PeopleId;
  name: PeopleName;
  age: PeopleAge;

  constructor(
    id: PeopleId,
    name: PeopleName,
    age: PeopleAge
  ) {
    this.id = id;
    this.name = name;
    this.age = age;
  }

  static fromPrimitives(plainData: PeoplePrimitiveType): People {
    return new People(
      new PeopleId(plainData.id),
      new PeopleName(plainData.name),
      new PeopleAge(plainData.age)
    );
  }

  toPrimitives(): PeoplePrimitiveType {
    return {
      id: this.id.value,
      name: this.name.value,
      age: this.age.value
    };
  }



}