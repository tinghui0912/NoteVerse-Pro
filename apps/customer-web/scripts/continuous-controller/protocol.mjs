import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, APP, MODEL, FIXTURE, git, hash, newJson, fileIdentity } from '../audio-context-clock/protocol.mjs';
export { ROOT, APP, MODEL, FIXTURE, git, hash, newJson, fileIdentity };
export const START = '65b122d9f3b1185a9bf33e4b787a7595e4fccdd2';
export const PHASE = 'PRACTICE_CONTINUOUS_APPLICATION_ORCHESTRATION_CLEAN_INTEGRATION_DISABLED';
export const SUCCESS = 'CONTINUOUS_APPLICATION_CONTROLLER_INTEGRATED_MICROPHONE_DISABLED';
export const BLOCKED = 'CONTINUOUS_APPLICATION_ORCHESTRATION_BLOCKED';
export const paths = (id = 'v1') => ({ work: path.join(ROOT, 'backend/data/work/continuous_controller', id),
  freeze: path.join(ROOT, `backend/research/reports/continuous_controller_freeze_${id}_2026-10-17.json`) });
export async function freeze(id = 'v1') {
  if (git('status', '--porcelain')) throw new Error('UNCOMMITTED_SOURCE');
  const files = git('ls-files', 'apps/customer-web', 'docs/architecture/practice-product-contract-v2.md', 'backend/app/modules/model_assets',
    'backend/tests/test_continuous_model_asset.py', 'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs',
    'backend/research/history/continuous-controller-alternate-executables').split('\n').filter(Boolean);
  await newJson(paths(id).freeze, { phase: PHASE, freezeId: id, startingHead: START, productImplementationCommit: git('rev-parse', 'HEAD'),
    qualificationToolingCommit: git('rev-parse', 'HEAD'), createdAt: new Date().toISOString(), files: await Promise.all(files.map(fileIdentity)),
    assets: await Promise.all([MODEL, FIXTURE,
      ...(id === 'v1' ? [] : ['invalidation', 'browser', 'verification', 'final'].map(kind => `backend/research/reports/continuous_controller_${kind}_v1_2026-10-17.json`)),
      ...['package.json', 'dist/ort.webgpu.min.mjs', 'dist/ort-wasm-simd-threaded.jsep.mjs',
      'dist/ort-wasm-simd-threaded.jsep.wasm'].map(p => `apps/customer-web/node_modules/onnxruntime-web/${p}`)].map(fileIdentity)),
    product: { owner: 'ContinuousPracticeController', oneSessionAndEvaluator: true, finalizerUnchanged: true,
      clock: 'One session-owned AudioContext render timeline with synchronous single-read transaction',
      stream: 'One root acquisition with independent analysis and recorder clones',
      boundaryScheduler: 'Stable IDs; pending-only cancellation; max8 pending,32 compact diagnostic entries; no tombstones',
      completion: 'ENDED -> FINALIZING -> real tail + exact-T publication + same evaluator + recorder + awaited final resource cleanup -> COMPLETE/store/notify',
      failure: 'Analysis-only failure never controls clock, metronome, recorder, root stream or shared context',
      readiness: 'Read-only, covers partial initial windows: real past >= inputMs-futureMs (1650ms) plus existing FIR boundary guard. No changed geometry or zero padding.',
      diagnostics: '32 compact controller records, no observations; existing acoustic resource limits unchanged',
      transientResources: { targetRingBytes: 262144, maxOutstanding: 4, maximumInputPayloadBytes: 465920, workletCredits: 32, maximumBlockSamples: 2048 } },
    model: { assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1', bytes: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', ort: '1.20.1', provider: 'webgpu', automaticFallback: false,
      input: [1, 29120], decoder: 'A', onset: .30, frame: .05, owned: 600, past: 1050, future: 170 },
    browser: { rates: [44100, 48000], headed: true, realWorker: true,
      scenarios: ['natural_recording_offline', 'count_in_cancel_multiple_pause_manual_stop', 'pause_near_terminal_resume_natural', 'recording_analysis_failure_running'],
      neuralRunBound: 'Only fixed short controller scenarios; shared fixed model, no accuracy scoring or parameter comparison',
      failureScenario: 'Pause and drain real model first, resume then fail idle worker; exact actual run count remains observable',
      assertions: ['same context', 'one root acquisition', 'all root/clone resources eventually released', 'exact pause/resume identity',
        'no stale BEGIN/TERMINAL', 'boundary lead>=0', 'terminal exact-T', 'one evaluator', 'recording mapping', 'offline after ready', 'analysis failure isolated'] },
    testPlan: ['controller lifecycle tests', 'MIDI regression', 'Continuous core/acoustic tests', 'recorder/metronome ownership',
      'AST import graph architecture tests', 'full Vitest', 'full TypeScript noEmit', 'ESLint complete JSON', 'full Next build --webpack', 'Docker model asset tests'],
    acceptance: SUCCESS, blocked: BLOCKED, productionMicrophone: false, D4: false, continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED',
    nonClaims: ['real device', 'native hardware rate', 'natural piano accuracy', 'UX latency SLO', 'commercial qualification'] });
}
export async function verify(id = 'v1') {
  const file = paths(id).freeze, plan = JSON.parse(await readFile(file, 'utf8'));
  const freezeCommit = git('log', '-1', '--format=%H', '--', path.relative(ROOT, file).replaceAll('\\', '/'));
  const remoteHead = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (git('rev-parse', 'HEAD') !== freezeCommit || remoteHead !== freezeCommit) throw new Error('REMOTE_FREEZE_MISMATCH');
  for (const expected of [...plan.files, ...plan.assets]) {
    const actual = await fileIdentity(expected.path); if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error('FROZEN_FILE_CHANGED:' + expected.path);
  }
  return { freezeId: id, freezeCommit, freezeSha256: hash(await readFile(file)), remoteHead, remoteVerifiedAt: new Date().toISOString() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'freeze') await freeze(process.argv[3]);
  else if (process.argv[2] === 'verify') console.log(JSON.stringify(await verify(process.argv[3])));
}
