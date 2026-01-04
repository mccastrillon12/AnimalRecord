import { ValueObject } from '../../Shared/domain/value-object/ValueObject';

export class PeopleAge extends ValueObject<number> {
  constructor(value: number) {
    super(value);
    this.ensureValueIsDefined(value);
  }
}