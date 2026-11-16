import { runInThisContext } from 'node:vm';

/** Node's abort listener uses the native symbol, which Jest's VM may omit. */
export function restoreNodeDisposeSymbolForSuite() {
  const descriptor = Object.getOwnPropertyDescriptor(Symbol, 'dispose');
  beforeAll(() => {
    if (!descriptor)
      Object.defineProperty(Symbol, 'dispose', {
        value: runInThisContext('Symbol.dispose') as symbol,
        configurable: true,
      });
  });
  afterAll(() => {
    if (!descriptor) Reflect.deleteProperty(Symbol, 'dispose');
  });
}
