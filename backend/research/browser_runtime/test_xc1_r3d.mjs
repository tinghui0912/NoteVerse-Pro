import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { planOwnedWindows, decodeRobustRawOutputs } from './xc1_robust_decoder.mjs';
import { preflightOutput, preflightRunRoot, writeArtifact, validateArtifactDigest } from './xc1_artifacts.mjs';
import { validatePrediction, createSeal, verifySeal } from './xc1_stage_a_sealer.mjs';
import { parseArgs } from './xc1_stage_a_matrix_runner.mjs';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
import { classifyBacklog } from './xc1_browser_semantics.mjs';
import { resampleLinear } from './xc1_browser_semantics.mjs';
import { executeRobustBrowserV1, executeOnlineAmtK8BrowserV1, executeBasicPitchBrowserV1 } from './xc1_stage_a_candidate_registry.mjs';
const require = createRequire(import.meta.url);
const { createJiti } = require(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const decoder = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts'));

for (const length of [600, 1200, 1801, 1900, 2380, 2400.0625]) {
  test(`ownership covers ${length}ms without gaps`, () => {
    const durationMs = 1000 + length + 220;
    const windows = planOwnedWindows({ durationMs });
    assert.equal(windows[0].ownedStartMs, 1000);
    assert.equal(windows.at(-1).ownedEndMs, durationMs - 220);
    windows.forEach((window, index) => {
      assert.equal(window.endSample - window.startSample, 29120);
      assert.ok(window.startSample >= 0 && window.endSample <= durationMs * 16);
      if (index) assert.equal(windows[index - 1].ownedEndMs, window.ownedStartMs);
    });
  });
}
test('direct authoritative Robust decoder parity including timing, confidence and ordering', () => {
  const frames = 20, pitches = 88;
  const onset = new Float32Array(frames * pitches), frame = new Float32Array(frames * pitches);
  for (const [f, p, o, support] of [[0, 0, .8, .9], [3, 39, .4, .8], [4, 39, .7, .8], [5, 39, .7, .8],
    [9, 39, .9, .8], [9, 43, .8, .9], [12, 45, .9, .01], [19, 87, .6, .8]]) {
    onset[f * 88 + p] = o; frame[f * 88 + p] = support;
  }
  const raw = { reg_onset_output: onset, frame_output: frame, reg_onset_shape: [1, frames, pitches], frame_shape: [1, frames, pitches] };
  const reference = decoder.decodeByteDanceRawOutputs(raw, { sampleRateHz: 16000, captureStartSampleIndex: 32000,
    captureStartTime: { ms: 2000 } }, { onsetThreshold: .3, frameThreshold: .05 });
  const local = decodeRobustRawOutputs({ regData: onset, frameData: frame, dims: [1, frames, pitches], inputWindowStartMs: 2000 });
  assert.deepEqual(local.map(event => [event.pitch, event.peakFrame, event.performanceTimeMs, event.confidence]),
    reference.map(event => [event.midiPitch, (event.onsetTime.ms - 2000) / 10, event.onsetTime.ms, event.confidence]));
});
test('output parent exists and is writable before artifact writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xc1-r3d-test-'));
  try {
    await preflightRunRoot(root);
    const file = path.join(root, 'nested', 'candidate', 'take.json');
    await preflightOutput(file);
    const artifact = await writeArtifact(file, { stage: 'test', data: [1, 2] });
    validateArtifactDigest(artifact);
    const loaded = JSON.parse(await readFile(file, 'utf8'));
    loaded.data.push(3);
    assert.throws(() => validateArtifactDigest(loaded), /DIGEST_MISMATCH/);
    await assert.rejects(() => writeArtifact(file, {}), /IMMUTABLE/);
    const blocked = path.join(root, 'blocked'); await writeFile(blocked, 'file');
    await assert.rejects(() => preflightOutput(path.join(blocked, 'take.json')));
  } finally { await rm(root, { recursive: true }); }
});
test('read-only Linux filesystem preflight refuses qualification output', { skip: process.platform !== 'linux' }, async () => {
  await assert.rejects(() => preflightOutput('/sys/xc1-output-preflight/probe.json'));
});
test('scientific sealer rejects wrong freeze, wrong commit, acceptance and failure', () => {
  const base = { f5Commit: 'commit', f5FreezeSha256: 'freeze', deploymentId: 'robust-browser-v1', takeId: 'take',
    stage: 'XC1_OFFICIAL_STAGE_A_REAL_EXECUTOR_ACCEPTANCE', status: 'OFFICIAL_STAGE_A_REAL_EXECUTOR_PASS' };
  const options = { candidate: base.deploymentId, take: { takeId: 'take' }, f5Commit: 'commit', freezeSha256: 'freeze' };
  for (const changed of [base, { ...base, f5Commit: 'wrong' }, { ...base, f5FreezeSha256: 'wrong' },
    { ...base, stage: 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_FAILURE', status: 'XC1_STAGE_A_CELL_FAILED' }]) {
    const { artifactDigest } = require('./xc1_artifacts.mjs');
    assert.throws(() => validatePrediction({ ...changed, artifactCanonicalSha256: artifactDigest(changed) }, options));
  }
});
test('official matrix has no executor or model override option', () => {
  for (const arg of ['--executor', '--robust-onnx', '--canonical-pcm']) assert.throws(() => parseArgs(['node', 'runner', arg, 'anything']), /UNKNOWN/);
});
test('bounded backlog gate detects growing queue without exact-zero requirement', () => {
  const rows = delay => Array.from({ length: 20 }, (_, index) => ({ scheduledReadyTimestamp: index * 600,
    publicationFinishTimestamp: index * 600 + 100 + delay * index, queueDelayMs: 2 + delay * index,
    outstandingDepth: delay ? index + 1 : 1 }));
  assert.equal(classifyBacklog(rows(0), 600).noSustainedBacklog, true);
  assert.equal(classifyBacklog(rows(100), 600).noSustainedBacklog, false);
});
test('candidate and deployment bindings reject masquerading before inference', async () => {
  for (const [execute, deploymentId] of [[executeRobustBrowserV1, 'robust-browser-v1'],
    [executeOnlineAmtK8BrowserV1, 'online-amt-k8-browser-v1'], [executeBasicPitchBrowserV1, 'basic-pitch-browser-v1']]) {
    await assert.rejects(() => execute({ deploymentId: 'other' }), /DEPLOYMENT_ID_MISMATCH/);
    await assert.rejects(() => execute({ deploymentId, candidateId: 'other' }), /CANDIDATE_ID_MISMATCH/);
  }
});
test('Basic Pitch secondary linear resampler matches frozen interpolation including last sample', () => {
  for (const length of [1, 3, 7, 511, 512, 29120, 29121]) {
    const input = Float32Array.from({ length }, (_, index) => Math.sin(index * .123));
    const actual = resampleLinear(input, 16000, 22050);
    const expected = new Float32Array(Math.floor(length * 22050 / 16000));
    for (let index = 0; index < expected.length; index += 1) {
      const position = index * 16000 / 22050;
      const left = Math.floor(position), right = Math.min(length - 1, left + 1), fraction = position - left;
      expected[index] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    assert.deepEqual(actual, expected);
  }
});
test('real sealer detects mutation, missing/duplicate cell and wrong identity', async () => {
  const root = await mkdtemp(path.join(REPO_ROOT, 'backend/data/work/xc1-test-seal-'));
  try {
    const take = { takeId: 'non-smd-test', sourceAcousticWavSha256: 'synthetic', scoreableInterior: { startMs: 1000, endMs: 3400 },
      canonicalPcm: { sha256: 'pcm', byteSize: 29120 * 4, sampleCount: 29120 } };
    const manifestPath = path.join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ takes: [take] }));
    const candidates = ['robust-browser-v1', 'online-amt-k8-browser-v1', 'basic-pitch-browser-v1'];
    for (const candidate of candidates) await writeArtifact(path.join(root, candidate, 'non-smd-test.json'), {
      f5Commit: 'commit', f5FreezeSha256: 'freeze', deploymentId: candidate, takeId: take.takeId,
      status: 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE', stage: 'XC1_STAGE_A_SCIENTIFIC_PREDICTION',
      actualInferenceSessionRunCount: 1, acousticObservations: [],
      frozenAcousticInput: { pcmSha256: 'pcm', byteSize: 29120 * 4, sampleCount: 29120, sampleRateHz: 16000,
        dtype: 'float32-le-raw', sourceAcousticWavSha256: 'synthetic', scoreableInterval: take.scoreableInterior } });
    const options = { manifestPath, predictionRoot: root, output: path.join(root, 'seal.json'), f5Commit: 'commit', freezeSha256: 'freeze' };
    await createSeal(options);
    await verifySeal({ ...options, sealPath: options.output });
    const file = path.join(root, candidates[0], 'non-smd-test.json');
    const bytes = await readFile(file);
    await writeFile(file, Buffer.concat([bytes, Buffer.from(' ')]));
    await assert.rejects(() => verifySeal({ ...options, sealPath: options.output }), /PREDICTION_CHANGED/);
    await writeFile(file, bytes);
    await writeFile(path.join(root, candidates[0], 'duplicate.json'), bytes);
    await assert.rejects(() => createSeal({ ...options, output: path.join(root, 'bad_seal.json') }), /MISSING_OR_DUPLICATE/);
    await rm(path.join(root, candidates[0], 'duplicate.json'));
    await rm(file);
    await assert.rejects(() => createSeal({ ...options, output: path.join(root, 'bad_seal.json') }), /MISSING_OR_DUPLICATE/);
  } finally { await rm(root, { recursive: true }); }
});
