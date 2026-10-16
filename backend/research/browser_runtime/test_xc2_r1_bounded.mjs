import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedContinuousFinalizationLedger as Ledger, minimumCostPairs } from './xc2_r1_bounded_finalizer.mjs';
import { StreamingRationalResampler } from './xc2_r1_streaming_resampler.mjs';
import { createAcousticExecutor } from './xc2_r1_browser_acoustic.mjs';
const strike = (id, time, pitch = 'C4', groupId = id) => ({ strikeId: id, groupId, pitch, expectedPerformanceTimeMs: time, renderNoteIds: [] });
const obs = (id, time, pitch = 'C4') => ({ observationId: id, performanceTimeMs: time, pitch, confidence: .7 });
const pub = (l, f, observations = [], a = f + 10) => l.publish({ publicationId: `p${f}`, analyzedThroughPerformanceMs: f, availabilityTimeMs: a, observations });
test('100-strike same-pitch transitive chain closes locally', () => {
  const l = new Ledger(Array.from({ length: 100 }, (_, i) => strike(`s${i}`, 1000 + i * 200)));
  for (let i = 0; i < 100; i++) { pub(l, 1000 + i * 200, [obs(`o${i}`, 1000 + i * 200)]); if (i >= 2) assert.ok(l.snapshot().verdicts.some(v => v.id === `s${i - 2}`)); }
  pub(l, 21100); assert.equal(l.snapshot().verdicts.length, 100); assert.ok(l.snapshot().verdicts[0].finalizationTimeMs <= 1410);
});
test('dense all-pitch group chain and local MISSING/WRONG do not await unrelated groups', () => {
  for (const wrong of [false, true]) { const l = new Ledger(Array.from({ length: 100 }, (_, i) => strike(`g${i}`, 1000 + i * 100, String(i % 88))));
    const r = pub(l, 1250, wrong ? [obs('wrong', 1000, 'incompatible')] : []);
    assert.equal(r.verdicts.find(v => v.id === 'g0').verdict, wrong ? 'WRONG' : 'MISSING'); assert.equal(r.verdicts[0].witness.requiredAnalysisFrontierMs, 1250); }
});
test('complete and incomplete chord', () => {
  for (const complete of [false, true]) { const l = new Ledger([strike('c', 1000, 'C4', 'g'), strike('e', 1000, 'E4', 'g')]);
    const r = pub(l, 1250, [obs('c', 1000), ...(complete ? [obs('e', 1000, 'E4')] : [])]); assert.equal(r.verdicts[0].verdict, complete ? 'CORRECT' : 'INCOMPLETE_CHORD'); }
});
test('CORRECT irrevocably closes at local deadline before future component', () => { const l = new Ledger([strike('a', 1000), strike('b', 1400)]); pub(l, 1250, [obs('x', 1000)]); assert.equal(l.snapshot().verdicts[0].verdict, 'CORRECT'); });
test('wrong association maximizes cardinality before timing error', () => {
  const pairs = minimumCostPairs([{ t: 0 }, { t: 4 }], [{ t: 3 }, { t: 6 }], (a, b) => Math.abs(a.t - b.t) <= 3 ? Math.abs(a.t - b.t) : Infinity);
  assert.deepEqual(pairs, [[0, 0], [1, 1]]);
});
test('competing wrong claims globally consume each observation once', () => { const l = new Ledger([strike('a', 1000), strike('b', 1100)]); const r = pub(l, 1350, [obs('x', 1090, 'D4')]); assert.equal(r.verdicts.filter(v => v.verdict === 'WRONG').length, 1); assert.equal(r.observationConsumption.length, 1); });
for (const [a, b] of [['MATCHED', 'WRONG'], ['MATCHED', 'EXTRA'], ['WRONG', 'EXTRA']]) test(`reject ${a}+${b} ownership`, () => { const l = new Ledger([]); l.claim('o', a, 'g'); assert.throws(() => l.claim('o', b, 'h'), /MIXED_OWNERSHIP/); });
test('EXTRA closes at finite direct horizon, not transitive chain', () => {
  const l = new Ledger(Array.from({ length: 100 }, (_, i) => strike(`s${i}`, 1000 + i * 200)));
  pub(l, 1250, [obs('x', 1000), obs('next', 1200), obs('residual', 1001, 'D4')]); assert.equal(l.snapshot().verdicts.some(v => v.id === 'residual'), false);
  const r = pub(l, 1450); const extra = r.verdicts.find(v => v.id === 'residual'); assert.equal(extra.verdict, 'EXTRA'); assert.equal(extra.witness.requiredAnalysisFrontierMs, 1450);
});
test('late evidence rejected', () => { const l = new Ledger([strike('s', 1000)]); pub(l, 1250); assert.throws(() => pub(l, 1300, [obs('late', 1000)]), /LATE_EVIDENCE/); });
test('stable ties independent of input ordering', () => {
  const run = (reverse) => { const s = [strike('b', 1000), strike('a', 1000)], o = [obs('y', 1000), obs('x', 1000)]; const l = new Ledger(reverse ? s.reverse() : s); return pub(l, 1250, reverse ? o.reverse() : o).observationConsumption; };
  assert.deepEqual(run(false), run(true));
});
test('manual completion leaves future NOT_REACHED', () => { const l = new Ledger([strike('s', 5000)]); pub(l, 1000); const r = l.completeManualScope(1000, 1200); assert.equal(r.lowLevel.strikes[0].verdict, 'NOT_REACHED'); assert.equal(r.verdicts.length, 0); });
test('terminal tail and causal witness timestamps', () => { const l = new Ledger([strike('s', 1000)]); pub(l, 1100, [obs('o', 1000)], 1200); const r = l.completeNaturalScope(1100, 1300); assert.equal(r.verdicts[0].finalizationTimeMs, 1300); assert.equal(r.verdicts[0].finalizationLatencyMs, 300); assert.equal(r.verdicts[0].witness.requiredAnalysisFrontierMs, 1100); });
test('bounded versus whole-component optimal assignment has an explicit tradeoff', () => {
  const l = new Ledger([strike('a', 1000), strike('b', 1400)]); pub(l, 1250, [obs('x', 1200)]); pub(l, 1650, [obs('y', 1300)]);
  const pairs = minimumCostPairs([{ time: 1000 }, { time: 1400 }], [{ time: 1200 }, { time: 1300 }], (s, o) => Math.abs(s.time - o.time) <= 250 ? Math.abs(s.time - o.time) : Infinity);
  assert.equal(pairs.length, 2); assert.equal(l.snapshot().lowLevel.strikes.filter(s => s.verdict === 'MATCHED').length, 2);
  // Timing optimality differs when the later observation is a better fit to the closed strike.
  const m = new Ledger([strike('a', 1000), strike('b', 1300)]); pub(m, 1250, [obs('shared', 1200)]); pub(m, 1650);
  assert.equal(m.snapshot().lowLevel.strikes[0].verdict, 'MATCHED'); assert.equal(m.snapshot().lowLevel.strikes[1].verdict, 'MISSING');
  const offline = minimumCostPairs([{ time: 1000 }, { time: 1300 }], [{ time: 1200 }], (s, o) => Math.abs(s.time - o.time)); assert.deepEqual(offline, [[1, 0]]);
});
test('milliseconds to beats', () => { assert.deepEqual([60, 90, 120, 160].map(bpm => 500 * bpm / 60000), [.5, .75, 1, 4 / 3]); });
test('streaming FIR has bounded state and explicit closure', () => { const h = new Float32Array(8821); h[4410] = 1;
  const r = new StreamingRationalResampler(h), a = r.push(new Float32Array(441).fill(.5)), b = r.finish();
  assert.equal(a.length + b.length, 160); assert.equal(r.ring.length, 128); assert.throws(() => r.push(new Float32Array()), /CLOSED/); });
test('official acoustic constructor rejects score fields; model run receives only PCM', async () => {
  let count = 0;
  globalThis.ort = { Tensor: class { constructor(type, values, dims) { this.values = values; this.dims = dims; } }, InferenceSession: { create: async (_path, options) => {
    assert.deepEqual(options.executionProviders, ['webgpu']); return { inputNames: ['waveform'], run: async feeds => { count++; assert.deepEqual(Object.keys(feeds), ['waveform']); assert.deepEqual(feeds.waveform.dims, [1, 29120]);
      return { reg_onset_output: { data: new Float32Array(183 * 88), dims: [1, 183, 88] }, frame_output: { data: new Float32Array(183 * 88), dims: [1, 183, 88] } }; } }; } } };
  await assert.rejects(createAcousticExecutor({ pcm: new Float32Array(30000), resampler: 'LINEAR', expectedPitches: [60] }), /FIELD_VIOLATION/);
  const acoustic = await createAcousticExecutor({ pcm: new Float32Array(30000), guardedSource: null, coefficients: null, clipId: 'synthetic', resampler: 'LINEAR' });
  const result = await acoustic.run({ startSample: 0, endSample: 29120, inputWindowStartMs: 0, ownedStartMs: 1000, ownedEndMs: 1600, windowId: 'test' });
  assert.equal(result.observations.length, 0); assert.equal(count, 1); assert.equal(acoustic.identity().sessionLoadCount, 1); delete globalThis.ort;
});
