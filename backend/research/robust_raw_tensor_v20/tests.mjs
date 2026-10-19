import assert from 'node:assert/strict';
import { DIR, OUT, WORK, hash, bytes, load, save, corpusIdentity } from './io.mjs';
import { scope, graphGate, verify } from './control.mjs';
import { assertInventory, INPUT_SAMPLES, VALUES, TENSOR_BYTES, PAIR_BYTES, CORPUS_BYTES, encodeLE, decodeLE, tensor, pair } from './wire.mjs';
import { baselineStructure, captureStructure } from './structure.mjs';

const mode = process.argv[2], tests = [];
async function test(name, fn) { await fn(); tests.push({ name, status: 'PASS' }); }
try {
if (mode === 'pre') {
  await test('production/history unchanged; accepted V6/V7/V15 identities exact', scope);
  const m = await load(WORK + '/inputs.json'), p = await load(OUT + '/input-preservation.json');
  await test('exact 9-case 18-job 228-input two-rate inventory', () => {
    assertInventory(m); assert.equal(p.totalInputs, 228); assert.equal(p.totalCases, 9); assert.equal(p.mismatches, 0);
    const bad = structuredClone(m); bad.jobs.pop(); assert.throws(() => assertInventory(bad));
  });
  await test('all 228 finite little-endian inputs are exact 29120 samples and V6/reference SHA', async () => {
    let count = 0;
    for (const j of m.jobs) { const b = await bytes(j.inputBlobPath); assert.equal(hash(b), j.inputBlobSha256);
      for (const w of j.windows) {
        const raw = b.subarray(w.inputByteOffset, w.inputByteOffset + w.inputBytes), f = decodeLE(raw);
        assert.equal(f.length, INPUT_SAMPLES); assert.equal(hash(encodeLE(f)), w.inputSha256);
        const old = p.inputs[count++]; assert.equal(old.strongestV6Sha256, w.inputSha256); assert.equal(old.strongestV6ReferenceSha256, w.inputSha256);
      }
    } assert.equal(count, 228);
  });
  await test('canonical arithmetic: 16104 f32, 64416 tensor, 128832 pair, 29373696 corpus', () => {
    assert.deepEqual([VALUES,TENSOR_BYTES,PAIR_BYTES,CORPUS_BYTES], [16104,64416,128832,29373696]);
  });
  await test('lossless LE serialization includes sign, subnormal and finite Float32 extremes', () => {
    const b = Buffer.alloc(24), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    [0,0x80000000,1,0x7f7fffff,0xbf800000,0x3f800001].forEach((x,i) => v.setUint32(i*4,x,true));
    assert.deepEqual(Buffer.from(encodeLE(decodeLE(b))), b); assert.ok(Object.is(decodeLE(b)[1], -0));
  });
  await test('wrong tensor dtype/shape/count/nonfinite cannot serialize', () => {
    const good = { type: 'float32', dims: [1,183,88], data: new Float32Array(VALUES) };
    assert.equal(tensor(good).length, TENSOR_BYTES);
    for (const bad of [{...good,type:'float64'}, {...good,dims:[183,88]}, {...good,data:new Float32Array(1)},
      {...good,data:new Float64Array(VALUES)}]) assert.throws(() => tensor(bad));
    for (const value of [NaN,Infinity,-Infinity]) { const bad = new Float32Array(VALUES); bad[5] = value; assert.throws(() => tensor({...good,data:bad})); }
  });
  await test('onset/frame fixed concatenation and readback SHA detect any bit mutation', () => {
    const a = new Float32Array(VALUES).fill(.125), b = new Float32Array(VALUES).fill(.75), dims = [1,183,88];
    const raw = pair({type:'float32',dims,data:a},{type:'float32',dims,data:b});
    assert.equal(raw.length, PAIR_BYTES); assert.equal(hash(raw.subarray(0,TENSOR_BYTES)), hash(encodeLE(a)));
    assert.equal(hash(raw.subarray(TENSOR_BYTES)), hash(encodeLE(b))); assert.equal(hash(new Uint8Array(raw)), hash(raw));
    const changed = raw.slice(); changed[15] ^= 1; assert.notEqual(hash(changed), hash(raw));
  });
  const graphs = (await load(OUT + '/bundle-graphs.json')).graphs;
  await test('Stage A browser/Worker graph raw-only, no decoder/truth/runtime/finalizer imports', () => {
    for (const g of graphs.filter(g => g.platform === 'browser')) graphGate(g.inputs,'capture');
    for (const forbidden of ['step-runtime.ts','robust-piano-decoder.ts','continuous-finalizer.ts']) assert.throws(() => graphGate([forbidden],'capture'));
  });
  await test('capture host source imports no control/verifier/baseline/reference', async () => {
    const s = (await bytes(DIR + '/capture.mjs')).toString();
    assert.ok(!/from ['"].*(?:control|baseline|policy)/.test(s));
    assert.ok(!/input-preservation|baseline-reference|scenario-manifest|audio-bound-cases|acoustic\.json/.test(s));
  });
  await test('single session/run owner guarded at exactly 228 without hidden warmup path', async () => {
    const s = (await bytes(DIR + '/capture-worker.mjs')).toString();
    const entry = (await bytes(DIR + '/capture-entry.mjs')).toString();
    assert.deepEqual(captureStructure(s, entry), {captureOwnerConstructionSites:1,modelSessionCreationSites:1,guardedSessionRunSites:1});
    for (const token of ['runs >= 228','loads !== 1','attempted !== runs',"executionProviders: ['webgpu']","graphOptimizationLevel: 'disabled'"]) assert.ok(s.includes(token));
    assert.ok(!/decodeRobustPiano|decodeXc2|onsetThreshold|frameThreshold|warmup|fallback.*true/.test(s));
    assert.ok(entry.indexOf('trace.browserInputsVerified = prepared.size') < entry.indexOf('new Worker('));
  });
  await test('exact model/ORT assets already hash verified, no FIR or source PCM served during capture', async () => {
    const config = await load(DIR + '/stage-a-config.json');
    assert.equal(config.assets['/model.onnx'].sha256, '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3');
    assert.ok(!Object.keys(config.assets).some(p => /fir|pcm|truth/.test(p)));
    for (const a of Object.values(config.assets)) { const b = await bytes(a.path); assert.equal(hash(b), a.sha256); assert.equal(b.length,a.bytes); }
  });
  await test('baseline graph imports actual production decoder/publication, never model session', () => {
    const g = graphs.find(g => g.entry.endsWith('/baseline.ts')); graphGate(g.inputs,'baseline');
    assert.ok(g.inputs.some(p => p.endsWith('/robust-piano-decoder.ts'))); assert.ok(g.inputs.some(p => p.endsWith('/source-publication.ts')));
    assert.ok(!g.inputs.some(p => /model-inference|onnxruntime/.test(p)));
  });
  let structural;
  await test('structural decoder-call AST resolves one local binding/call and excludes report metadata', async () => {
    const s = (await bytes(DIR + '/baseline.mjs')).toString();
    structural = baselineStructure(s, (await bytes(DIR + '/baseline.ts')).toString());
    assert.equal(structural.decoderCallExpressions,1); assert.equal(structural.reportMetadataObjects,1);
    assert.equal(structural.reportMetadataCountedAsDecoderCall,false);
    assert.ok(s.indexOf('proof.remoteVerifiedAt < startedAt') < s.indexOf('await import('));
  });
  await test('AST rejects aliases/computed calls/second imports/wrappers and threshold/grid alternatives', async () => {
    const source = (await bytes(DIR + '/baseline.mjs')).toString(), wrapper = (await bytes(DIR + '/baseline.ts')).toString();
    const threshold = '{ onsetThreshold: 0.30, frameThreshold: 0.05 }';
    const prefix = "const { decodeRobustPiano, sourcePublication } = await import(pathToFileURL(path.join(ROOT, bundle.path)).href);";
    const loop = body => prefix + 'for(const blob of manifest.blobs){for(const w of manifest.windows.filter(w => w.jobId === blob.jobId)){' + body + '}}'
      + 'const report={thresholds:' + threshold + '};';
    const call = 'decodeRobustPiano(raw,0,' + threshold + ')';
    assert.throws(() => baselineStructure(loop(call+';'+call+';'),wrapper));
    assert.throws(() => baselineStructure(loop('const alias=decodeRobustPiano; alias(raw,0,'+threshold+');'),wrapper));
    assert.throws(() => baselineStructure(loop('decodeRobustPiano.call(null,raw,0,'+threshold+');'),wrapper));
    assert.throws(() => baselineStructure(loop('module["decodeRobustPiano"](raw,0,'+threshold+');'),wrapper));
    assert.throws(() => baselineStructure('import {decodeRobustPiano as other} from "other-decoder";'+source,wrapper));
    assert.throws(() => baselineStructure(loop('function another(){return '+call+';} another();'),wrapper));
    assert.throws(() => baselineStructure(loop('for(const onset of [.15,.30]){'+call+';}'),wrapper));
    assert.throws(() => baselineStructure(source.replace('onsetThreshold: 0.30','onsetThreshold: 0.35'),wrapper));
    assert.throws(() => baselineStructure(source,wrapper+'\nexport { anotherDecoder } from "elsewhere";'));
    assert.throws(() => baselineStructure(source+'\nmodule["decodeRobustPiano"](raw,0,'+threshold+');',wrapper));
  });
  await test('HTTP server fixed asset/input/raw allowlist; no directory serving', async () => {
    const s = (await bytes(DIR + '/capture.mjs')).toString();
    assert.ok(s.includes('files.has(route)')); assert.ok(s.includes('res.statusCode = 403')); assert.ok(s.includes('allowedFiles.has(p)'));
    assert.ok(!/serveStatic|express\.static/.test(s));
  });
  await test('corpus identity depends on deterministic ordered input and raw tensor hashes', () => {
    const r = {jobId:'j',runOrdinal:0,runtimeWindow:{windowIndex:0},inputSha256:'a',onsetSha256:'b',frameSha256:'c',pairSha256:'d'};
    assert.equal(corpusIdentity([r]),corpusIdentity([structuredClone(r)]));
    assert.notEqual(corpusIdentity([r]),corpusIdentity([{...r,frameSha256:'x'}]));
  });
  await save(OUT + '/pre-execution-tests.json', { passed:tests.length,failed:0,tests,structural,newNeuralRuns:0,decoderRuns:0,localNotCI:true });
} else if (mode === 'post') {
  await verify();
  const m = await load(OUT + '/tensor-corpus-manifest.json'), p = await load(OUT + '/baseline-parity.json');
  await test('Stage A one session, 228 accounted runs/pairs, zero unknown/warmup/decoder/truth/product runs', () => {
    assert.equal(m.receipt.modelSessionLoads,1); assert.equal(m.receipt.modelSessionRuns,228); assert.equal(m.receipt.attemptedSessionRuns,228);
    assert.equal(m.receipt.successfulSessionRuns,228); assert.equal(m.receipt.failedSessionRuns,0); assert.equal(m.receipt.modelSessionLoadAttempts,1);
    assert.equal(m.receipt.captureWorkerConstructions,1); assert.equal(m.receipt.rawTensorPairs,228);
    for (const k of ['unknownRuns','hiddenWarmupRuns','decoderRuns','truthAccessCount','productVerdictRuns']) assert.equal(m.receipt[k],0);
    assert.equal(m.jobFinalReadbacks.length,18); assert.deepEqual(m.finalReadbackFailures,[]);
    assert.equal(m.workers.filter(w=>w.classification==='V20_CAPTURE_OWNER').length,1);
    assert.ok(m.workers.every(w=>['V20_CAPTURE_OWNER','ORT_RUNTIME_SUBORDINATE'].includes(w.classification)));
  });
  await test('18 readback job blobs, all228 pair/tensor LE hashes and exact corpus bytes', async () => {
    assert.equal(m.blobs.length,18); assert.equal(m.windows.length,228); let size=0;
    for (const blob of m.blobs) { const b=await bytes(blob.path); assert.equal(hash(b),blob.sha256); size+=b.length;
      for (const w of m.windows.filter(w=>w.jobId===blob.jobId)) { const raw=b.subarray(w.byteOffset,w.byteOffset+PAIR_BYTES);
        assert.equal(raw.length,PAIR_BYTES); assert.equal(hash(raw),w.pairSha256); assert.equal(hash(raw.subarray(0,TENSOR_BYTES)),w.onsetSha256);
        assert.equal(hash(raw.subarray(TENSOR_BYTES)),w.frameSha256); assert.equal(decodeLE(raw).length,VALUES*2); }
    } assert.equal(size,CORPUS_BYTES); assert.equal(m.corpusCanonicalSha256,corpusIdentity(m.windows));
  });
  await test('raw seal remotely established before any baseline decode; baseline228 only and zero neural', () => {
    assert.ok(p.rawSealRemoteProof.remoteVerifiedAt < p.startedAt); assert.equal(p.receipt.neuralRuns,0);
    assert.equal(p.receipt.baselineDecoderRuns,228); assert.equal(p.receipt.alternativeThresholdDecoderRuns,0); assert.equal(p.receipt.productVerdictRuns,0);
  });
  await test('all V7 observations and all34 V15 acoustic assemblies reproduce exactly', () => {
    assert.deepEqual(p.mismatches,[]); assert.equal(p.jobs.length,18); assert.equal(p.legacyMembership.length,34);
    assert.ok(p.legacyMembership.every(r=>r.missingCount===0)); assert.equal(p.orderingAndCardinalityExact,true);
  });
  await test('V18/runtime, production, Continuous and all historical evidence still unchanged', scope);
  await save(OUT + '/post-execution-tests.json', { passed:tests.length,failed:0,tests,scope:'Read-only assertions; no neural or decoder rerun',localNotCI:true });
} else throw Error('Only pre/post metadata and synthetic integrity tests.');
console.log(JSON.stringify({mode,passed:tests.length,failed:0}));
} catch (error) {
  await save(OUT + '/test-failure.json', { mode, passedBeforeFailure:tests, failed:1, error:String(error.stack ?? error),
    disposition:mode==='pre'?'ROBUST_V20_PREFREEZE_TOOLING_INTEGRITY_BLOCKED':'ROBUST_V20_RAW_TENSOR_BASELINE_PARITY_FAILURE',
    stop:true, rerunAllowed:false }); throw error;
}
