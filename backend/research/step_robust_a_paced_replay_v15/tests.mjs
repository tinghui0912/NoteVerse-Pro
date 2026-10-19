import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, DIR, FIXED, COUNTS, load, bundle, save, integrity, assertImportGraph, extractMetrics } from './core.mjs';

const tests = [];
const check = async (name, fn) => { await fn(); tests.push({ name, status: 'PASS' }); };
const { module: r, inputs } = await bundle();
function harness(targets = [[60], [62]]) {
  const id = 'synthetic-v15', clock = new r.ManualClock();
  const runtime = new r.StepPracticeRuntime({ artifact: r.artifact(targets), scope: { kind: 'FULL' },
    inputSource: 'MICROPHONE', clock, localSessionId: id, metadataClock: { nowEpochMs: () => 0 } });
  const t = ms => ({ domainId: id, ms });
  const finish = (pitches = ['C4']) => {
    const identity = runtime.openAttempt(t(10)); assert.ok(identity);
    assert.equal(runtime.analyzeAttempt(identity), true);
    const result = runtime.completeAttempt(identity, { kind: 'EVIDENCE', observedAttackPitches: pitches, confidence: 1, captureEndSessionTime: t(60) });
    assert.equal(result.kind, 'FINALIZED'); return { identity, result };
  };
  return { runtime, clock, t, finish };
}
const publication = (rate, events, end = 32000) => ({ sourceDomainId: 'synthetic', sourceSampleRateHz: rate,
  window: { windowIndex: 0, jobIndex: 0, regionIndex: 0, ownedStartTarget: 0, ownedEndTarget: end, startSample: 0, endSample: 29120 },
  availabilityTimeMs: 0, observations: events.map(([ms, midi, id], i) => ({ observationId: id ?? `o${i}`, pitch: r.pitch(midi), midiPitch: midi,
    sourceDomainId: 'synthetic', sourceSampleRateHz: rate, sourceEventSample: Math.round(ms * rate / 1000), targetSample: Math.round(ms * 16), confidence: .8 })) });

await check('all immutable identity hashes and V3-V14 historical bytes', integrity);
await check('one roster, H50, V13, no neural counts', async () => {
  const p = await load(DIR + '/policy.json'); assert.deepEqual(p.roster, ['ROBUST_A_CURRENT_CONTROL']);
  assert.equal(p.HMs, r.GESTURE_WIDTH_MS); assert.equal(p.HMs, 50);
  assert.deepEqual(p.runtime, harness().runtime.snapshot().version);
  assert.ok(Object.values(COUNTS).every(v => v === 0));
});
await check('real replay bundle has no model/decoder/Worker/source runtime reachability', () => {
  assertImportGraph(inputs);
  for (const forbidden of ['model-inference.ts', 'robust-piano-decoder.ts', 'xc2_decoders.mjs', 'source-analysis-runtime.ts', 'acoustic-model-worker.ts'])
    assert.throws(() => assertImportGraph([forbidden]), /FORBIDDEN_EXECUTABLE_IMPORT/);
  assert.ok(inputs.some(p => p.endsWith('/step-runtime.ts')));
  assert.ok(!inputs.some(p => /v9\/|v14\/|onnxruntime|decoder|source-runtime/.test(p)));
});
await check('strict equality ignored; only strictly later input opens', () => {
  const { runtime, t } = harness(); assert.equal(runtime.openAttempt(t(0)), null); assert.ok(runtime.openAttempt(t(.001)));
});
await check('CAPTURING outside H50 cannot open a second attempt or queue', () => {
  const { runtime, t } = harness(); const id = runtime.openAttempt(t(10));
  assert.equal(runtime.openAttempt(t(100)), null); assert.equal(runtime.snapshot().step.activeAttempt.attemptId, id.attemptId);
  assert.equal(runtime.snapshot().step.attempts.length, 0);
});
await check('ANALYZING cannot open attempt2', () => {
  const { runtime, t } = harness(); const id = runtime.openAttempt(t(10)); runtime.analyzeAttempt(id);
  assert.equal(runtime.openAttempt(t(100)), null);
});
await check('POST_VERDICT cannot open; answered target stays until explicit rearm', () => {
  const { runtime, t, finish } = harness(); finish();
  assert.equal(runtime.snapshot().step.attemptState, 'POST_VERDICT'); assert.equal(runtime.openAttempt(t(100)), null);
  assert.equal(runtime.currentTarget().stepId, 's0'); assert.equal(runtime.currentTarget().targetGeneration, 1);
  assert.equal(runtime.canAcceptAttempt, false);
});
await check('MATCH advances once and READY/new target appear atomically at rearm', () => {
  const { runtime, t, finish } = harness(); finish(); runtime.rearm(t(100));
  assert.equal(runtime.canAcceptAttempt, true); assert.equal(runtime.currentTarget().stepId, 's1');
  assert.equal(runtime.currentTarget().targetGeneration, 2); assert.throws(() => runtime.rearm(t(101)));
});
await check('delivered-after-READY stale timestamp and exact watermark cannot rebind', () => {
  const { runtime, t, finish } = harness(); finish(); runtime.rearm(t(500));
  for (const ms of [10, 60, 100, 499, 500]) assert.equal(runtime.openAttempt(t(ms)), null);
  assert.equal(runtime.openAttempt(t(501)).targetGeneration, 2);
});
await check('old-target completion identity cannot modify next generation', () => {
  const { runtime, t, finish } = harness(); const { identity } = finish(); runtime.rearm(t(100));
  const next = runtime.openAttempt(t(101)); assert.notEqual(next.attemptId, identity.attemptId);
  assert.equal(runtime.analyzeAttempt(identity), false);
  assert.equal(runtime.completeAttempt(identity, { kind: 'EVIDENCE', observedAttackPitches: ['C4'], confidence: 1, captureEndSessionTime: t(200) }).kind, 'REJECTED');
  assert.equal(runtime.currentTarget().targetGeneration, 2);
});
await check('MISMATCH retains target and no pitch bag crosses rearm', () => {
  const { runtime, t, finish } = harness([[60, 64]]); assert.equal(finish(['C4']).result.record.verdict, 'MISMATCH');
  runtime.rearm(t(100)); const id = runtime.openAttempt(t(101)); runtime.analyzeAttempt(id);
  assert.equal(runtime.completeAttempt(id, { kind: 'EVIDENCE', observedAttackPitches: ['E4'], confidence: 1, captureEndSessionTime: t(151) }).record.verdict, 'MISMATCH');
  assert.equal(runtime.currentTarget().targetGeneration, 1);
});
await check('final MATCH ends only at rearm; no terminal revival', () => {
  const { runtime, t, finish } = harness([[60]]); finish(); assert.equal(runtime.state, 'ACTIVE');
  runtime.rearm(t(100)); assert.equal(runtime.state, 'ENDED'); assert.equal(runtime.isCompleted, true);
  assert.equal(runtime.openAttempt(t(101)), null); assert.throws(() => runtime.rearm(t(102)));
});
await check('exact-set negatives: extras, incomplete, semitone, octave never MATCH', () => {
  for (const set of [['C4'], ['C4', 'E4', 'G4'], ['C#4', 'E4'], ['C3', 'E4']])
    assert.equal(harness([[60, 64]]).finish(set).result.record.verdict, 'MISMATCH');
});
for (const rate of [44100, 48000]) {
  await check(`rate ${rate}: H50 half-open excludes right edge, keeps all extras and within-gesture timing`, () => {
    const p = publication(rate, [[100, 60], [110, 64], [149, 67], [150, 72]]);
    const a = r.reconstruct([p], rate, 0, 0, rate).assembly;
    assert.deepEqual(a.observations.map(o => o.midiPitch), [60, 64, 67]); assert.equal(a.end - a.anchor, rate * .05);
    assert.deepEqual(a.observations, p.observations.slice(0, 3));
  });
  await check(`rate ${rate}: no H extension or early target close across publications`, () => {
    const p = publication(rate, [[100, 60, 'opening']], 1760), q = publication(rate, [[140, 64, 'later'], [160, 67, 'outside']]);
    q.window.windowIndex = 1; const a = r.reconstruct([p, q], rate, 0, 0, rate).assembly;
    assert.deepEqual(a.observations.map(o => o.midiPitch), [60, 64]);
  });
}
await check('truth attribution independent of target; >100ms and equal-distance ambiguity fail', () => {
  const gs = [{ gestureId: 'a', onsetMs: 100, normalizedPitchSet: [60] }, { gestureId: 'b', onsetMs: 200, normalizedPitchSet: [64] }];
  assert.equal(r.nearest(gs, 101).id, 'a'); assert.throws(() => r.nearest(gs, 150), /AMBIGUOUS/);
  assert.throws(() => r.nearest(gs, 301), /NO_TRUTH/);
});
await check('pure assembler has no target argument and cannot invent empty evidence', () => {
  assert.equal(r.reconstruct([publication(48000, [])], 48000, 0, 0, 100000), null);
});
await check('synthetic pacing drives actual POST_VERDICT/rearm and two independent attempts', () => {
  const gs = [{ gestureId: 'a', onsetMs: 1000, normalizedPitchSet: [60] }, { gestureId: 'b', onsetMs: 2000, normalizedPitchSet: [60] }];
  const p = publication(48000, [[1000, 60, 'a'], [2000, 60, 'b']], 48000);
  const s = { scenarioId: 'post_ready_repeat', family: 'synthetic', audioBoundCaseId: 'synthetic', targetPitchSets: [[60], [60]],
    physicalTruthGestureIds: ['a', 'b'], inputEligibleAfterOriginalSourceMs: 850 };
  const cell = r.replayCell(s, gs, { jobId: 'synthetic', sourceRateHz: 48000, sourceOriginSample: 0, publications: [p] }, ['MATCH','MATCH'], 1000);
  assert.deepEqual(cell.actualSequence, ['MATCH','MATCH']); assert.equal(cell.finalSnapshot.runtimeStatus, 'ENDED');
  assert.ok(cell.traces.every(t => t.postVerdict.step.attemptState === 'POST_VERDICT'));
  assert.notEqual(cell.traces[0].identity.attemptId, cell.traces[1].identity.attemptId);
});
await check('synthetic first MISMATCH never fabricates next-target progression', () => {
  const gs = [{ gestureId: 'a', onsetMs: 1000, normalizedPitchSet: [60] }];
  const s = { scenarioId: 'match_followed_by_next_target', family: 'synthetic', audioBoundCaseId: 'synthetic', targetPitchSets: [[60], [62]],
    physicalTruthGestureIds: ['a'], inputEligibleAfterOriginalSourceMs: 850 };
  const c = r.replayCell(s, gs, { jobId: 'synthetic', sourceRateHz: 48000, sourceOriginSample: 0,
    publications: [publication(48000, [[1000, 60], [1010, 64]], 48000)] }, ['MATCH'], 1000);
  assert.equal(c.classification, 'NEXT_TARGET_SEQUENCE_BLOCKED_BY_FIRST_ATTEMPT_RECOGNITION');
  assert.equal(c.finalSnapshot.step.targetGeneration, 1); assert.equal(c.traces[0].advancementAtRearm, 0);
});
await check('historical decoder metrics match all exact requested values', async () => {
  const rows = extractMetrics(await load('backend/research/reports/phase9g_xc2_stage_a_decoder_resampler_development_2026-10-15.json'));
  assert.deepEqual(rows.map(r => [r.extrasPredicted, r.extraPrecision, r.chordExactCompleteness, r.overallVerdictAgreement]), [
    [220, .1590909090909091, .9428571428571428, .9471947194719472],
    [341, .0967741935483871, .9428571428571428, .9372937293729373],
    [342, .1023391812865497, .9428571428571428, .9471947194719472],
    [527, .06641366223908918, .9428571428571428, .9504950495049505]]);
});
await check('A frame support and B onset-only proposal source proof; neither imported/executed', async () => {
  const a = await readFile(path.join(ROOT, 'apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts'), 'utf8');
  const b = await readFile(path.join(ROOT, FIXED.historicalBSource[0]), 'utf8');
  assert.ok(a.includes('if (frameScore < thresholds.frameThreshold) continue;'));
  const projection = b.slice(b.indexOf('export function upstreamOnsetProjection'), b.indexOf('export function consensus'));
  assert.ok(projection.includes('frameScore: frameData[n * 88 + pitch]')); assert.ok(!projection.includes('frameThreshold'));
});
await check('tooling has no V9 result/PCM/ONNX parser/dynamic inference path', async () => {
  const source = await readFile(path.join(ROOT, DIR, 'runner.mjs'), 'utf8');
  for (const forbidden of ['stage-b-results.json', 'onnxruntime', 'InferenceSession', 'AcousticModelWorker', 'soundfile', 'inspect_onnx']) assert.ok(!source.includes(forbidden));
  assert.equal(COUNTS.decoderARuns, 0); assert.equal(COUNTS.decoderBRuns, 0);
});
await save('replay-tests.json', { tests, passed: tests.length, failed: 0, bundleInputs: inputs,
  label: 'LOCAL_DETERMINISTIC_TESTS_NOT_CI', execution: COUNTS });
console.log(JSON.stringify({ passed: tests.length, failed: 0, bundleInputs: inputs.length }));
