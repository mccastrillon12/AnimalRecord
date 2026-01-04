import { ValueObject } from './ValueObject';

export class StringValueObject extends ValueObject<string> {
  constructor(value: string) {
    super(value);
    this.ensureLengthIsValidCharacters(value);
  }

  private ensureLengthIsValidCharacters(value: string) {
    if (!value.length) {
      throw new Error('The Key People Email should have at least 1 character');
    }
  }
}
