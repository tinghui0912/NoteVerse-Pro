import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedCellWitness, modelRunAccounting } from './execution-accounting.mjs';
test('failed-cell JSON witness is retained instead of discarding completed real executions', () => {
  const witness = { reason: 'RESOURCE', engineering: { microphone: { runtime: { outstanding: 0,
    counts: { windowsStarted: 2, windowsPublished: 2 }, diagnostics: [{ actualSessionRunCount: 2 }] } } } };
  const parsed = failedCellWitness('page.evaluate: Error: ' + JSON.stringify(witness) + '\n at stack');
  assert.deepEqual(parsed, witness);
  assert.deepEqual(modelRunAccounting([{ state: 'FAILED', failureWitness: parsed }, { state: 'NOT_STARTED' }]),
    { actualModelRuns: 2, modelRunCountComplete: true });
});
test('unobserved in-flight execution is explicitly incomplete, never guessed', () => {
  assert.deepEqual(modelRunAccounting([{ state: 'FAILED' }]), { actualModelRuns: 0, modelRunCountComplete: false });
});
