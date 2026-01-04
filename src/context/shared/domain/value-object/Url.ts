import { ValueObject } from './ValueObject';

const urlPatter =
  /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)$/i;

export class Url extends ValueObject<string> {
  constructor(value: string) {
    super(value);
    value && this.ensureIsValidUrl(value);
  }

  private ensureIsValidUrl(url: string): void {
    if (!urlPatter.test(url)) {
      throw new Error(`<${this.value}> is not a valid url`);
    }
  }
}
