import assert from 'node:assert/strict';
import { p0, p1, classify, confusion, continuousProjection } from './policies.mjs';
import { DIR, accepted, bytes, hash, save, checkScope, isolationBundle, assertGraph, freezeValue, execution, completedRecords } from './core.mjs';
const tests = [];
const check = async (name, fn) => { await fn(); tests.push({ name, status: 'PASS' }); };
await check('accepted V15/source evidence raw SHA identities and no out-of-scope changes', checkScope);
await check('P0 exact equality with normalized sets', () => {
  assert.equal(p0([64, 56, 64], [56, 64]), 'MATCH'); assert.equal(p0([52, 56, 64, 68], [56, 64]), 'MISMATCH');
  assert.equal(p0([], [60]), 'MISMATCH'); assert.throws(() => p0([60], []), /EMPTY_TARGET/);
});
await check('P1 synthetic correct-chord recovery with no confidence threshold', () => assert.equal(p1([52, 56, 64, 68], [56, 64]), 'MATCH'));
await check('P1 synthetic paced repeat recovery', () => {
  assert.deepEqual([[46, 58, 70, 74], [46, 50, 58]].map(o => p1(o, [46, 58])), ['MATCH', 'MATCH']);
});
await check('P1 physical extras intentionally nonblocking for microphone; MIDI exact set rejects', () => {
  assert.equal(p1([52, 56, 64, 68], [56]), 'MATCH'); assert.equal(p0([52, 56, 64, 68], [56]), 'MISMATCH');
  assert.equal(classify('MATCH', [56, 64], [56]).classification, 'TRUE_ACCEPT');
});
await check('P1 missing required target remains rejected', () => assert.equal(p1([52, 56, 64, 68], [21, 56, 64]), 'MISMATCH'));
await check('P1 wrong semitone remains rejected', () => assert.equal(p1([52, 56, 64, 68], [56, 63]), 'MISMATCH'));
await check('P1 wrong-octave coverage is a dangerous false acceptance under physical truth', () => {
  const verdict = p1([52, 56, 64, 68], [52, 56]); assert.equal(verdict, 'MATCH');
  assert.deepEqual(classify(verdict, [56, 64], [52, 56]), { fullPhysicalSupport: false, classification: 'FALSE_ACCEPT' });
});
await check('ground truth never derived from acoustic target presence', () => {
  assert.equal(classify('MATCH', [60], [72]).classification, 'FALSE_ACCEPT');
  assert.equal(classify('MISMATCH', [72], [72]).classification, 'FALSE_REJECT');
  assert.equal(classify('MISMATCH', [60], [72]).classification, 'TRUE_REJECT');
  assert.equal(classify('MATCH', [72], [72]).classification, 'TRUE_ACCEPT');
  assert.deepEqual(confusion(['TRUE_ACCEPT', 'FALSE_REJECT', 'TRUE_REJECT', 'FALSE_ACCEPT'].map(classification => ({ classification }))),
    { TRUE_ACCEPT: 1, FALSE_REJECT: 1, TRUE_REJECT: 1, FALSE_ACCEPT: 1 });
});
await check('invalid pitches rejected; no empty-target or invented RETRY policy', () => {
  assert.throws(() => p1([NaN], [60])); assert.throws(() => p1([128], [60]));
  assert.equal(p1([], [60]), 'MISMATCH'); assert.throws(() => p1([60], []));
});
const { module: { sameTargetHarness }, inputGraph } = await isolationBundle();
function firstMatch() {
  const h = sameTargetHarness(), first = h.runtime.openAttempt(h.time(100));
  assert.ok(first); h.runtime.analyzeAttempt(first);
  const result = h.runtime.completeAttempt(first, { kind: 'EVIDENCE', confidence: 1, observedAttackPitches: ['C4'], captureEndSessionTime: h.time(150) });
  assert.equal(result.record.verdict, 'MATCH'); return { ...h, first };
}
await check('same C4 target coverage could match twice, but non-READY cannot create attempt2', () => {
  const h = sameTargetHarness(), id = h.runtime.openAttempt(h.time(100));
  assert.equal(p1([60], [60]), 'MATCH'); assert.equal(h.runtime.openAttempt(h.time(160)), null);
  h.runtime.analyzeAttempt(id); assert.equal(h.runtime.openAttempt(h.time(170)), null);
  h.runtime.completeAttempt(id, { kind: 'EVIDENCE', confidence: 1, observedAttackPitches: ['C4'], captureEndSessionTime: h.time(150) });
  assert.equal(h.runtime.snapshot().step.attemptState, 'POST_VERDICT'); assert.equal(h.runtime.openAttempt(h.time(180)), null);
  assert.equal(h.runtime.currentTarget().targetGeneration, 1);
});
await check('same-target late timestamp after READY cannot satisfy second target', () => {
  const h = firstMatch(); h.runtime.rearm(h.time(200));
  assert.equal(h.runtime.currentTarget().targetGeneration, 2); assert.equal(h.runtime.openAttempt(h.time(100)), null);
  assert.equal(h.runtime.snapshot().step.attempts.length, 1); assert.equal(h.runtime.isCompleted, false);
});
await check('exact retirement watermark equality stays ineligible', () => {
  const h = firstMatch(); h.runtime.rearm(h.time(200)); assert.equal(h.runtime.openAttempt(h.time(200)), null);
  assert.ok(h.runtime.openAttempt(h.time(201)));
});
await check('delayed duplicate publication preserves source time, never becomes fresh input', () => {
  const observation = Object.freeze({ observationId: 'same-sealed-observation', sourceTime: 100, pitch: 60 });
  const h = firstMatch(); h.runtime.rearm(h.time(200));
  for (const receiptAt of [201, 500, 900]) {
    h.clock.set(receiptAt); assert.equal(p1([observation.pitch], [60]), 'MATCH');
    assert.equal(h.runtime.openAttempt(h.time(observation.sourceTime)), null);
  }
  assert.equal(h.runtime.snapshot().step.attempts.length, 1);
});
await check('duplicate observation ID is not a new physical gesture; no source-time rewrite', () => {
  const original = Object.freeze({ id: 'o1', sourceTime: 100 }); const receipts = [original, { ...original }];
  const h = firstMatch(); h.runtime.rearm(h.time(200));
  for (const o of receipts) assert.equal(h.runtime.openAttempt(h.time(o.sourceTime)), null);
  // This checks the immutable producer-identity contract, not a new production ID ledger.
  const preserved = o => { assert.equal(o.id, original.id); assert.equal(o.sourceTime, original.sourceTime); };
  preserved(receipts[1]); assert.throws(() => preserved({ id: 'o1', sourceTime: 201 }));
});
await check('old target-generation identity cannot complete a fresh same-target attempt', () => {
  const h = firstMatch(); h.runtime.rearm(h.time(200)); const second = h.runtime.openAttempt(h.time(201));
  assert.notEqual(h.first.attemptId, second.attemptId); assert.equal(h.runtime.analyzeAttempt(h.first), false);
  h.runtime.analyzeAttempt(second);
  assert.equal(h.runtime.completeAttempt(h.first, { kind: 'EVIDENCE', confidence: 1, observedAttackPitches: ['C4'], captureEndSessionTime: h.time(251) }).kind, 'REJECTED');
  h.runtime.completeAttempt(second, { kind: 'EVIDENCE', confidence: 1, observedAttackPitches: ['C4'], captureEndSessionTime: h.time(251) });
  assert.equal(h.runtime.isCompleted, false); h.runtime.rearm(h.time(300)); assert.equal(h.runtime.isCompleted, true);
});
await check('policy module and domain test graph have zero acoustic/model/decoder reachability', async () => {
  assertGraph(inputGraph);
  assert.throws(() => assertGraph(['apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts']));
  assert.ok(!(await bytes(DIR + '/policies.mjs')).toString().includes('import '));
  assert.ok(Object.values(execution).every(n => n === 0));
});
const observation = (id, source = 'ACOUSTIC') => ({ observationId: id, source, pitch: 'C4', performanceTimeMs: 100, confidence: .8 });
function evaluation(source = 'ACOUSTIC') {
  const matched = { state: 'MATCHED', match: { observation: observation('matched', source), timingOffsetMs: -10 } };
  const missing = { state: 'MISSING' };
  return { status: 'COMPLETE', groups: [{ verdict: 'WRONG', strikes: [matched, missing], wrongObservations: [observation('wrong', source)], finality: {} }],
    extras: [{ observation: observation('extra', source), finality: {} }],
    observationOwnership: [{ observationId: 'matched', disposition: 'MATCHED' }, { observationId: 'wrong', disposition: 'WRONG' }, { observationId: 'extra', disposition: 'EXTRA' }], completion: {} };
}
await check('Continuous C1 never mutates finalized ownership, matches, extras or timing', () => {
  const e = freezeValue(evaluation()), before = JSON.stringify(e), C0 = continuousProjection(e, 'MICROPHONE', 'C0'), C1 = continuousProjection(e, 'MICROPHONE', 'C1');
  assert.equal(JSON.stringify(e), before); assert.deepEqual(C0.internalCategoryCounts, C1.internalCategoryCounts);
  assert.deepEqual(C0.targetStrikeRecall, C1.targetStrikeRecall); assert.deepEqual(C0.chordCompleteness, C1.chordCompleteness);
  assert.deepEqual(C0.timing, C1.timing); assert.equal(C0.strongNegativeCount, 3); assert.equal(C1.strongNegativeCount, 1);
  assert.equal(C1.reportCategoryCounts.POSSIBLE_UNMATCHED_ACOUSTIC, 2);
  assert.equal(e.observationOwnership.length, 3); assert.equal(e.extras.length, 1);
});
await check('MIDI keeps exact ownership interpretation while microphone weakens unmatched claims', () => {
  const midi = continuousProjection(evaluation('MIDI'), 'MIDI', 'C1'), mic = continuousProjection(evaluation(), 'MICROPHONE', 'C1');
  assert.equal(midi.reportCategoryCounts.WRONG, 1); assert.equal(midi.reportCategoryCounts.EXTRA, 1);
  assert.equal(midi.strongNegativeCount, 3); assert.equal(mic.reportCategoryCounts.WRONG, 0); assert.equal(mic.reportCategoryCounts.EXTRA, 0);
});
await check('Continuous finality required; no score formula or provisional physical-key claim invented', () => {
  assert.throws(() => continuousProjection({ status: 'UNAVAILABLE' }, 'MICROPHONE', 'C1'));
  const p = continuousProjection(evaluation(), 'MICROPHONE', 'C1'); assert.match(p.finalScore, /NOT_COMPARABLE/);
  assert.equal(p.currentWiredFeedback.directExtraObservationAnnotation, 'NOT_CURRENTLY_WIRED');
});
await check('Continuous finalizer retains residual EXTRA ownership and unresolved-reservation guard', async () => {
  const source = (await bytes('apps/customer-web/src/lib/practice/local-core/continuous-finalizer.ts')).toString();
  assert.ok(source.includes("this.claim(observation, 'EXTRA'")); assert.ok(source.includes("throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION')"));
});
await check('all explicitly accepted source SHA values are valid 64-char identities', () => {
  assert.ok(Object.values(accepted).every(s => /^[0-9a-f]{64}$/.test(s)));
});
await check('controller publication count is not substituted for a retained publication array', () => {
  const rows = completedRecords({ cells: [{ id: 'synthetic', rate: 48000, scenarios: [{ family: 'CORRECT', completed: {} }] }] },
    { results: [{ id: 'synthetic', rate: 48000, publications: [] }], controllerResult: { engineering: { microphone: { publications: 11 } } } });
  assert.equal(rows.length, 1); assert.ok(Array.isArray(rows[0].publications)); assert.ok(rows.every(r => r.family !== 'CONTROLLER'));
});
await save('research-tests-v2.json', { passed: tests.length, failed: 0, tests, inputGraph,
  fixtureScope: 'SYNTHETIC_UNIT_TESTS_ONLY_NO_REAL_P1_OR_C1_COUNTERFACTUAL_ANALYSIS_BEFORE_REMOTE_FREEZE', execution,
  testsAreNotCI: true, policyModuleSha256: hash(await bytes(DIR + '/policies.mjs')) });
console.log(JSON.stringify({ passed: tests.length, failed: 0, inputGraph }));
