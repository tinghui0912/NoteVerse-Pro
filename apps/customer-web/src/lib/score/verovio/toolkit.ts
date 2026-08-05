import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

import type { VerovioToolkitFactory } from './types';

let modulePromise: ReturnType<typeof createVerovioModule> | null = null;

export const createVerovioToolkit: VerovioToolkitFactory = async () => {
  modulePromise ??= createVerovioModule();
  const verovioModule = await modulePromise;

  // The WASM module is immutable runtime state; every viewer owns a toolkit instance.
  return new VerovioToolkit(verovioModule);
};
