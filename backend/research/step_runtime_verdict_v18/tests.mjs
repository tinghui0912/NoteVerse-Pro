import assert from 'node:assert/strict';
import { DIR, OUT, input, execution, bytes, load, save, domain, scope, assertGraph } from './audit.mjs';

const mode = process.argv[2], tests = [];
async function check(name, fn) { await fn(); tests.push({ name, status: 'PASS' }); }
if (mode === 'pre') {
  await check('accepted V15/V16/V17 identities and allowed change scope', scope);
  const d = await domain();
  await check('domain executable graph cannot reach acoustic model/decoder/Worker', () => {
    assertGraph(d.graph); assert.throws(() => assertGraph(['apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts']));
    assert.throws(() => assertGraph(['backend/research/step_microphone_tristate_v17/policy.mjs']));
  });
  await check('replay contains one unconditional ordinary EVIDENCE construction, no external P2', async () => {
    const source = (await bytes(DIR + '/audit.mjs')).toString();
    assert.equal((source.match(/kind: 'EVIDENCE'/g) ?? []).length, 1);
    assert.ok(!source.includes("kind: 'RETRY'")); assert.ok(!/\bp2\(/.test(source));
    assert.ok(!/from ['"].*(?:policy|onnx|decoder|v17\/)/.test(source));
    assert.ok(source.indexOf('h.owner.completeAttempt(identity, evidence)') < source.indexOf('record.verdict !== old.P2.verdict'));
  });
  await check('source policy is runtime-owned and no caller-selectable parameter exists', async () => {
    const s = (await bytes('apps/customer-web/src/lib/practice/local-core/step-runtime.ts')).toString();
    assert.ok(s.includes("expected.every(pitch => pitches.includes(pitch))"));
    assert.ok(s.includes('get verdictPolicy(): StepVerdictPolicy'));
    assert.ok(!s.slice(s.indexOf('export type StepPracticeRuntimeOptions'), s.indexOf('export type StepAttemptCompletion')).includes('verdictPolicy'));
  });
  await check('controller remains generic forwarding owner and microphone startup disabled', async () => {
    const s = (await bytes('apps/customer-web/src/lib/practice/step/step-practice-controller.ts')).toString();
    assert.ok(s.includes('runtime.completeAttempt(identity, evidence)'));
    assert.ok(s.includes("if (this.options.inputSource === 'MICROPHONE') { this.error = STEP_ANALYSIS_UNAVAILABLE_REASON"));
    assert.ok(!/pitchSetsEqual|MICROPHONE_CONSERVATIVE_TRISTATE|expected\.every/.test(s));
  });
  await check('frozen defaults and all execution counters remain unchanged', async () => {
    const c = await load(DIR + '/contract.json');
    assert.deepEqual([c.acousticBaseline.sampleRateHz, c.acousticBaseline.inputSamples, c.acousticBaseline.inputMs], [16000, 29120, 1820]);
    assert.deepEqual([c.acousticBaseline.onset, c.acousticBaseline.frame, c.acousticBaseline.ownedMs,
      c.acousticBaseline.pastMs, c.acousticBaseline.futureMs], [.30, .05, 600, 1050, 170]);
    assert.ok(Object.values(execution).every(v => v === 0));
  });
  await save('research-tests.json', { mode, passed: tests.length, failed: 0, tests, graph: d.graph, execution, localNotCI: true });
} else if (mode === 'post') {
  const result = await load(OUT + '/runtime-replay-results.json');
  await check('34 complete ordinary-EVIDENCE attempts, no precomputed RETRY', () => {
    assert.equal(result.rows.length, 34); assert.equal(result.cells.length, 22);
    assert.deepEqual(result.submittedEvidenceKinds, { EVIDENCE: 34, RETRY: 0 });
    assert.equal(result.externalP2Executions, 0);
  });
  await check('every actual runtime row matches immutable V17 after finalization', async () => {
    const original = await load(input.v17);
    for (const row of result.rows) {
      const old = original.rows.find(r => r.rowId === row.rowId); assert.ok(old);
      assert.equal(row.productRecord.verdict, old.P2.verdict); assert.equal(row.productRecord.retryReason, old.P2.reason);
      assert.equal(row.classification, old.classification);
    }
  });
  await check('exact aggregate verdicts and physical classes reproduce V17', () => {
    assert.deepEqual(result.overall, { verdicts: { MATCH: 8, RETRY: 14, MISMATCH: 12 },
      classifications: { SAFE_MATCH: 8, DANGEROUS_FALSE_MATCH: 0, SUPPORTED_RETRY: 12, UNSUPPORTED_RETRY: 2, TRUE_REJECT: 12, FALSE_REJECT: 0 } });
  });
  await check('14 runtime-generated RETRY records retain every original pitch/confidence/boundary', () => {
    const retry = result.rows.filter(r => r.productRecord.verdict === 'RETRY'); assert.equal(retry.length, 14);
    for (const r of retry) {
      assert.equal(r.submittedEvidence.kind, 'EVIDENCE'); assert.ok(r.productRecord.observedAttackPitches.length);
      assert.deepEqual(r.productRecord.observedAttackPitches, [...new Set(r.submittedEvidence.observedAttackPitches)].sort());
      assert.equal(r.productRecord.confidence, r.submittedEvidence.confidence);
      assert.deepEqual(r.productRecord.captureEndSessionTime, r.submittedEvidence.captureEndSessionTime);
      assert.equal(r.productRecord.retryReason, 'UNCERTAIN');
    }
  });
  await check('rearm alone advances MATCH; RETRY retains target and all snapshots are v6', () => {
    for (const r of result.rows) {
      const { ready, postVerdict, rearmed } = r.domainTrace;
      assert.equal(ready.version.schemaVersion, 6); assert.equal(postVerdict.step.attemptState, 'POST_VERDICT');
      assert.equal(postVerdict.step.targetGeneration, ready.step.targetGeneration);
      assert.equal(rearmed.step.targetGeneration, ready.step.targetGeneration + (r.productRecord.verdict === 'MATCH' ? 1 : 0));
    }
  });
  await check('prospective remote proof precedes unique replay; all acoustic counters zero', async () => {
    const complete = await load(OUT + '/replay-complete.json'); assert.equal(complete.replayExecutions, 1);
    assert.ok(result.proof.remoteVerifiedAt < complete.startedAt); assert.ok(Object.values(result.execution).every(v => v === 0));
  });
  await save('replay-tests.json', { mode, passed: tests.length, failed: 0, tests,
    scope: 'Assertions over stored once-produced results only; not a second runtime replay', execution, localNotCI: true });
} else throw Error('Only pre/post deterministic tests; never acoustic execution.');
console.log(JSON.stringify({ mode, passed: tests.length, failed: 0 }));
