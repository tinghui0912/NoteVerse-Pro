import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, OUT, V20, bytes, load, save, hash, canonical, now, zero, decodeLE } from './io.mjs';
import { profiles, CONTROL } from './profiles.mjs';
import { foundation, manifestPath, sealPath } from './foundation.mjs';

const freeze = await load(OUT + '/blind-config.json'), proof = await load(OUT + '/remote-protocol-proof.json');
assert.equal(proof.blindConfigSha256, hash(await bytes(OUT + '/blind-config.json')));
assert.equal(proof.remoteHead, proof.commit); assert.ok(proof.remoteVerifiedAt < now());
for (const f of freeze.stageASources) assert.equal(hash(await bytes(f.path)), f.sha256);
const allowed = new Set([manifestPath, sealPath, V20 + '/baseline-parity.json', ...freeze.rawBlobPaths]);
const reads = [], read = async p => { assert.ok(allowed.has(p), 'BLIND_READ_NOT_ALLOWED:' + p); reads.push(p); return bytes(p); };
const startedAt = now();
await save(OUT + '/stage-a-started.json', { startedAt, proof, executionsAllowed: 1, zero });
let decoderCalls = 0, partialProfile = null; const artifacts = [], mismatches = [], partialJobs = [];
try {
  const f = await foundation(read), referenceBytes = await read(V20 + '/baseline-parity.json');
  assert.equal(hash(referenceBytes), freeze.baselineAcousticReference.sha256);
  const baseline = JSON.parse(referenceBytes);
  const bundle = freeze.bundles.find(b => b.name === 'decoder');
  assert.equal(hash(await bytes(bundle.path)), bundle.sha256);
  const { decodeRobustPiano, sourcePublication } = await import(pathToFileURL(path.join(ROOT, bundle.path)).href);
  for (const profile of profiles) {
    partialProfile = profile; partialJobs.length = 0;
    const jobs = [];
    for (const blob of f.manifest.blobs) {
      const b = f.blobs.get(blob.jobId), publications = [], rawDerivedEvents = [];
      partialJobs.push({ jobId: blob.jobId, publications, rawDerivedEvents });
      for (const w of f.manifest.windows.filter(w => w.jobId === blob.jobId)) {
        const pair = b.subarray(w.byteOffset, w.byteOffset + 128832); decoderCalls++;
        const events = decodeRobustPiano({ reg_onset_output: decodeLE(pair.subarray(0,64416)), reg_onset_shape: [1,183,88],
          frame_output: decodeLE(pair.subarray(64416)), frame_shape: [1,183,88] }, w.runtimeWindow.startSample,
        { onsetThreshold: profile.onsetThreshold, frameThreshold: profile.frameThreshold });
        const p = sourcePublication(w.sourceDomainId, w.sourceRateHz, w.sourceOriginSample, w.runtimeWindow,
          { events, inferenceMs: 0, decodeMs: 0, actualSessionRunCount: w.runOrdinal + 1 }, 0);
        publications.push({ sourceDomainId: p.sourceDomainId, sourceSampleRateHz: p.sourceSampleRateHz, window: p.window, observations: p.observations });
        rawDerivedEvents.push({ runOrdinal: w.runOrdinal, window: w.runtimeWindow, events });
      }
      const job = { jobId: blob.jobId, publications, rawDerivedEvents };
      if (profile.profileId === CONTROL) {
        const old = baseline.jobs.find(j => j.jobId === blob.jobId);
        if (canonical(old) !== canonical(job)) {
          mismatches.push({ jobId: blob.jobId, expected: old, actual: job });
          throw Error('ROBUST_V21_BASELINE_CONTROL_PARITY_FAILURE');
        }
      }
      jobs.push(job);
    }
    const p = OUT + '/stage-a/' + profile.profileId + '.json';
    const result = { profile, jobs, jobHashes: jobs.map(j => ({ jobId: j.jobId, sha256: hash(canonical(j)) })),
      decoderCalls: 228, schema: 'V21_SCORE_BLIND_DECODER_A_PUBLICATIONS', zero };
    await save(p, result); artifacts.push({ profileId: profile.profileId, path: p, sha256: hash(await bytes(p)), jobs: 18, windows: 228 });
  }
  assert.equal(decoderCalls, 4560); assert.equal(artifacts.length, 20);
  await save(OUT + '/stage-a-seal.json', { startedAt, completedAt: now(), protocol: proof,
    artifacts, outputCorpusSha256: hash(canonical(artifacts)), decoderCalls, zero, foundation: f.receipt,
    baselineControlParity: 'EXACT_FULL_PUBLICATIONS_AND_RAW_DERIVED_EVENTS', mismatches,
    dataReads: reads, truthAccessCount: 0, runtimeAccessCount: 0, productVerdictRuns: 0,
    permittedDataReads: [...allowed], StageB: 'NOT_STARTED', availabilityTimeMs: 'NONSEMANTIC_EXCLUDED_BOTH_REFERENCE_AND_CURRENT',
    status: 'BLIND_THRESHOLD_OUTPUTS_LOCALLY_SEALED_PENDING_REMOTE_PROOF' });
  console.log(JSON.stringify({ decoderCalls, profiles: artifacts.length, zero }));
} catch (error) {
  await save(OUT + '/stage-a-failure.json', { failedAt: now(), error: String(error.stack ?? error), decoderCalls,
    artifacts, partialProfile, partialJobs, mismatches, zero, rerunAllowed: false,
    disposition: mismatches.length ? 'ROBUST_V21_BASELINE_CONTROL_PARITY_FAILURE' : 'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED' });
  throw error;
}
