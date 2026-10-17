import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateStatus } from './protocol.mjs';
test('untouched gate is NOT_STARTED', () => assert.equal(gateStatus([{ state: 'NOT_STARTED' }]), 'NOT_STARTED'));
test('partial failure is never reported as NOT_STARTED', () => {
  assert.equal(gateStatus([{ state: 'PASS' }, { state: 'FAILED' }, { state: 'NOT_STARTED' }]), 'PARTIAL_EXECUTION_BLOCKED');
});
test('PASS requires every cell', () => {
  assert.equal(gateStatus([{ state: 'PASS' }, { state: 'NOT_STARTED' }]), 'PARTIAL_EXECUTION_BLOCKED');
  assert.equal(gateStatus([{ state: 'PASS' }, { state: 'PASS' }]), 'PASS');
});
