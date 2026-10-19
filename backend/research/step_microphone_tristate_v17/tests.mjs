import assert from 'node:assert/strict';
import { p2, physicalClass, groupPhysical, usability, reopen, stable, digest } from './policy.mjs';
import { DIR, bytes, save, checkScope, continuousUnchanged, bundleDomain, assertGraph, execution } from './core.mjs';
const tests = [], check = async (name, fn) => { await fn(); tests.push({ name, status: 'PASS' }); };
await check('immutable input identities and scope', checkScope);
await check('P2 exact normalized set -> MATCH', () => assert.deepEqual(p2([64, 56, 56], [56, 64]), { verdict: 'MATCH', reason: null }));
await check('P2 covered + any extra -> RETRY UNCERTAIN', () => assert.deepEqual(p2([52, 56, 64, 68], [56, 64]), { verdict: 'RETRY', reason: 'UNCERTAIN' }));
await check('P2 missing required pitch -> MISMATCH', () => assert.equal(p2([52, 56, 64, 68], [21, 56, 64]).verdict, 'MISMATCH'));
await check('P2 wrong semitone -> MISMATCH', () => assert.equal(p2([52, 56, 64, 68], [56, 63]).verdict, 'MISMATCH'));
await check('wrong-octave witness -> unsupported RETRY, never false MATCH', () => {
  const r = p2([52, 56, 64, 68], [52, 56]); assert.equal(r.verdict, 'RETRY');
  assert.equal(physicalClass(r, [56, 64], [52, 56]).classification, 'UNSUPPORTED_RETRY');
});
await check('correct chord -> supported RETRY', () => assert.equal(physicalClass(p2([52, 56, 64, 68], [56, 64]), [56, 64], [56, 64]).classification, 'SUPPORTED_RETRY'));
await check('post-ready repeated evidence -> RETRY/RETRY', () => assert.deepEqual([[46, 58, 70, 74], [46, 50, 58]].map(o => p2(o, [46, 58]).verdict), ['RETRY', 'RETRY']));
await check('correct single remains SAFE_MATCH', () => assert.equal(physicalClass(p2([64], [64]), [64], [64]).classification, 'SAFE_MATCH'));
await check('dangerous automatic MATCH classifier is not suppressed', () => assert.equal(physicalClass(p2([52, 56], [52, 56]), [56, 64], [52, 56]).classification, 'DANGEROUS_FALSE_MATCH'));
await check('RETRY is not coerced into binary confusion classes', () => {
  assert.equal(physicalClass(p2([60, 72], [60]), [60], [60]).classification, 'SUPPORTED_RETRY');
  assert.equal(physicalClass(p2([60, 72], [72]), [60], [72]).classification, 'UNSUPPORTED_RETRY');
});
await check('empty evidence mismatches; invalid input/empty target rejected', () => {
  assert.equal(p2([], [60]).verdict, 'MISMATCH'); assert.throws(() => p2([NaN], [60])); assert.throws(() => p2([60], []));
});
const { module: domain, graph } = await bundleDomain();
await check('existing runtime accepts RETRY UNCERTAIN, POST_VERDICT then explicit rearm', () => {
  const h = domain.runtime([[60], [60]], 'retry-unit');
  for (let i = 0; i < 3; i++) {
    const id = h.owner.openAttempt(h.time(i * 1000 + 100)); assert.ok(id); h.owner.analyzeAttempt(id);
    const r = h.owner.completeAttempt(id, { kind: 'RETRY', reason: 'UNCERTAIN', captureEndSessionTime: h.time(i * 1000 + 150) });
    assert.equal(r.record.verdict, 'RETRY'); assert.equal(r.record.retryReason, 'UNCERTAIN');
    assert.equal(h.owner.snapshot().step.attemptState, 'POST_VERDICT'); assert.equal(h.owner.currentTarget().targetGeneration, 1);
    assert.equal(h.owner.openAttempt(h.time(i * 1000 + 200)), null); assert.equal(h.owner.skip(), false);
    h.owner.rearm(h.time((i + 1) * 1000)); assert.equal(h.owner.currentTarget().targetGeneration, 1);
    assert.equal(h.owner.openAttempt(h.time((i + 1) * 1000)), null);
  }
  assert.equal(h.owner.snapshot().step.attempts.length, 3); assert.equal(h.owner.snapshot().step.skips.length, 0);
  assert.equal(new Set(h.owner.snapshot().step.attempts.map(r => r.attemptId)).size, 3);
});
await check('two paced RETRY attempts remain distinct on same target', () => {
  const h = domain.runtime([[46, 58], [46, 58]], 'repeat-unit'), identities = [];
  for (let i = 0; i < 2; i++) {
    const result = p2(i ? [46, 50, 58] : [46, 58, 70, 74], [46, 58]); assert.equal(result.verdict, 'RETRY');
    const id = h.owner.openAttempt(h.time(i * 1000 + 100)); identities.push(id.attemptId); h.owner.analyzeAttempt(id);
    h.owner.completeAttempt(id, { kind: 'RETRY', reason: 'UNCERTAIN', captureEndSessionTime: h.time(i * 1000 + 150) });
    assert.equal(h.owner.snapshot().step.attemptState, 'POST_VERDICT'); h.owner.rearm(h.time((i + 1) * 1000));
  }
  assert.notEqual(identities[0], identities[1]); assert.equal(h.owner.currentTarget().targetGeneration, 1);
});
await check('stale and equal-watermark evidence cannot become next attempt after RETRY', () => {
  const h = domain.runtime([[60]], 'stale-unit'), old = h.owner.openAttempt(h.time(100)); h.owner.analyzeAttempt(old);
  h.owner.completeAttempt(old, { kind: 'RETRY', reason: 'UNCERTAIN', captureEndSessionTime: h.time(150) }); h.owner.rearm(h.time(500));
  for (const ms of [100, 150, 499, 500]) assert.equal(h.owner.openAttempt(h.time(ms)), null);
  const next = h.owner.openAttempt(h.time(501)); assert.notEqual(next.attemptId, old.attemptId);
  assert.equal(h.owner.analyzeAttempt(old), false); assert.equal(h.owner.completeAttempt(old, { kind: 'RETRY', reason: 'UNCERTAIN', captureEndSessionTime: h.time(550) }).kind, 'REJECTED');
});
function row(id, recording = 'r1', gesture = 'g1', rate = 44100, expected = [60], physical = [60], observed = [60, 72]) {
  const result = p2(observed, expected);
  return { rowId: id, scenarioId: id, ordinal: 0, rate, recordingId: recording, audioBoundCaseId: 'case-' + recording,
    physicalGestureId: gesture, physicalTruth: physical, acousticObserved: observed, expected, P2: result,
    ...physicalClass(result, physical, expected), observations: observed.map(n => ({ observationId: `${recording}:${gesture}:${rate}:${n}`,
      pitch: domain.pitch(n), midiPitch: n, confidence: .8, sourceDomainId: 'unit', sourceSampleRateHz: rate,
      sourceEventSample: rate, targetSample: 16000 })) };
}
await check('physical dedup ignores scenario/target labels and retains exact multiplicity', () => {
  const rows = [row('a'), row('b'), row('c', 'r1', 'g1', 44100, [72])], groups = groupPhysical(rows);
  assert.equal(groups.length, 1); assert.equal(groups[0].multiplicity, 3); assert.equal(groups[0].targetViews.length, 2);
  assert.equal(groups[0].members.length, 3); assert.equal(groups[0].supportedUsabilityVerdict, 'RETRY');
  assert.equal(stable(groupPhysical([...rows].reverse())), stable(groups));
});
await check('different physical gesture/rate/observation identity cannot silently dedup', () => {
  assert.equal(groupPhysical([row('a'), row('b', 'r1', 'g2'), row('c', 'r1', 'g1', 48000)]).length, 3);
  const a = row('d'); a.observations[0].confidence = .9;
  assert.equal(groupPhysical([row('a'), a]).length, 2);
});
await check('conflicting supported target views have no chosen favorable usability verdict', () => {
  const g = groupPhysical([row('a', 'r1', 'g1', 44100, [60], [60, 72]), row('b', 'r1', 'g1', 44100, [60, 72], [60, 72])]);
  assert.equal(usability(g).mixedSupportedTargetContexts, 1); assert.equal(usability(g).SAFE_AUTO_MATCH_COVERAGE, null);
});
await check('dedup identity conflicts and duplicate observation IDs rejected', () => {
  const a = row('a'), b = row('b'); b.physicalTruth = [60, 72]; assert.throws(() => groupPhysical([a, b]), /CONFLICT/);
  a.observations.push(a.observations[0]); assert.throws(() => groupPhysical([a]), /DUPLICATE/);
});
await check('duplicate rows or rate variants alone cannot justify operating-point reopen', () => {
  const g = groupPhysical([row('a'), row('b'), row('c', 'r1', 'g1', 48000)]);
  assert.equal(reopen(g, 0).recommendation, 'ACOUSTIC_OPERATING_POINT_REOPEN_NOT_JUSTIFIED');
});
await check('reopen needs independent gesture+recording recurrence at both rates and zero danger', () => {
  const rows = ['r1', 'r2'].flatMap(rec => [44100, 48000].map(rate => row(`${rec}:${rate}`, rec, 'gesture-' + rec, rate)));
  const g = groupPhysical(rows); assert.equal(reopen(g, 0).recommendation, 'ACOUSTIC_OPERATING_POINT_REOPEN_JUSTIFIED_FOR_EXPOSED_DEVELOPMENT_ONLY');
  assert.equal(reopen(g, 1).recommendation, 'ACOUSTIC_OPERATING_POINT_REOPEN_NOT_JUSTIFIED');
  assert.equal(reopen(g, 0).executionAuthorized, false);
});
await check('policy has no acoustic executable import or confidence/geometry input', async () => {
  assertGraph(graph); assert.throws(() => assertGraph(['apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts']));
  const source = (await bytes(DIR + '/policy.mjs')).toString(); assert.ok(!source.includes('onnxruntime'));
  const definition = source.slice(source.indexOf('export function p2'), source.indexOf('export function physicalClass'));
  assert.ok(!/confidence|threshold|octave|timing|geometry/i.test(definition)); assert.ok(Object.values(execution).every(v => v === 0));
});
await check('Continuous inventory still exact; no projection or ownership rerun', continuousUnchanged);
await check('current baseline unchanged and model input not reopened', async () => {
  const c = JSON.parse(await bytes(DIR + '/contract.json'));
  assert.deepEqual([c.baseline.sampleRateHz, c.baseline.inputSamples, c.baseline.inputMs], [16000, 29120, 1820]);
  assert.deepEqual([c.baseline.onsetThreshold, c.baseline.frameThreshold, c.baseline.ownedMs, c.baseline.pastMs, c.baseline.futureMs], [.30, .05, 600, 1050, 170]);
  assert.equal(c.modelInputContract, 'MODEL_INPUT_CONTRACT_NOT_REOPENED'); assert.equal(c.reopenDecision.executionAuthorized, false);
});
await save('research-tests.json', { passed: tests.length, failed: 0, tests, graph, policyDigest: digest((await bytes(DIR + '/policy.mjs')).toString()),
  fixtureScope: 'SYNTHETIC_TESTS_NO_REAL_P2_ANALYSIS_BEFORE_REMOTE_FREEZE', execution, localNotCI: true });
console.log(JSON.stringify({ passed: tests.length, failed: 0 }));
