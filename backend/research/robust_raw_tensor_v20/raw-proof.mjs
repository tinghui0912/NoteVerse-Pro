import assert from 'node:assert/strict';
import { OUT, BRANCH, hash, now, bytes, load, save, git, corpusIdentity } from './io.mjs';
import { verify } from './control.mjs';
import { PAIR_BYTES, TENSOR_BYTES, CORPUS_BYTES, decodeLE } from './wire.mjs';

await verify(); const m = await load(OUT + '/tensor-corpus-manifest.json'), seal = await load(OUT + '/raw-tensor-seal.json');
assert.equal(m.status, 'RAW_TENSOR_CORPUS_SEALED'); assert.equal(seal.manifestSha256, hash(await bytes(OUT + '/tensor-corpus-manifest.json')));
assert.equal(m.windows.length, 228); assert.equal(m.blobs.length, 18); assert.equal(m.receipt.rawCanonicalBytes, CORPUS_BYTES);
assert.equal(m.receipt.modelSessionLoads, 1); assert.equal(m.receipt.modelSessionRuns, 228); assert.equal(m.receipt.decoderRuns, 0);
assert.equal(m.receipt.successfulSessionRuns, 228); assert.equal(m.receipt.failedSessionRuns, 0);
assert.equal(m.receipt.modelSessionLoadAttempts, 1); assert.equal(m.receipt.captureOwnerWorkers, 1);
assert.equal(m.jobFinalReadbacks.length, 18); assert.deepEqual(m.finalReadbackFailures, []);
assert.equal(m.receipt.productVerdictRuns, 0); assert.equal(m.receipt.truthAccessCount, 0); assert.equal(m.receipt.unknownRuns, 0);
assert.equal(m.corpusCanonicalSha256, corpusIdentity(m.windows));
for (const blob of m.blobs) {
  const b = await bytes(blob.path); assert.equal(hash(b), blob.sha256); assert.equal(b.length, blob.bytes);
  for (const w of m.windows.filter(w => w.jobId === blob.jobId)) {
    const pair = b.subarray(w.byteOffset, w.byteOffset + PAIR_BYTES); assert.equal(pair.length, PAIR_BYTES);
    assert.equal(hash(pair), w.pairSha256); assert.equal(hash(pair.subarray(0, TENSOR_BYTES)), w.onsetSha256);
    assert.equal(hash(pair.subarray(TENSOR_BYTES)), w.frameSha256); decodeLE(pair);
  }
}
const head = git('rev-parse', 'HEAD');
assert.equal(git('rev-parse', 'origin/' + BRANCH), head); assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], head);
assert.equal(git('status', '--porcelain'), '');
await save(OUT + '/remote-raw-seal-proof.json', { captureCommit: head, remoteHead: head, remoteVerifiedAt: now(),
  tensorManifestSha256: hash(await bytes(OUT + '/tensor-corpus-manifest.json')), rawSealSha256: hash(await bytes(OUT + '/raw-tensor-seal.json')),
  corpusCanonicalSha256: m.corpusCanonicalSha256, totalJobs: 18, totalInputs: 228, totalRawPairs: 228,
  totalCanonicalRawBytes: CORPUS_BYTES, modelSessionLoads: 1, modelSessionRuns: 228, attemptedSessionRuns:228, successfulSessionRuns:228,
  captureOwnerWorkers:1, hiddenWarmupRuns:0, unknownRuns:0, decoderRuns: 0, productVerdictEvaluations: 0,
  rawBlobReadbacksVerified: 18, all228PairAndTensorHashesVerified: true });
console.log(JSON.stringify({ remoteRawSealCommit: head, rawCanonicalBytes: CORPUS_BYTES, decoderRunsBeforeSeal: 0 }));
