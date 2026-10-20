import assert from 'node:assert/strict';
import { CloseoutMachine, STATES, serializedCloseout } from './closeout-machine.mjs';

const R = '1'.repeat(40), P = '2'.repeat(40);
const identity = head => ({ localHead: head, originTrackingHead: head, lsRemoteHead: head, aheadBehind: [0, 0], cleanWorktree: true });
const checks = head => ({ head, statuses: [], workflow_runs: [], ciInterpretation: 'NOT CI PASS' });
function fixture() {
  const calls = [], machine = new CloseoutMachine(() => String(calls.length));
  const ports = {
    commitResult: async () => { calls.push('commit-result'); return R; },
    commitReceipt: async () => { calls.push('commit-receipt'); return P; },
    push: async () => { calls.push('push-start'); calls.push('push-exit'); return { exitCode: 0 }; },
    fetch: async () => { calls.push('fetch'); return { exitCode: 0 }; },
    verifyResult: async () => identity(R), verifyReceipt: async () => identity(P),
    github: async head => { calls.push('github:' + head); return checks(head); },
    writeResultProof: async () => { machine.assertWriteAllowed(); calls.push('write-proof'); }
  };
  return { machine, ports, calls };
}
export async function closeoutTests() {
  const results = [], test = async (name, fn) => { await fn(); results.push({ name, result: 'LOCAL_PASS_SYNTHETIC_ONLY' }); };
  await test('A/H successful result and receipt push exits precede each fetch; terminal protocol is self-reference safe', async () => {
    const f = fixture(), r = await serializedCloseout(f.machine, f.ports);
    assert.equal(r.state, 'TERMINAL_COMPLETE');
    const states = f.machine.events.map(e => e.state); assert.deepEqual(states, STATES.slice(1));
    for (const kind of ['RESULT', 'RECEIPT']) assert.ok(states.indexOf(kind + '_PUSH_EXITED_SUCCESS') < states.indexOf(kind + '_FETCH_STARTED'));
    for (const [i, op] of f.calls.entries()) if (op === 'fetch') assert.equal(f.calls[i - 1], 'push-exit');
    assert.equal(f.calls.filter(c => c.startsWith('commit')).length, 2);
    assert.equal(f.calls.filter(c => c === 'write-proof').length, 1);
  });
  await test('B slow pending push prevents fetch until process completion', async () => {
    const f = fixture(); let release, firstEntered, receiptEntered, pushCount = 0;
    const first = new Promise(resolve => { firstEntered = resolve; });
    const receipt = new Promise(resolve => { receiptEntered = resolve; });
    f.ports.push = () => new Promise(resolve => { release = resolve; pushCount++; if (pushCount === 1) firstEntered(); else receiptEntered(); });
    const campaign = serializedCloseout(f.machine, f.ports);
    // Only synthetic scheduling: no subprocess, browser, worker or product runtime.
    await first;
    assert.equal(f.machine.state, 'RESULT_PUSH_STARTED'); assert.ok(!f.calls.includes('fetch'));
    release({ exitCode: 0 });
    await receipt;
    assert.equal(f.machine.state, 'RECEIPT_PUSH_STARTED');
    assert.equal(f.calls.filter(c => c === 'fetch').length, 1);
    release({ exitCode: 0 }); await campaign;
    assert.equal(f.calls.filter(c => c === 'fetch').length, 2);
  });
  await test('C nonzero push exit permanently blocks with no fetch or second attempt', async () => {
    const f = fixture(); f.ports.push = async () => ({ exitCode: 1 });
    await assert.rejects(serializedCloseout(f.machine, f.ports), /PUSH_NONZERO_EXIT/);
    assert.ok(!f.calls.includes('fetch'));
    await assert.rejects(f.machine.push('RESULT', f.ports.push), /NO_RETRY/);
  });
  await test('D failed fetch permanently blocks', async () => {
    const f = fixture(); f.ports.fetch = async () => ({ exitCode: 1 });
    await assert.rejects(serializedCloseout(f.machine, f.ports), /FETCH_NONZERO_EXIT/);
    await assert.rejects(f.machine.fetch('RESULT', f.ports.fetch), /NO_RETRY/);
  });
  for (const [name, field, value, error] of [
    ['E tracking HEAD mismatch', 'originTrackingHead', P, /ORIGIN_TRACKING/],
    ['F ls-remote mismatch', 'lsRemoteHead', P, /LS_REMOTE/],
    ['G ahead behind mismatch', 'aheadBehind', [1, 0], /AHEAD_BEHIND/],
    ['local expected HEAD mismatch', 'localHead', P, /LOCAL_HEAD/],
    ['dirty final worktree', 'cleanWorktree', false, /WORKTREE_NOT_CLEAN/]
  ]) await test(name, async () => {
    const f = fixture(); f.ports.verifyResult = async () => ({ ...identity(R), [field]: value });
    await assert.rejects(serializedCloseout(f.machine, f.ports), error);
    assert.ok(f.machine.failure); assert.ok(!f.calls.some(c => c.startsWith('github')));
  });
  await test('I final GitHub query cannot start before FINAL_REMOTE_VERIFIED', async () => {
    const f = fixture(); let queried = false;
    await assert.rejects(f.machine.github('RECEIPT', async () => { queried = true; return checks(P); }), /GITHUB_QUERY_BEFORE/);
    assert.equal(queried, false);
  });
  await test('J tracked writes and commits after final verification are forbidden', async () => {
    const f = fixture(); await serializedCloseout(f.machine, f.ports);
    assert.throws(() => f.machine.assertWriteAllowed(), /NO_TRACKED_WRITE/);
    await assert.rejects(f.machine.commit('RESULT', f.ports.commitResult), /NO_RETRY/);
  });
  await test('K mandatory failure has no retry transition', async () => {
    const f = fixture(); f.ports.push = async () => { throw Error('NETWORK_FAILURE'); };
    await assert.rejects(serializedCloseout(f.machine, f.ports), /NETWORK_FAILURE/);
    assert.throws(() => f.machine.move('RESULT_PUSH_EXITED_SUCCESS'), /NO_RETRY/);
  });
  await test('L V33-style fetch while push pending is rejected before fetch execution', async () => {
    const f = fixture(); await f.machine.commit('RESULT', f.ports.commitResult);
    let release, fetchExecuted = false;
    const pending = f.machine.push('RESULT', () => new Promise(resolve => { release = resolve; }));
    await assert.rejects(f.machine.fetch('RESULT', async () => { fetchExecuted = true; return { exitCode: 0 }; }), /FETCH_BEFORE_PUSH_EXIT/);
    assert.equal(fetchExecuted, false); release({ exitCode: 0 });
    await assert.rejects(pending, /NO_RETRY/);
  });
  await test('GitHub query failure is terminal and cannot produce a PASS or tracked final proof', async () => {
    const f = fixture(); f.ports.github = async () => { throw Error('GITHUB_QUERY_FAILED'); };
    await assert.rejects(serializedCloseout(f.machine, f.ports), /GITHUB_QUERY_FAILED/);
    assert.ok(!f.calls.includes('write-proof')); assert.ok(f.machine.failure);
  });
  return results;
}
