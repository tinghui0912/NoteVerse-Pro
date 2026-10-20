import assert from 'node:assert/strict';
const STATES = ['INIT', 'RESULT_LOCAL_COMMITTED', 'RESULT_PUSH_STARTED', 'RESULT_PUSH_EXITED_SUCCESS',
  'RESULT_FETCH_STARTED', 'RESULT_REMOTE_VERIFIED', 'RESULT_GITHUB_QUERIED', 'RESULT_PROOF_WRITTEN',
  'RECEIPT_LOCAL_COMMITTED', 'RECEIPT_PUSH_STARTED', 'RECEIPT_PUSH_EXITED_SUCCESS', 'RECEIPT_FETCH_STARTED',
  'FINAL_REMOTE_VERIFIED', 'FINAL_GITHUB_QUERIED', 'TERMINAL_COMPLETE'];
export class CloseoutMachine {
  state = 'INIT'; events = []; failed = false;
  move(next) {
    assert.equal(this.failed, false, 'NO_RETRY');
    if (STATES.indexOf(next) !== STATES.indexOf(this.state) + 1) { this.failed = true; throw Error('CLOSEOUT_ORDER'); }
    this.state = next; this.events.push({ state: next, at: new Date().toISOString() });
  }
  writeAllowed() { assert.ok(!this.failed && STATES.indexOf(this.state) < STATES.indexOf('FINAL_REMOTE_VERIFIED')); }
  async push(kind, fn) {
    this.move(kind + '_PUSH_STARTED');
    try { assert.equal(await fn(), 0); this.move(kind + '_PUSH_EXITED_SUCCESS'); }
    catch (error) { this.failed = true; throw error; }
  }
  async fetch(kind, fn) {
    this.move(kind + '_FETCH_STARTED');
    try { assert.equal(await fn(), 0); } catch (error) { this.failed = true; throw error; }
  }
}
export async function closeoutTests() {
  const tests = [], test = async (name, fn) => { await fn(); tests.push({ name, result: 'PASS' }); };
  await test('slow push prevents fetch before execution', async () => {
    const m = new CloseoutMachine(); m.move('RESULT_LOCAL_COMMITTED');
    let resolve, fetched = false;
    const pending = m.push('RESULT', () => new Promise(r => { resolve = r; }));
    await assert.rejects(m.fetch('RESULT', () => { fetched = true; return 0; }));
    assert.equal(fetched, false); resolve(0); await assert.rejects(pending);
  });
  await test('failed push is permanent', async () => {
    const m = new CloseoutMachine(); m.move('RESULT_LOCAL_COMMITTED'); await assert.rejects(m.push('RESULT', () => 1));
    await assert.rejects(m.fetch('RESULT', () => 0));
  });
  await test('full monotonic sequence and no terminal writes', async () => {
    const m = new CloseoutMachine(); m.move('RESULT_LOCAL_COMMITTED');
    await m.push('RESULT', () => 0); await m.fetch('RESULT', () => 0);
    m.move('RESULT_REMOTE_VERIFIED'); m.move('RESULT_GITHUB_QUERIED'); m.move('RESULT_PROOF_WRITTEN');
    m.move('RECEIPT_LOCAL_COMMITTED'); await m.push('RECEIPT', () => 0); await m.fetch('RECEIPT', () => 0);
    m.move('FINAL_REMOTE_VERIFIED'); assert.throws(() => m.writeAllowed());
    m.move('FINAL_GITHUB_QUERIED'); m.move('TERMINAL_COMPLETE');
  });
  await test('fetch failure blocks later states', async () => {
    const m = new CloseoutMachine(); m.move('RESULT_LOCAL_COMMITTED'); await m.push('RESULT', () => 0);
    await assert.rejects(m.fetch('RESULT', () => 1)); assert.throws(() => m.move('RESULT_REMOTE_VERIFIED'));
  });
  return tests;
}
