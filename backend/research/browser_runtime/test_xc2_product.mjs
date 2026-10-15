import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
import { planXc2Windows, decodeXc2, upstreamOnsetProjection, inclusiveFrontier } from './xc2_decoders.mjs';
import { executeXc2Raw } from './xc2_raw_browser.mjs';
const { createJiti } = createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const { ResearchFiveVerdictProjector: Projector, minimumCostOneToOne, latencyInBeats } = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/research/xc2-five-verdict-projector.ts'));
const s = (pitch, time = 1000, group = 'g', id = `${group}:${pitch}`) => ({ strikeId: id, groupId: group, pitch, expectedPerformanceTimeMs: time, renderNoteIds: [] });
const a = (pitch, time = 1000, id = pitch) => ({ observationId: id, pitch, performanceTimeMs: time, confidence: 0.9, source: 'ACOUSTIC' });
const publish = (p, events, frontier = 1400, availability = 2000) => p.publish({ publicationId: `${frontier}`, analyzedThroughPerformanceMs: frontier,
  availabilityTimeMs: availability, observations: events.map(event => ({ ...event, availabilityTimeMs: availability })) });
for (const [name, expected, played, verdict] of [
  ['complete chord', ['C4', 'E4', 'G4'], ['C4', 'E4', 'G4'], 'CORRECT'],
  ['incomplete chord', ['C4', 'E4', 'G4'], ['C4'], 'INCOMPLETE_CHORD'],
  ['all missing', ['C4'], [], 'MISSING'],
  ['wrong semitone', ['C4'], ['C#4'], 'WRONG'],
  ['wrong overrides partial chord', ['C4', 'E4', 'G4'], ['C4', 'D4'], 'WRONG'],
]) test(name, () => {
  const r = publish(new Projector(expected.map(pitch => s(pitch))), played.map(pitch => a(pitch)));
  assert.equal(r.verdicts.find(row => row.groupId === 'g').verdict, verdict);
  assert.equal(new Set(r.observationConsumption.map(row => row.observationId)).size, r.observationConsumption.length);
});
test('matched and wrong evidence cannot simultaneously be extra', () => {
  const r = publish(new Projector([s('C4')]), [a('C4'), a('D4')]);
  assert.deepEqual(r.verdicts.map(row => row.verdict), ['CORRECT', 'EXTRA']);
  assert.equal(r.verdicts.find(row => row.verdict === 'EXTRA').consumedObservationIds[0], 'D4');
  const w = publish(new Projector([s('C4')]), [a('D4')]);
  assert.deepEqual(w.verdicts.map(row => row.verdict), ['WRONG']);
});
test('wrong candidates wait for deadline and record exact availability, not acoustic time', () => {
  const p = new Projector([s('C4')]);
  assert.equal(publish(p, [a('D4', 1005)], 1200, 1500).verdicts.length, 0);
  const r = publish(p, [], 1250, 1800).verdicts[0];
  assert.equal(r.verdict, 'WRONG'); assert.equal(r.finalizationTimeMs, 1800); assert.equal(r.finalizationLatencyMs, 800);
});
test('wrong assignment is one-to-one and globally min-cost, including greedy trap', () => {
  const pairs = minimumCostOneToOne(2, 2, (i, j) => Math.abs([0, 5][i] - [4, 6][j]));
  assert.deepEqual(pairs, [[0, 0], [1, 1]]);
  const r = publish(new Projector([s('C4', 1000, 'a'), s('E4', 1005, 'b')]), [a('D4', 1004)]);
  assert.equal(r.verdicts.filter(row => row.verdict === 'WRONG').length, 1);
});
test('same-pitch retriggers retain conflict safety', () => {
  const p = new Projector([s('C4', 1000, 'a'), s('C4', 1020, 'b')]);
  assert.equal(publish(p, [a('C4', 1000, 'x'), a('C4', 1020, 'y')], 1250, 1800).verdicts.length, 0);
  const r = publish(p, [], 1270, 1900);
  assert.equal(r.verdicts.filter(row => row.verdict === 'CORRECT').length, 2);
  assert.equal(new Set(r.verdicts.flatMap(row => row.consumedObservationIds)).size, 2);
});
test('late coverage-violating publication fails closed; sustained note adds no retrigger', () => {
  const p = new Projector([s('C4')]);
  publish(p, [a('C4')]);
  assert.throws(() => publish(p, [a('D4', 1100)], 1500, 2100), /coverage|watermark/i);
  assert.equal(p.snapshot().verdicts.length, 1);
});
test('late incompatible event outside the frozen deadline does not rewrite a missing verdict', () => {
  const p = new Projector([s('C4')]);
  publish(p, [], 1250, 1600);
  const r = publish(p, [a('D4', 1300)], 1400, 1800);
  assert.equal(r.verdicts.find(v => v.groupId === 'g').verdict, 'MISSING');
  assert.equal(r.verdicts.find(v => v.verdict === 'EXTRA').performanceTimeMs, 1300);
});
test('actual raw executor rejects score fields before any filesystem/model activity', async () => {
  await assert.rejects(() => executeXc2Raw({ clip: { clipId: 'invalid', expectedPitch: 'C4' } }), /AUDIO_ONLY/);
});
test('beat conversion and inclusive half-open frontier', () => {
  assert.deepEqual([60, 90, 120, 160].map(bpm => latencyInBeats(1500, bpm)), [1.5, 2.25, 3, 4]);
  assert.ok(inclusiveFrontier(600) < 600); assert.ok(inclusiveFrontier(600) > 599.999999);
});
test('all frozen geometries have full real context, common interval and no ownership gaps', () => {
  for (const ownedMs of [320, 400, 500, 600]) for (const futureMs of [120, 170, 220]) {
    const rows = planXc2Windows({ sampleCount: 448000, ownedMs, futureMs });
    assert.equal(rows[0].ownedStartMs, 1380); assert.equal(rows.at(-1).ownedEndMs, 27780);
    rows.forEach((row, i) => { assert.equal(row.endSample - row.startSample, 29120); assert.ok(row.startSample >= 0 && row.endSample <= 448000);
      if (i) assert.equal(row.ownedStartMs, rows[i - 1].ownedEndMs); });
  }
});
test('decoder variants are deterministic and CURRENT has 100Hz mapping', () => {
  const regData = new Float32Array(32 * 88), frameData = new Float32Array(32 * 88).fill(0.8);
  for (const [i, value] of [[8, 0.1], [9, 0.4], [10, 0.8], [11, 0.5], [12, 0.1]]) regData[i * 88] = value;
  const raw = { regData, frameData, dims: [1, 32, 88], inputWindowStartMs: 1000, takeId: 'fixture', windowId: 'w', spec: { ownedStartMs: 1000, ownedEndMs: 1300 } };
  for (const id of ['A', 'B', 'C']) assert.deepEqual(decodeXc2(raw, id), decodeXc2(raw, id));
  assert.equal(decodeXc2(raw, 'A')[0].performanceTimeMs, 1100);
  assert.ok(Math.abs(upstreamOnsetProjection(raw)[0].performanceTimeMs - 1101.25) < 0.001);
});
test('CURRENT direct parity against authoritative product decoder, edges, regions and frame support', () => {
  const { decodeByteDanceRawOutputs } = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts'));
  const regData = new Float32Array(32 * 88), frameData = new Float32Array(32 * 88).fill(0.8);
  for (const [f, p, v] of [[0, 0, .9], [8, 1, .4], [9, 1, .8], [10, 1, .6], [10, 2, .7], [15, 2, .9], [9, 3, .6], [18, 4, .9], [31, 5, .8]]) regData[f * 88 + p] = v;
  frameData[18 * 88 + 4] = .01;
  const raw = { regData, frameData, dims: [1, 32, 88], inputWindowStartMs: 1000, spec: { ownedStartMs: 1000, ownedEndMs: 1400 } };
  const reference = decodeByteDanceRawOutputs({ reg_onset_output: regData, reg_onset_shape: raw.dims, frame_output: frameData, frame_shape: raw.dims },
    { sampleRateHz: 16000, captureStartSampleIndex: 16000, captureStartTime: { ms: 1000 } }, { onsetThreshold: .30, frameThreshold: .05 });
  assert.deepEqual(decodeXc2(raw, 'A').map(e => [e.pitch, e.performanceTimeMs, e.confidence]), reference.map(e => [e.midiPitch, e.onsetTime.ms, e.confidence]));
});
test('UPSTREAM_STYLE projection parity executes pinned Python upstream, not a handwritten oracle', () => {
  const data = Array.from({ length: 32 }, () => Array(88).fill(0));
  for (const [f, p, v] of [[7, 0, .2], [8, 0, .5], [9, 0, .9], [10, 0, .6], [11, 0, .1], [18, 1, .1], [19, 1, .7], [20, 1, .9], [21, 1, .4]]) data[f][p] = v;
  const code = "import sys,json,numpy as np;from piano_transcription_inference.utilities import RegressionPostProcessor;d=np.array(json.load(sys.stdin),dtype=np.float32);p=RegressionPostProcessor(100,88,.3,.3,.05,.2);b,s=p.get_binarized_output_from_regression(d,.3,2);print(json.dumps([[int(k)+21,int(n),float(s[n,k])] for n,k in zip(*np.where(b))]))";
  const expected = JSON.parse(execFileSync('docker', ['run', '--rm', '-i', 'noteverse-bytedance-calibration:phase9ga21', 'python', '-c', code], { input: JSON.stringify(data), encoding: 'utf8' }));
  const actual = upstreamOnsetProjection({ regData: Float32Array.from(data.flat()), frameData: new Float32Array(32 * 88), dims: [1, 32, 88], inputWindowStartMs: 0 });
  assert.equal(actual.length, expected.length);
  actual.forEach((event, i) => { assert.equal(event.pitch, expected[i][0]); assert.equal(event.peakFrame, expected[i][1]); assert.ok(Math.abs(event.shift - expected[i][2]) < 1e-6); });
});
