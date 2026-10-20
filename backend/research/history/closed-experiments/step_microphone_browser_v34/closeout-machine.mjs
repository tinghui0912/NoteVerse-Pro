import assert from 'node:assert/strict';

export const STATES = ['INIT', 'RESULT_LOCAL_COMMITTED', 'RESULT_PUSH_STARTED', 'RESULT_PUSH_EXITED_SUCCESS',
  'RESULT_FETCH_STARTED', 'RESULT_REMOTE_VERIFIED', 'RESULT_GITHUB_QUERIED', 'RESULT_PROOF_WRITTEN',
  'RECEIPT_LOCAL_COMMITTED', 'RECEIPT_PUSH_STARTED', 'RECEIPT_PUSH_EXITED_SUCCESS', 'RECEIPT_FETCH_STARTED',
  'FINAL_REMOTE_VERIFIED', 'FINAL_GITHUB_QUERIED', 'TERMINAL_COMPLETE'];

export function requireRemoteIdentity(value, expected) {
  assert.equal(value.localHead, expected, 'LOCAL_HEAD_NOT_EXPECTED_COMMIT');
  assert.equal(value.originTrackingHead, expected, 'ORIGIN_TRACKING_HEAD_MISMATCH');
  assert.equal(value.lsRemoteHead, expected, 'LS_REMOTE_HEAD_MISMATCH');
  assert.deepEqual(value.aheadBehind, [0, 0], 'AHEAD_BEHIND_NOT_ZERO');
  assert.equal(value.cleanWorktree, true, 'WORKTREE_NOT_CLEAN');
  return value;
}

export class CloseoutMachine {
  constructor(clock = () => new Date().toISOString()) {
    this.state = 'INIT'; this.clock = clock; this.events = []; this.active = null;
    this.failure = null; this.resultCommit = null; this.receiptCommit = null;
    this.finalRemoteVerified = false;
  }
  stop(error) {
    if (!this.failure) {
      this.failure = { state: this.state, at: this.clock(), error: String(error.stack ?? error) };
      this.events.push({ ...this.failure, state: 'PERMANENT_FAILURE', failedFrom: this.failure.state });
    }
    throw error;
  }
  demand(condition, code) {
    if (this.failure) throw Error('NO_RETRY_AFTER_MANDATORY_FAILURE');
    if (!condition) this.stop(Error(code));
  }
  move(next, details = {}) {
    this.demand(STATES.indexOf(next) === STATES.indexOf(this.state) + 1, 'NON_MONOTONIC_OR_UNAUTHORIZED_TRANSITION:' + next);
    this.state = next; this.events.push({ state: next, at: this.clock(), ...details });
  }
  assertWriteAllowed() {
    this.demand(!this.finalRemoteVerified, 'NO_TRACKED_WRITE_OR_COMMIT_AFTER_FINAL_REMOTE_VERIFIED');
  }
  async operation(label, fn) {
    this.demand(this.active === null, 'OVERLAPPING_OPERATION:' + label);
    this.active = label;
    try { return await fn(); } catch (error) { return this.stop(error); }
    finally { this.active = null; }
  }
  async commit(kind, fn) {
    this.assertWriteAllowed();
    this.demand(this.state === (kind === 'RESULT' ? 'INIT' : 'RESULT_PROOF_WRITTEN'), 'COMMIT_ORDER');
    const head = await this.operation(kind + '_COMMIT', fn);
    this.demand(typeof head === 'string' && /^[0-9a-f]{40}$/.test(head), 'COMMIT_ID_REQUIRED');
    if (kind === 'RESULT') this.resultCommit = head; else this.receiptCommit = head;
    this.move(kind + '_LOCAL_COMMITTED', { commit: head }); return head;
  }
  async push(kind, fn) {
    this.demand(this.state === kind + '_LOCAL_COMMITTED', 'PUSH_ORDER');
    this.move(kind + '_PUSH_STARTED');
    const receipt = await this.operation(kind + '_PUSH', fn);
    this.demand(receipt?.exitCode === 0, 'PUSH_NONZERO_EXIT');
    this.move(kind + '_PUSH_EXITED_SUCCESS', { processReceipt: receipt }); return receipt;
  }
  async fetch(kind, fn) {
    // This check precedes invoking fn, including during a still-pending push.
    this.demand(this.state === kind + '_PUSH_EXITED_SUCCESS' && this.active === null, 'FETCH_BEFORE_PUSH_EXIT_SUCCESS');
    this.move(kind + '_FETCH_STARTED');
    const receipt = await this.operation(kind + '_FETCH', fn);
    this.demand(receipt?.exitCode === 0, 'FETCH_NONZERO_EXIT'); return receipt;
  }
  async verify(kind, fn) {
    this.demand(this.state === kind + '_FETCH_STARTED' && this.active === null, 'REMOTE_VERIFY_BEFORE_FETCH_COMPLETION');
    const result = await this.operation(kind + '_REMOTE_VERIFY', async () => requireRemoteIdentity(await fn(), kind === 'RESULT' ? this.resultCommit : this.receiptCommit));
    const next = kind === 'RESULT' ? 'RESULT_REMOTE_VERIFIED' : 'FINAL_REMOTE_VERIFIED';
    this.move(next, { identity: result });
    if (kind === 'RECEIPT') this.finalRemoteVerified = true;
    return result;
  }
  async github(kind, fn) {
    const expectedState = kind === 'RESULT' ? 'RESULT_REMOTE_VERIFIED' : 'FINAL_REMOTE_VERIFIED';
    this.demand(this.state === expectedState && this.active === null, 'GITHUB_QUERY_BEFORE_REMOTE_VERIFICATION');
    const expected = kind === 'RESULT' ? this.resultCommit : this.receiptCommit;
    const value = await this.operation(kind + '_GITHUB_QUERY', async () => {
      const r = await fn(expected);
      assert.equal(r.head, expected); assert.ok(Array.isArray(r.statuses) && Array.isArray(r.workflow_runs));
      return r;
    });
    this.move(kind === 'RESULT' ? 'RESULT_GITHUB_QUERIED' : 'FINAL_GITHUB_QUERIED'); return value;
  }
  async writeResultProof(fn) {
    this.assertWriteAllowed(); this.demand(this.state === 'RESULT_GITHUB_QUERIED', 'RESULT_PROOF_ORDER');
    await this.operation('RESULT_PROOF_WRITE', fn); this.move('RESULT_PROOF_WRITTEN');
  }
  complete() {
    this.demand(this.state === 'FINAL_GITHUB_QUERIED' && this.active === null, 'TERMINAL_COMPLETION_ORDER');
    this.move('TERMINAL_COMPLETE');
  }
}

export async function serializedCloseout(machine, ports) {
  await machine.commit('RESULT', ports.commitResult);
  await machine.push('RESULT', ports.push);
  await machine.fetch('RESULT', ports.fetch);
  const resultIdentity = await machine.verify('RESULT', ports.verifyResult);
  const resultGitHub = await machine.github('RESULT', ports.github);
  await machine.writeResultProof(() => ports.writeResultProof({ resultIdentity, resultGitHub, events: [...machine.events] }));
  await machine.commit('RECEIPT', ports.commitReceipt);
  await machine.push('RECEIPT', ports.push);
  await machine.fetch('RECEIPT', ports.fetch);
  const finalIdentity = await machine.verify('RECEIPT', ports.verifyReceipt);
  const finalGitHub = await machine.github('RECEIPT', ports.github);
  machine.complete();
  return { resultCommit: machine.resultCommit, receiptCommit: machine.receiptCommit, finalIdentity, finalGitHub,
    state: machine.state, events: machine.events, noTrackedWritesAfterFinalVerification: true, noSelfReferenceCommit: true };
}
