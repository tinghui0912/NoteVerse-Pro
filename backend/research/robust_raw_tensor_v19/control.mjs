import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, WORK, START, BRANCH, hash, now, bytes, load, save, git } from './io.mjs';
import { encodeLE, decodeLE, assertInventory, INPUT_SAMPLES, PAIR_BYTES, CORPUS_BYTES } from './wire.mjs';

export const accepted = {
  'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json': '42bd0dcb1ed9bf2e7fa2328e18ab4f6064767d2728d7d29a8adca91af1dbfd02',
  'backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json': '27d80f956f207366f3739d8277f559f98b7ba85f4f51df7a75b7dd57da2e2c51',
  'backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic.json': '61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1',
  'backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic-seal.json': '5ffdb33b8f34791249f40e8c7b6c778b6d93a5f362b305b77120269ceb933f85',
  'backend/research/reports/step_runtime_verdict_v18/assessment.json': null,
  'backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json': '290c41185e488bfb6d08fd50b193d175ba5941ed37171ba2db73e969339e8b8a'
};
export async function scope() {
  assert.equal(git('merge-base', START, 'HEAD'), START);
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(changed.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'PRODUCTION_OR_HISTORICAL_MUTATION');
  for (const [p, sha] of Object.entries(accepted)) if (sha) assert.equal(hash(await bytes(p)), sha, 'ACCEPTED_IDENTITY:' + p);
  return changed;
}
export function graphGate(inputs, phase) {
  const bad = /step-runtime|step-attempt|finalizer|scorer|scenario|truth|target-policy|policy\.mjs|v17|v18/i;
  assert.ok(inputs.every(p => !bad.test(p)), 'TRUTH_OR_PRODUCT_GRAPH');
  if (phase === 'capture') assert.ok(inputs.every(p => [DIR + '/capture-entry.mjs', DIR + '/capture-worker.mjs', DIR + '/wire.mjs'].includes(p)), 'CAPTURE_GRAPH_NOT_RAW_ONLY');
  if (phase === 'prepare') assert.ok(inputs.every(p => !/model-inference|worker|decoder|onnxruntime/.test(p)), 'PREPARE_REACHES_NEURAL');
  if (phase === 'baseline') assert.ok(inputs.every(p => !/model-inference|worker-client|onnxruntime|capture-worker/.test(p)), 'BASELINE_REACHES_NEURAL');
}
async function builder() { return import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href); }
async function bundle(entry, output, platform, phase) {
  const b = await builder(), p = path.join(ROOT, WORK, output);
  const result = await b.build({ absWorkingDir: ROOT, entryPoints: [DIR + '/' + entry], outfile: p, bundle: true,
    metafile: true, platform, format: 'esm', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'pinned-ort', setup(build) { build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, () => ({ path: '/ort/ort.webgpu.min.mjs', external: true })); } }] });
  const inputs = Object.keys(result.metafile.inputs); graphGate(inputs, phase);
  return { entry: DIR + '/' + entry, path: WORK + '/' + output, sha256: hash(await bytes(WORK + '/' + output)),
    inputs, esbuildVersion: b.version, platform };
}
async function prepare() {
  await scope();
  const graph = await bundle('prepare-inputs.ts', 'prepare.mjs', 'node', 'prepare');
  const { reconstruct } = await import(pathToFileURL(path.join(ROOT, graph.path)).href);
  const opaque = await load(Object.keys(accepted)[0]), strongest = await load(Object.keys(accepted)[1]);
  const v7 = await load(Object.keys(accepted)[2]), oldAssets = await load('backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json');
  assert.equal(opaque.jobs.length, 18); assert.equal(strongest.totalCases, 9); assert.equal(strongest.mismatches, 0);
  const jobs = [], inputs = []; let ordinal = 0;
  await mkdir(path.join(ROOT, WORK, 'inputs'), { recursive: true });
  for (const j of opaque.jobs) {
    const strongestRows = strongest.results.filter(s => s.jobId === j.jobId), oldRows = v7.trace.results.filter(s => s.jobId === j.jobId);
    assert.equal(strongestRows.length, 1); assert.equal(oldRows.length, 1);
    const strong = strongestRows[0], old = oldRows[0], sourceBytes = await bytes(j.pcmPath);
    assert.equal(hash(sourceBytes), j.pcmSha256); assert.equal(sourceBytes.length, j.frames * 4);
    const fir = await bytes(oldAssets.assets['/fir-' + j.sourceRateHz + '.f32'].path);
    const reconstructed = await reconstruct(decodeLE(sourceBytes), j.sourceRateHz, fir, j.sourceOriginSample, j.regionStartSourceSample, old.regionEndSourceSample);
    assert.equal(reconstructed.identity, strong.qualifiedAdapterIdentity);
    assert.equal(reconstructed.windows.length, j.expectedModelInputs.length);
    const chunks = [], windows = [];
    for (const [i, got] of reconstructed.windows.entries()) {
      const expected = j.expectedModelInputs[i], s = strong.modelInputs[i], b = encodeLE(got.pcm);
      assert.equal(got.pcm.length, INPUT_SAMPLES); assert.equal(hash(b), expected.sha256);
      assert.equal(hash(b), s.sha256); assert.equal(hash(b), s.referenceSha256);
      assert.deepEqual(got.window, old.inputs[i].runtimeWindow);
      assert.equal(hash(b), old.inputs[i].actualSha256);
      const w = { runOrdinal: ordinal++, samples: INPUT_SAMPLES, inputByteOffset: i * INPUT_SAMPLES * 4,
        inputBytes: b.length, inputSha256: hash(b), runtimeWindow: got.window,
        sourceInputStart: j.sourceOriginSample + got.window.startSample * j.sourceRateHz / 16000,
        sourceInputEnd: j.sourceOriginSample + got.window.endSample * j.sourceRateHz / 16000,
        originalTarget16kStart: s.originalTarget16kStart, originalTarget16kEnd: s.originalTarget16kEnd,
        originalOwnedStart: s.originalOwnedStart, originalOwnedEnd: s.originalOwnedEnd };
      windows.push(w); chunks.push(b); inputs.push({ jobId: j.jobId, sourceCaseId: strong.audioBoundCaseId,
        sourceRateHz: j.sourceRateHz, sourceDomainId: j.sourceDomainId, sourceOriginSample: j.sourceOriginSample, ...w,
        strongestV6Sha256: s.sha256, strongestV6ReferenceSha256: s.referenceSha256, exactV7WindowCoordinates: true });
    }
    const inputBlobPath = WORK + '/inputs/' + j.jobId + '.f32', data = Buffer.concat(chunks);
    await writeFile(path.join(ROOT, inputBlobPath), data, { flag: 'wx' });
    assert.equal(hash(await bytes(inputBlobPath)), hash(data));
    jobs.push({ jobId: j.jobId, sourceCaseId: strong.audioBoundCaseId, sourceDomainId: j.sourceDomainId,
      sourceRateHz: j.sourceRateHz, sourceOriginSample: j.sourceOriginSample,
      inputBlobPath, inputBlobSha256: hash(data), windows });
    console.log(JSON.stringify({ jobId: j.jobId, rate: j.sourceRateHz, inputs: windows.length, mismatches: 0 }));
  }
  const manifest = { schema: 'V19_OPAQUE_FROZEN_MODEL_INPUTS_ONLY', jobs }; assertInventory(manifest);
  assert.equal(ordinal, 228);
  await save(WORK + '/inputs.json', manifest);
  await save(OUT + '/input-preservation.json', { preparedAt: now(), totalCases: 9, totalJobs: 18, totalInputs: 228,
    mismatches: 0, sourceRates: [44100,48000], canonicalInputFormat: 'IEEE754_FLOAT32_LITTLE_ENDIAN',
    opaqueInputManifestPath: WORK + '/inputs.json', opaqueInputManifestSha256: hash(await bytes(WORK + '/inputs.json')),
    preparationGraph: graph, inputs, modelLoads: 0, neuralRuns: 0, pcmDecodeRuns: 0,
    provenance: 'Existing decoded/prepared PCM reused without codec decode. Outer preparer reads input-preservation and V7 window metadata only, not truth pitch/target fields. Capture process receives only opaque inputs.' });
}
async function build() {
  await scope();
  const graphs = [await bundle('capture-entry.mjs', 'capture-entry.js', 'browser', 'capture'),
    await bundle('capture-worker.mjs', 'capture-worker.js', 'browser', 'capture'),
    await bundle('baseline.ts', 'baseline.mjs', 'node', 'baseline')];
  await save(OUT + '/bundle-graphs.json', { graphs, captureForbiddenImports: [], baselineNeuralImports: [] });
  const prior = await load('backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json'), assets = {};
  for (const [route, a] of Object.entries(prior.assets)) if (!route.startsWith('/fir-')) {
    const b = await bytes(a.path); assert.equal(b.length, a.bytes); assert.equal(hash(b), a.sha256); assets[route] = a;
  }
  const manifest = await load(WORK + '/inputs.json'); assertInventory(manifest);
  // Outer projection copies acoustic fields only. Neither capture nor baseline needs truth/targets/verdicts.
  const v7 = await load(Object.keys(accepted)[2]);
  const v15 = await load('backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json');
  await save(OUT + '/baseline-reference.json', { schema: 'ACOUSTIC_ONLY_EXISTING_V7_V15_PARITY_REFERENCE',
    v7Sha256: accepted[Object.keys(accepted)[2]], v15Sha256: accepted['backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json'],
    jobs: v7.trace.results.map(j => ({ jobId: j.jobId, publications: j.publications.map(p => ({ sourceDomainId: p.sourceDomainId,
      sourceSampleRateHz: p.sourceSampleRateHz, window: p.window, observations: p.observations })) })),
    legacyAssemblies: v15.cells.flatMap(c => c.traces.map(t => ({ jobId: c.jobId, observations: t.assembly.observations }))),
    omitted: ['truth','family','target','verdict','scenario','availabilityTimeMs'] });
  await save(DIR + '/stage-a-config.json', { schema: 'V19_RAW_CAPTURE_ASSETS_AND_OPAQUE_INPUTS_ONLY',
    modelIdentity: prior.modelIdentity, ORT: prior.ortVersion, provider: 'webgpu', graphOptimizationLevel: 'disabled', automaticFallback: false,
    assets, manifest: { path: WORK + '/inputs.json', sha256: hash(await bytes(WORK + '/inputs.json')) },
    bundles: graphs.filter(g => g.platform === 'browser'), expectedJobs: 18, expectedInputs: 228,
    expectedPairBytes: PAIR_BYTES, expectedRawBytes: CORPUS_BYTES });
}
async function freeze() {
  await scope(); const manifest = await load(WORK + '/inputs.json'); assertInventory(manifest);
  const history = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) history.push({ path: p, sha256: hash(await bytes(p)) });
  await save(OUT + '/historical-raw-identities.json', { startingHead: START, files: history });
  const config = await load(DIR + '/stage-a-config.json'), graphs = (await load(OUT + '/bundle-graphs.json')).graphs;
  const prod = git('ls-files', 'apps/customer-web/src/lib/practice/acoustic', 'apps/customer-web/src/lib/practice/local-core',
    'apps/customer-web/src/lib/practice/step', 'apps/customer-web/src/lib/practice/input-capability.ts').split('\n').filter(Boolean);
  const paths = [...new Set([...(await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p), ...Object.keys(accepted),
    ...Object.values(config.assets).map(a => a.path), ...graphs.map(g => g.path), ...graphs.flatMap(g => g.inputs),
    ...manifest.jobs.map(j => j.inputBlobPath), WORK + '/inputs.json', ...prod,
    OUT + '/input-preservation.json', OUT + '/bundle-graphs.json', OUT + '/baseline-reference.json', OUT + '/historical-raw-identities.json',
    OUT + '/pre-execution-tests.json', OUT + '/local-verification.json'])].sort();
  const files = []; for (const p of paths) files.push({ path: p, sha256: hash(await bytes(p)) });
  await save(OUT + '/capture-protocol-freeze.json', { role: 'V19_EXPOSED_RAW_TENSOR_CAPTURE_PROTOCOL_FREEZE', startingHead: START,
    createdAt: now(), contract: await load(DIR + '/contract.json'), files, modelRunsBeforeFreeze: 0, decoderRunsBeforeFreeze: 0,
    initialGitHub: { queriedAt: '2026-10-19T08:29:20.475333+00:00', combinedState: 'pending', statuses: [], workflow_runs: [], ciInterpretation: 'NOT CI PASS' } });
  console.log(JSON.stringify({ frozenFiles: files.length, historyFiles: history.length, freezeSha256: hash(await bytes(OUT + '/capture-protocol-freeze.json')) }));
}
export async function verify() {
  await scope(); const f = await load(OUT + '/capture-protocol-freeze.json');
  for (const x of [...f.files, ...(await load(OUT + '/historical-raw-identities.json')).files]) assert.equal(hash(await bytes(x.path)), x.sha256, 'FROZEN_MUTATION:' + x.path);
  return f;
}
async function proof() {
  await verify(); const head = git('rev-parse', 'HEAD');
  assert.equal(git('rev-parse', 'origin/' + BRANCH), head); assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], head);
  await save(OUT + '/remote-capture-permission.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: hash(await bytes(OUT + '/capture-protocol-freeze.json')), configSha256: hash(await bytes(DIR + '/stage-a-config.json')),
    inputPreservationSha256: hash(await bytes(OUT + '/input-preservation.json')), newNeuralRuns: 0, baselineStageB: 'NOT_STARTED' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    if (mode === 'prepare') await prepare(); else if (mode === 'build') await build();
    else if (mode === 'freeze') await freeze(); else if (mode === 'proof') await proof();
    else if (mode === 'verify') { await verify(); console.log('FROZEN_FILES_AND_PRODUCTION_SCOPE_PASS'); }
    else throw Error('Allowed: prepare/build/freeze/proof/verify. No model execution here.');
  } catch (error) {
    const disposition = process.argv[2] === 'prepare' ? 'ROBUST_V19_MODEL_INPUT_REPRODUCTION_INTEGRITY_BLOCKED' : 'ROBUST_V19_RAW_TENSOR_CAPTURE_INTEGRITY_BLOCKED';
    await save(OUT + '/control-failure.json', { at: now(), command: process.argv[2], disposition, failure: String(error.stack ?? error), stopped: true });
    throw error;
  }
}
