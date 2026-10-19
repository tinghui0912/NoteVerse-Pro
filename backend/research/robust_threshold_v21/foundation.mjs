import assert from 'node:assert/strict';
import { V20, bytes, hash, canonical, decodeLE } from './io.mjs';
export const manifestPath = V20 + '/tensor-corpus-manifest.json';
export const sealPath = V20 + '/raw-tensor-seal.json';
export async function foundation(read = bytes) {
  const mb = await read(manifestPath), sb = await read(sealPath);
  assert.equal(hash(mb), '4bb391905007ecbd594b4ed76d7fa79be0a3c095062da9111c4de63e72129c4b');
  assert.equal(hash(sb), '7513253623c799357de01d7a7a183a95ec2738e0fa374b88fe299a09d1899eaf');
  const manifest = JSON.parse(mb), seal = JSON.parse(sb);
  assert.equal(manifest.modelSha256, '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3');
  assert.equal(manifest.blobs.length, 18); assert.equal(manifest.windows.length, 228);
  assert.equal(new Set(manifest.windows.map(w => w.sourceCaseId)).size, 9);
  assert.deepEqual([...new Set(manifest.windows.map(w => w.sourceRateHz))].sort(), [44100,48000]);
  const identity = hash(canonical(manifest.windows.map(w => ({ jobId: w.jobId, runOrdinal: w.runOrdinal,
    runtimeWindow: w.runtimeWindow, inputSha256: w.inputSha256, onsetSha256: w.onsetSha256, frameSha256: w.frameSha256, pairSha256: w.pairSha256 }))));
  assert.equal(identity, '73c4aad015e8cc10a78bc54bac9f5d89af2c14a0b50a6ecf190761081dd476a0');
  assert.equal(seal.corpusCanonicalSha256, identity);
  const blobs = new Map(); let total = 0, pairs = 0;
  for (const blob of manifest.blobs) {
    const b = await read(blob.path); assert.equal(b.length, blob.bytes); assert.equal(hash(b), blob.sha256);
    const windows = manifest.windows.filter(w => w.jobId === blob.jobId);
    assert.equal(windows.length, blob.pairCount); assert.equal(b.length, windows.length * 128832);
    for (const [i, w] of windows.entries()) {
      assert.equal(w.byteOffset, i * 128832); assert.equal(w.byteLength, 128832);
      assert.equal(w.onsetOffset, w.byteOffset); assert.equal(w.frameOffset, w.byteOffset + 64416);
      assert.equal(w.onsetLength, 64416); assert.equal(w.frameLength, 64416);
      assert.equal(w.dtype, 'float32'); assert.deepEqual(w.shape, [1,183,88]);
      assert.equal(w.samples, 29120); assert.equal(w.runtimeWindow.endSample - w.runtimeWindow.startSample, 29120);
      const pair = b.subarray(w.byteOffset, w.byteOffset + w.byteLength);
      assert.equal(hash(pair), w.pairSha256); assert.equal(hash(pair), w.readbackSha256);
      assert.equal(hash(pair.subarray(0,64416)), w.onsetSha256); assert.equal(hash(pair.subarray(64416)), w.frameSha256);
      decodeLE(pair.subarray(0,64416)); decodeLE(pair.subarray(64416)); pairs++;
    }
    total += b.length; blobs.set(blob.jobId, b);
  }
  assert.equal(total, 29373696); assert.equal(pairs, 228);
  assert.deepEqual(manifest.windows.map(w => w.runOrdinal), Array.from({ length: 228 }, (_, i) => i));
  return { manifest, blobs, receipt: { jobs: 18, pairs, canonicalBytes: total, corpusCanonicalSha256: identity,
    allBlobPairOnsetFrameHashes: 'EXACT', dtype: 'FLOAT32_LITTLE_ENDIAN', shape: [1,183,88], finite: true } };
}
