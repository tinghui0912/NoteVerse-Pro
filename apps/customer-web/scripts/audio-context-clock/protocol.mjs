import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const APP = path.join(ROOT, 'apps/customer-web');
export const WORK = path.join(ROOT, 'backend/data/work/continuous_audio_clock_v2');
export const REPORTS = path.join(ROOT, 'backend/research/reports');
export const START = '556689315368f876e5655afa755ad262ff803d40';
export const PHASE = 'PRACTICE_CONTINUOUS_AUDIO_CONTEXT_TRANSPORT_CLOCK_CONTRACT_V2';
export const MODEL = 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx';
export const FIXTURE = 'backend/data/work/xc6_capture/fake-device.wav';
export const FREEZE = path.join(REPORTS, 'continuous_audio_context_clock_v2_freeze_2026-10-17.json');
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function newJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export async function fileIdentity(file) {
  const bytes = await readFile(path.join(ROOT, file));
  return { path: file, bytes: bytes.length, sha256: hash(bytes) };
}
export async function freeze() {
  if (git('status', '--porcelain')) throw new Error('UNCOMMITTED_SOURCE');
  const paths = git('ls-files', 'apps/customer-web', 'backend/app/modules/model_assets', 'backend/tests/test_continuous_model_asset.py',
    'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs', 'backend/research/history/continuous-clock-contract-v1-output-timestamp').split('\n').filter(Boolean);
  await newJson(FREEZE, { phase: PHASE, startingHead: START, implementationAndToolingCommit: git('rev-parse', 'HEAD'),
    createdAt: new Date().toISOString(), files: await Promise.all(paths.map(fileIdentity)),
    assets: await Promise.all([MODEL, FIXTURE, ...['package.json', 'dist/ort.webgpu.min.mjs',
      'dist/ort-wasm-simd-threaded.jsep.mjs', 'dist/ort-wasm-simd-threaded.jsep.wasm'].map(p => `apps/customer-web/node_modules/onnxruntime-web/${p}`)].map(fileIdentity)),
    model: { assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1', bytes: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
      ort: '1.20.1', provider: 'webgpu', automaticFallback: false, input: [1, 29120], output: [1, 183, 88],
      decoder: 'A', onset: .30, frame: .05, ownedMs: 600, pastMs: 1050, futureMs: 170 },
    sequentialGates: [
      { gate: 1, rates: [44100, 48000], method: 'CURRENT_MODEL_NEUTRAL_INFERENCE_REAL_WORKER_WEBGPU_FAKE_MEDIA_OFFLINE',
        entry: 'apps/customer-web/scripts/continuous-capture-qualification-entry.ts', expectedModelRuns: 4,
        stop: 'Either rate fails: CONTINUOUS_MODEL_NEUTRAL_RUNTIME_REQUALIFICATION_BLOCKED. No Gate 2.' },
      { gate: 2, rates: [44100, 48000], hypothesis: 'AUDIO_CONTEXT_RENDER_TIMELINE_IS_THE_CONTINUOUS_MICROPHONE_LOCAL_CLOCK',
        clock: 'Same AudioContext.currentTime*1000; one synchronous single-read latch per transition',
        formula: 'round(C*R)-O', maxDurationMismatchSourceSamples: 1, minimumBoundaryLeadSamples: 0,
        scenarios: ['A direct active pause/resume/terminal', 'B >=10s repeated transitions',
          'C future scope-terminal source boundary registered in advance', 'D analysis failure leaves session context/clock running'],
        metronome: 'Same injected AudioContext; scheduling callbacks record pulse time and context currentTime',
        inference: 'Deterministic empty fake port, zero neural execution',
        stop: 'First consumed boundary, >1-sample mismatch, or failure-controlled clock blocks. No alternate mapper.' },
    ],
    verificationBeforeBrowser: ['full customer-web Vitest with actual file count', 'full TypeScript noEmit',
      'ESLint JSON all messages', 'Next production build --webpack', 'Docker model-asset unittest'],
    forbidden: ['getOutputTimestamp mapping', 'latency compensation', 'performance.now fitting', 'slope fitting', 'tolerance sweeps',
      'controller', 'hook changes', 'STEP changes', 'capability enablement', 'real microphone', 'finalizer changes'],
    acceptance: 'Both sequential gates plus all verification pass; internal browser timeline consistency only.',
    productionMicrophone: false, D4: false, continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED',
  });
}
export async function verify() {
  const plan = JSON.parse(await readFile(FREEZE, 'utf8'));
  const freezeCommit = git('log', '-1', '--format=%H', '--', path.relative(ROOT, FREEZE).replaceAll('\\', '/'));
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (remote !== freezeCommit || git('rev-parse', 'HEAD') !== freezeCommit) throw new Error('REMOTE_FREEZE_MISMATCH');
  for (const item of [...plan.files, ...plan.assets]) {
    const actual = await fileIdentity(item.path);
    if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) throw new Error('FROZEN_FILE_CHANGED:' + item.path);
  }
  return { freezeCommit, freezeSha256: hash(await readFile(FREEZE)), remoteHead: remote, remoteVerifiedAt: new Date().toISOString() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'freeze') await freeze();
  else if (process.argv[2] === 'verify') console.log(JSON.stringify(await verify()));
}
