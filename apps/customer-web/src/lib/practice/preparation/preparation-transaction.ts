import type { PracticePreparationKey } from './preparation-key';

/** One explicit Setup command; generation fences late asynchronous work. */
export class PracticePreparationTransaction {
  readonly id = Symbol('Practice preparation command');
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;

  constructor(readonly generation: number, readonly key: PracticePreparationKey) { Object.freeze(this); }

  abort(): void { this.controller.abort(); }
}
