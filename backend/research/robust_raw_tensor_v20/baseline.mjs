// Zero-neural stage. Only the remotely sealed corpus and frozen acoustic-only reference are opened.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, OUT, hash, now, bytes, load, save, canonical, corpusIdentity } from './io.mjs';
import { verify } from './control.mjs';
import { PAIR_BYTES, TENSOR_BYTES, decodeLE } from './wire.mjs';

await verify(); const proof = await load(OUT + '/remote-raw-seal-proof.json'), startedAt = now();
assert.ok(proof.remoteVerifiedAt < startedAt); assert.equal(proof.captureCommit, proof.remoteHead);
assert.equal(proof.tensorManifestSha256, hash(await bytes(OUT + '/tensor-corpus-manifest.json')));
assert.equal(proof.rawSealSha256, hash(await bytes(OUT + '/raw-tensor-seal.json')));
await save(OUT + '/baseline-started.json', { startedAt, rawSealRemoteProof: proof, allowedExecutions: 1, neuralRuns: 0 });
let baselineDecoderRuns = 0; const jobs = [], mismatches = [];
try {
  const manifest = await load(OUT + '/tensor-corpus-manifest.json'), reference = await load(OUT + '/baseline-reference.json');
  assert.equal(manifest.corpusCanonicalSha256, corpusIdentity(manifest.windows));
  const bundle = (await load(OUT + '/bundle-graphs.json')).graphs.find(g => g.entry.endsWith('/baseline.ts'));
  assert.equal(hash(await bytes(bundle.path)), bundle.sha256);
  const { decodeRobustPiano, sourcePublication } = await import(pathToFileURL(path.join(ROOT, bundle.path)).href);
  const projected = new Map();
  for (const blob of manifest.blobs) {
    const b = await bytes(blob.path); assert.equal(hash(b), blob.sha256);
    const publications = [], rawDerivedEvents = [], expected = reference.jobs.find(j => j.jobId === blob.jobId);
    assert.ok(expected);
    for (const w of manifest.windows.filter(w => w.jobId === blob.jobId)) {
      const raw = b.subarray(w.byteOffset, w.byteOffset + PAIR_BYTES); assert.equal(hash(raw), w.pairSha256);
      assert.equal(hash(raw.subarray(0, TENSOR_BYTES)), w.onsetSha256); assert.equal(hash(raw.subarray(TENSOR_BYTES)), w.frameSha256);
      baselineDecoderRuns++;
      const events = decodeRobustPiano({ reg_onset_output: decodeLE(raw.subarray(0, TENSOR_BYTES)), reg_onset_shape: [1,183,88],
        frame_output: decodeLE(raw.subarray(TENSOR_BYTES)), frame_shape: [1,183,88] }, w.runtimeWindow.startSample,
      { onsetThreshold: 0.30, frameThreshold: 0.05 });
      const p = sourcePublication(w.sourceDomainId, w.sourceRateHz, w.sourceOriginSample, w.runtimeWindow,
        { events, inferenceMs: 0, decodeMs: 0, actualSessionRunCount: w.runOrdinal + 1 }, 0);
      const comparable = { sourceDomainId: p.sourceDomainId, sourceSampleRateHz: p.sourceSampleRateHz, window: p.window, observations: p.observations };
      const old = expected.publications[publications.length];
      if (canonical(comparable) !== canonical(old)) {
        mismatches.push({ jobId: blob.jobId, windowIndex: w.runtimeWindow.windowIndex, expected: old, actual: comparable });
        jobs.push({ jobId: blob.jobId, publications, failedWindow: comparable, rawDerivedEvents });
        throw Error('RAW_TENSOR_BASELINE_PARITY_FAILURE_STOP_AT_FIRST_WINDOW');
      }
      for (const o of p.observations) projected.set(o.observationId, o);
      publications.push(comparable); rawDerivedEvents.push({ runOrdinal: w.runOrdinal, window: w.runtimeWindow, events });
    }
    assert.equal(publications.length, expected.publications.length); jobs.push({ jobId: blob.jobId, publications, rawDerivedEvents });
  }
  const legacyMembership = [];
  for (const [index, assembly] of reference.legacyAssemblies.entries()) {
    const missing = assembly.observations.filter(o => canonical(projected.get(o.observationId)) !== canonical(o));
    if (missing.length) { mismatches.push({ legacyAssemblyIndex: index, jobId: assembly.jobId, missing }); throw Error('LEGACY_OBSERVATION_PARITY_FAILURE'); }
    legacyMembership.push({ legacyAssemblyIndex: index, jobId: assembly.jobId, observationCount: assembly.observations.length, missingCount: missing.length });
  }
  assert.equal(baselineDecoderRuns, 228); assert.equal(jobs.length, 18);
  const result = { startedAt, completedAt: now(), rawSealRemoteProof: proof, jobs, legacyMembership, mismatches,
    observationFieldsComparedExactly: ['observationId','pitch','midiPitch','sourceDomainId','sourceSampleRateHz','sourceEventSample','targetSample','confidence'],
    orderingAndCardinalityExact: mismatches.length === 0, confidenceComparison: 'EXACT_FLOAT32_DERIVED_NUMBER_NO_TOLERANCE',
    onsetScoreAndFrameScore: 'NEWLY_PRESERVED_RAW_DERIVED_DIAGNOSTIC_NOT_HISTORICAL_PARITY',
    availabilityTimeMs: 'NONSEMANTIC_DIFFERENT_WALL_CLOCK_NOT_COMPARED',
    implementation: 'Actual production decodeRobustPiano + sourcePublication; no copied algorithm',
    thresholds: { onsetThreshold: 0.30, frameThreshold: 0.05 },
    receipt: { neuralRuns: 0, baselineDecoderRuns, alternativeThresholdDecoderRuns: 0, productVerdictRuns: 0 },
    disposition: mismatches.length ? 'ROBUST_V20_RAW_TENSOR_BASELINE_PARITY_FAILURE' : 'ROBUST_V20_RAW_TENSOR_CORPUS_SEALED_CURRENT_030_005_BASELINE_PARITY_ESTABLISHED' };
  await save(OUT + '/baseline-parity.json', result);
  if (mismatches.length) throw Error('RAW_TENSOR_BASELINE_PARITY_FAILURE');
  await verify(); console.log(JSON.stringify({ baselineDecoderRuns, jobs: jobs.length, mismatches: 0, legacyAssemblies: legacyMembership.length, disposition: result.disposition }));
} catch (error) {
  await save(OUT + '/baseline-failure.json', { failedAt: now(), failure: String(error.stack ?? error), partialJobs: jobs, mismatches,
    receipt: { neuralRuns: 0, baselineDecoderRuns, alternativeThresholdDecoderRuns: 0, productVerdictRuns: 0 },
    disposition: 'ROBUST_V20_RAW_TENSOR_BASELINE_PARITY_FAILURE', rerunAllowed: false }); throw error;
}
