import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRuntimeDiagnostic as classify } from './continuous-runtime-diagnostics.mjs';
test('only exact attributed pinned ORT warnings with verified WebGPU identity are nonblocking', () => {
  const row = { type: 'error', location: { url: 'http://localhost/ort/ort-wasm-simd-threaded.jsep.mjs' },
    text: '[W:onnxruntime:, session_state.cc:1168 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers' };
  const model = { executionProvider: 'webgpu', automaticFallback: false, ortWebVersion: '1.20.1' };
  assert.equal(classify(row, model), 'DEPENDENCY_DIAGNOSTIC_NON_BLOCKING');
  assert.equal(classify(row, { ...model, executionProvider: 'wasm' }), 'BLOCKING_DIAGNOSTIC');
  assert.equal(classify(row, { ...model, automaticFallback: true }), 'BLOCKING_DIAGNOSTIC');
  assert.equal(classify({ ...row, text: 'ReferenceError: window is not defined' }, model), 'BLOCKING_DIAGNOSTIC');
  assert.equal(classify({ ...row, location: { url: '/worker.js' } }, model), 'BLOCKING_DIAGNOSTIC');
  assert.equal(classify({ type: 'failed-response', status: 403 }, model), 'BLOCKING_DIAGNOSTIC');
});
