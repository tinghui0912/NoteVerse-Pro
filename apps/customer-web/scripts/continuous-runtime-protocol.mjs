import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const APP = path.join(ROOT, 'apps/customer-web');
export const START = 'ae0408df03dfd19447b6191fbee7688cd0fd4edf';
export const PHASE = 'PRACTICE_CONTINUOUS_MICROPHONE_RUNTIME_CLEAN_PROMOTION_DISABLED';
export const WORK = path.join(ROOT, 'backend/data/work/continuous_microphone_runtime');
export const MODEL = 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx';
export const FIXTURE = 'backend/data/work/xc6_capture/fake-device.wav';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
export async function fileIdentity(relative) {
  const bytes = await readFile(path.join(ROOT, relative)); return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
}
export async function newJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export const freezePath = id => path.join(ROOT, `backend/research/reports/continuous_microphone_runtime_freeze_${id}_2026-10-17.json`);
export async function freeze(id) {
  if (git('status', '--porcelain')) throw new Error('IMPLEMENTATION_MUST_BE_COMMITTED_CLEAN');
  const paths = git('ls-files', 'apps/customer-web', 'backend/app/modules/model_assets', 'backend/tests/test_continuous_model_asset.py',
    'backend/scripts/qualify_continuous_robust_asset.py', 'backend/research/history/continuous-acoustic-before-promotion',
    'backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs', 'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs',
    'docs/architecture/practice-product-contract-v2.md').split('\n').filter(Boolean);
  const assets = [MODEL, FIXTURE];
  const dspPath = 'backend/data/work/xc6_capture/dsp48_reference.json';
  const dsp = JSON.parse(await readFile(path.join(ROOT, dspPath), 'utf8'));
  assets.push(dspPath, ...dsp.fixtures.flatMap(f => [f.input, f.reference].map(name => `backend/data/work/xc6_capture/${name}`)));
  assets.push('backend/data/work/xc7_bounded/fast_parity_44100_v1.json', 'backend/data/work/xc7_bounded/fast_parity_48000_v1.json');
  assets.push(...['package.json', 'dist/ort.webgpu.min.mjs', 'dist/ort-wasm-simd-threaded.jsep.mjs', 'dist/ort-wasm-simd-threaded.jsep.wasm']
    .map(name => `apps/customer-web/node_modules/onnxruntime-web/${name}`));
  await newJson(freezePath(id), { phase: PHASE, freezeId: id, startingHead: START, implementationCommit: git('rev-parse', 'HEAD'),
    createdAt: new Date().toISOString(), files: await Promise.all(paths.map(async relative => ({ ...await fileIdentity(relative),
      gitBlobId: git('rev-parse', `HEAD:${relative}`),
      gitBlobSha256: hash(execFileSync('git', ['show', `HEAD:${relative}`], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 })),
    }))), assets: await Promise.all(assets.map(fileIdentity)),
    model: { bytes: 98689283, sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', ort: '1.20.1', provider: 'webgpu', automaticFallback: false },
    acousticCoreIdentitySha256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
    geometry: { samples: 29120, rate: 16000, ownedMs: 600, futureMs: 170, pastMs: 1050, onset: .30, frame: .05, ownership: 'half-open' },
    resources: { outstanding: 4, workletCredits: 32, blockSamples: 2048, compactDiagnostics: 32, retainedDiagnosticEvents: 0,
      pendingSegments: 4, scheduledBoundaries: 8, targetRingSamples: 65536 },
    multiSegment: 'External BEGIN/PAUSE/TERMINAL source boundaries; pause is context-only; literal per-segment ownership; no clock calls from analysis.',
    terminal: 'After real tail and all inference drain, empty exact-T coverage. Pause remains previousFloat(T).',
    tests: ['all acoustic tests including 30min fake port', 'all local-core/Practice via full Vitest', 'tsc --noEmit', 'ESLint JSON messages', 'Next build --webpack', 'Docker backend asset tests'],
    browserPlan: { sourceRates: [44100, 48000], runsPerRate: 2, repeatedModelComparisons: 0, fixture: FIXTURE,
      realWorker: true, headedChrome: true, fakeGetUserMedia: true, offlineAfterAssetsReady: true, pauseResume: true, realDevice: false },
    acceptance: 'All tests/typecheck/lint/build and both source-rate real Worker/WebGPU capture qualifications pass; model exact; product core unchanged; disabled capabilities.',
    counters: { newExternalDatasets: 0, scientificBenchmarks: 0, parameterSweeps: 0, realDeviceProbes: 0 },
    capability: { continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
  });
}
export async function verifyRemoteFreeze(id) {
  const file = freezePath(id), plan = JSON.parse(await readFile(file, 'utf8'));
  const freezeCommit = git('log', '-1', '--format=%H', '--', path.relative(ROOT, file).replaceAll('\\', '/'));
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (remote !== freezeCommit || git('rev-parse', 'HEAD') !== freezeCommit) throw new Error('REMOTE_FREEZE_HEAD_MISMATCH');
  for (const expected of [...plan.files, ...plan.assets]) {
    const actual = await fileIdentity(expected.path);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error('FROZEN_SOURCE_OR_ASSET_CHANGED:' + expected.path);
  }
  return { phase: PHASE, freezeId: id, freezeCommit, freezeSha256: hash(await readFile(file)), remoteHead: remote,
    remoteVerifiedAt: new Date().toISOString(), sourceFileCount: plan.files.length, assetCount: plan.assets.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'freeze') await freeze(process.argv[3]);
  else if (process.argv[2] === 'verify') console.log(JSON.stringify(await verifyRemoteFreeze(process.argv[3])));
}
