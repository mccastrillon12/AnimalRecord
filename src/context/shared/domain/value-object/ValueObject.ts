type Primitives = string | number | boolean | Date | string[];

export abstract class ValueObject<T extends Primitives> {
  readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  protected ensureValueIsDefined(value: T): void {
    if (value === null || value === undefined) {
      throw new Error('Value must be defined');
    }
  }

  equals(other: ValueObject<T>): boolean {
    return (
      other.constructor.name === this.constructor.name &&
      other.value === this.value
    );
  }

  toString(): string {
    return this.value.toString();
  }
}
