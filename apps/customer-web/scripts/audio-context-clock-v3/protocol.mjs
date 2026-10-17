import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, APP, MODEL, FIXTURE, git, hash, newJson, fileIdentity } from '../audio-context-clock/protocol.mjs';
export { ROOT, APP, MODEL, FIXTURE, git, hash, newJson, fileIdentity };
export const START = 'd67adf0f9a25af540abccc3fdb2e68a81fa06592';
export const PHASE = 'PRACTICE_CONTINUOUS_PERFORMANCE_TIME_IDENTITY_REPAIR_AND_CLOCK_GATE_V3';
export const WORK = path.join(ROOT, 'backend/data/work/continuous_audio_clock_v3');
export const REPORTS = path.join(ROOT, 'backend/research/reports');
export const FREEZE = path.join(REPORTS, 'continuous_audio_context_clock_v3_freeze_2026-10-17.json');
export const SUCCESS = 'CONTINUOUS_AUDIO_CONTEXT_CLOCK_CONTRACT_READY_FOR_CONTROLLER_INTEGRATION';
export const BLOCKED = 'CONTINUOUS_AUDIO_CONTEXT_CLOCK_CONTRACT_V3_BLOCKED';
export function gateStatus(cells) {
  if (cells.every(c => c.state === 'NOT_STARTED')) return 'NOT_STARTED';
  if (cells.every(c => c.state === 'PASS')) return 'PASS';
  return 'PARTIAL_EXECUTION_BLOCKED';
}
export async function freeze() {
  if (git('status', '--porcelain')) throw new Error('UNCOMMITTED_SOURCE');
  const files = git('ls-files', 'apps/customer-web', 'backend/app/modules/model_assets', 'backend/tests/test_continuous_model_asset.py',
    'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs', 'backend/research/history/continuous-clock-contract-v1-output-timestamp').split('\n').filter(Boolean);
  await newJson(FREEZE, { phase: PHASE, startingHead: START, implementationCommit: git('rev-parse', 'HEAD'), createdAt: new Date().toISOString(),
    files: await Promise.all(files.map(fileIdentity)),
    assets: await Promise.all([MODEL, FIXTURE, ...['package.json', 'dist/ort.webgpu.min.mjs', 'dist/ort-wasm-simd-threaded.jsep.mjs',
      'dist/ort-wasm-simd-threaded.jsep.wasm'].map(p => `apps/customer-web/node_modules/onnxruntime-web/${p}`)].map(fileIdentity)),
    numericAudit: {
      forwardHelper: 'activeElapsedStartMs + (sessionTimeMs - clockStartMs)', inverseHelper: 'clockStartMs + (activeElapsedMs - activeElapsedStartMs)',
      changedExpressions: [
        { location: 'activeElapsedAt current segment', before: 'activeElapsedStartMs + nowMs - clockStartMs', after: 'activeElapsedAtSessionTime(segment, nowMs)' },
        { location: 'activeElapsedForCapture list branch', before: 'activeElapsedStartMs + captureTimeMs - clockStartMs', after: 'activeElapsedAtSessionTime(segment, captureTimeMs)' },
        { location: 'activeElapsedForCapture explicit current branch', before: 'activeElapsedStartMs + captureTimeMs - clockStartMs', after: 'activeElapsedAtSessionTime(currentSegment, captureTimeMs)' },
        { location: 'sessionMsForActiveElapsed closed segment end', before: 'activeElapsedStartMs + clockEndMs - clockStartMs', after: 'activeElapsedAtSessionTime(segment, clockEndMs)' },
        { location: 'sessionMsForActiveElapsed inverse mapping', before: 'clockStartMs + activeElapsedMs - activeElapsedStartMs', after: 'sessionTimeAtActiveElapsed(segment, activeElapsedMs)' },
      ],
      unchangedSubtractions: ['count-in remaining/duration fractions', 'scope nominal end minus start', 'performance elapsed minus count-in',
        'timebase runtime origin subtraction (already one-domain delta)', 'MIDI grace subtraction outside PerformanceClock'],
      noSearchOrderOrLifecycleChange: true,
    },
    architecture: 'AUDIO_CONTEXT_RENDER_TIMELINE_IS_THE_CONTINUOUS_MICROPHONE_LOCAL_CLOCK',
    clockEntry: 'apps/customer-web/scripts/audio-context-clock/entry.ts',
    clockLatch: 'apps/customer-web/scripts/audio-context-clock/latch.ts',
    reasonForHarnessReuse: 'V2 same-context/latch/scenario architecture retained, with explicit resume delta and natural-terminal completion source-frame witnesses added. No V2 acceptance evidence reused; all eight cells execute anew against repaired product source.',
    protocol: { order: ['verification', 'Gate 1 both rates', 'Gate 2 all eight cells'], sourceRates: [44100, 48000],
      gate1: { entry: 'apps/customer-web/scripts/continuous-capture-qualification-entry.ts', actualModelRunsExpected: 4,
        actualWorker: true, WebGPU: true, offlineAfterAssets: true, stopBeforeGate2OnFailure: true },
      gate2: { scenarios: ['A', 'B', 'C', 'D'], neuralRuns: 0, boundaryFormula: 'round(C*R)-O',
        minimumLeadSamples: 0, maximumDurationMismatchSourceSamples: 1,
        resume: 'pausePerformanceTimeMs === resumePerformanceTimeMs; deltaMs === 0',
        B: 'at least 10 seconds and repeated pause/resume',
        C: 'future natural scope terminal C0+600/1000 registered before source consumption; actual PerformanceClock SCOPE_COMPLETED at 600ms',
        D: 'analysis failure leaves session AudioContext and PerformanceClock running with no new publication',
        metronome: 'same injected context, non-audible pulse scheduling witness' },
      reporting: ['NOT_STARTED', 'PARTIAL_EXECUTION_BLOCKED', 'PASS'],
      failure: 'STOP without tolerance, normalization, another mapper, or controller integration' },
    model: { assetId: 'continuous-robust-browser', assetVersion: 'v1', bytes: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', ort: '1.20.1', provider: 'webgpu', automaticFallback: false,
      input: [1, 29120], output: [1, 183, 88], decoder: 'A', onset: .30, frame: .05, owned: 600, past: 1050, future: 170 },
    testPlan: ['focused numeric anchors, 512 repeated resume pairs and 1024 helper anchors', 'full Vitest with actual file count',
      'TypeScript noEmit', 'ESLint detailed JSON', 'Next production build --webpack', 'Docker model asset tests', 'report state unit tests'],
    protected: ['V1/V2 history', 'acoustic runtime exact segment equality', 'finalizer', 'CompletedContinuousEvaluation', 'FIR', 'resource policy', 'hook', 'STEP', 'capability'],
    acceptance: SUCCESS, blocked: BLOCKED, productionMicrophone: false, D4: false,
    continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED',
  });
}
export async function verify() {
  const frozen = JSON.parse(await readFile(FREEZE, 'utf8'));
  const freezeCommit = git('log', '-1', '--format=%H', '--', path.relative(ROOT, FREEZE).replaceAll('\\', '/'));
  const remoteHead = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (git('rev-parse', 'HEAD') !== freezeCommit || remoteHead !== freezeCommit) throw new Error('REMOTE_FREEZE_MISMATCH');
  for (const expected of [...frozen.files, ...frozen.assets]) {
    const actual = await fileIdentity(expected.path);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error('FROZEN_FILE_CHANGED:' + expected.path);
  }
  return { freezeCommit, freezeSha256: hash(await readFile(FREEZE)), remoteHead, remoteVerifiedAt: new Date().toISOString() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'freeze') await freeze();
  else if (process.argv[2] === 'verify') console.log(JSON.stringify(await verify()));
}
