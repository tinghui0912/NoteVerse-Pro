import { expect, it } from 'vitest';
import { PracticeResourceCoordinator } from './practice-resource-coordinator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it('keeps all prior disposal and late preparation pending across successive releases', async () => {
  const resources = new PracticeResourceCoordinator();
  const disposal = deferred(), preparation = deferred(), nextDisposal = deferred();
  resources.trackRelease(disposal.promise, preparation.promise);
  const waiting = resources.trackRelease(nextDisposal.promise, null, undefined);
  expect(resources.waitForRelease()).toBe(waiting);
  let released = false;
  void waiting.then(() => { released = true; });
  disposal.resolve(); nextDisposal.resolve();
  await Promise.resolve(); await Promise.resolve();
  expect(released).toBe(false);
  preparation.resolve(); await waiting;
  expect(released).toBe(true);
});

it('does not let a failed release become a successful acquisition boundary', async () => {
  const resources = new PracticeResourceCoordinator();
  const failure = new Error('release failed');
  await expect(resources.trackRelease(Promise.reject(failure))).rejects.toBe(failure);
  await expect(resources.trackRelease(Promise.resolve())).rejects.toBe(failure);
});
