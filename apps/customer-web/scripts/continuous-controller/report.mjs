import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, paths, START, PHASE, SUCCESS, BLOCKED, git, hash, newJson } from './protocol.mjs';

const mode = process.argv[2], id = process.argv[3] ?? 'v1';
const reportDir = path.join(ROOT, 'backend/research/reports');
const read = async file => JSON.parse(await readFile(file, 'utf8'));
if (mode === 'evidence') {
  const { work, freeze } = paths(id), plan = await read(freeze), verification = await read(path.join(work, 'verification.json'));
  let browser = null;
  try { browser = await read(path.join(work, 'browser.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const protectedPaths = ['apps/customer-web/src/lib/practice/local-core/performance-runtime.ts',
    'apps/customer-web/src/lib/practice/local-core/timebase.ts', 'apps/customer-web/src/lib/practice/input-capability.ts',
    'apps/customer-web/src/lib/practice/local-core/continuous-finalizer.ts', 'apps/customer-web/src/lib/practice/local-core/continuous-assignment.ts',
    'apps/customer-web/src/lib/practice/local-core/continuous-evaluation-types.ts', 'apps/customer-web/src/lib/practice/local-core/step-runtime.ts',
    'apps/customer-web/src/lib/practice/local-core/step-evidence-session.ts',
    ...git('ls-files', 'apps/customer-web/src/lib/practice/acoustic').split('\n'),
    'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts', 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-contract.ts',
    'apps/customer-web/public/model-assets/practice-acoustic/fir-160-441.f32', 'apps/customer-web/public/model-assets/practice-acoustic/fir-1-3.f32'];
  const protectedChanges = git('diff', '--name-only', START, 'HEAD', '--', ...protectedPaths);
  if (protectedChanges) throw new Error('PROTECTED_SOURCE_CHANGED:' + protectedChanges);
  const changed = git('diff', '--name-only', START, 'HEAD').split('\n');
  const priorReports = new Set(git('ls-tree', '-r', '--name-only', START, 'backend/research/reports').split('\n'));
  if (changed.some(p => priorReports.has(p))) throw new Error('HISTORICAL_REPORT_CHANGED');
  const manifest = await read(path.join(ROOT, 'backend/research/history/continuous-controller-alternate-executables/manifest.json'));
  for (const file of manifest.files) if (hash(await readFile(path.join(ROOT, file.archived))) !== file.sha256) throw new Error('ARCHIVE_BYTES_CHANGED');
  const receipts = [];
  for (const [name, value] of Object.entries({ verification, browser })) if (value) {
    const file = path.join(reportDir, `continuous_controller_${name}_${id}_2026-10-17.json`); await newJson(file, value);
    receipts.push({ path: path.relative(ROOT, file).replaceAll('\\', '/'), sha256: hash(await readFile(file)) });
  }
  const disposition = verification.status === 'PASS' && browser?.disposition === SUCCESS ? SUCCESS : BLOCKED;
  const priorInvalidation = id === 'v1' ? null : await read(path.join(reportDir, 'continuous_controller_invalidation_v1_2026-10-17.json'));
  await newJson(path.join(reportDir, `continuous_controller_final_${id}_2026-10-17.json`), {
    phase: PHASE, disposition, startingHead: START, productImplementationCommit: plan.productImplementationCommit,
    initialProductImplementationCommit: git('log', '--reverse', '--format=%H', `${START}..HEAD`, '--', 'apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts').split('\n')[0],
    qualificationToolingCommit: plan.qualificationToolingCommit, proof: browser?.proof ?? verification.proof,
    executionStartedAt: browser?.executionStartedAt, receipts, changedFiles: changed,
    moduleResponsibilities: {
      'continuous-practice-controller.ts': 'One session, transport commands, root stream/context ownership, recorder/metronome, terminal completion transaction',
      'audio-context-performance-clock.ts': 'Same-context LocalClock and single-read synchronous latch',
      'continuous-midi-input.ts': 'MIDI evidence into the existing session, no acoustic dependencies executed',
      'continuous-microphone-input.ts': 'Analysis-only model preparation, capture clone, bounded runtime, source boundaries, publication sink',
      'continuous-platform.ts': 'Browser infrastructure factories and immutable asset access',
      'capture-bridge.ts': 'One bounded chronological scheduler, stable IDs and pending-only cancellation',
      'performance-recorder.ts': 'Explicit owned microphone acquisition for MIDI recording or owned clone of session root for microphone recording',
      'use-local-practice.ts': 'Continuous subscription, command forwarding, presentation snapshot sampling',
      'use-step-local-practice.ts': 'Existing STEP hook lifecycle extracted without STEP domain or microphone changes' },
    protectedSourceAudit: { comparedTo: START, files: protectedPaths, changed: [], historicalReportsChanged: [],
      finalizerUnchanged: true, acousticParametersAndSourceAdaptersUnchanged: true, V3NumericRepairUnchanged: true },
    archive: { manifest: 'backend/research/history/continuous-controller-alternate-executables/manifest.json',
      archivedFiles: manifest.files.length, deletedExecutables: manifest.files.filter(f => f.action === 'ARCHIVE_AND_REMOVE_UNUSED_ALTERNATE_EXECUTABLE').length,
      exactCommittedBytesVerified: true, lineEndingDifferencesExplicitlyRecorded: true },
    applicationReadiness: 'Full windows require 1050ms past; arbitrary early interruption may move the same fixed 1820ms input start toward 1650ms past (1820-170). New read-only start readiness covers this limit plus existing FIR boundary guard, without changing model geometry or inserting padding.',
    publicationContract: ['publicationId', 'sessionDomainId', 'analyzedThroughPerformanceMs', 'availabilityTimeMs', 'observations[]'],
    verification: verification.results.map(r => ({ name: r.name, exitCode: r.exitCode, counts: r.counts, messages: r.messages, output: r.output })),
    browser: browser ? { status: browser.status, identity: browser.browser, actualModelRuns: browser.actualModelRuns,
      cells: browser.cells.map(c => ({ rate: c.rate, scenario: c.scenario, state: c.state, offlineAt: c.offlineAt, error: c.error,
        ...(c.result ? { actualModelRuns: c.result.actualModelRuns, trackSettings: c.result.trackSettings,
          resumeWitnesses: c.result.resumeWitnesses, resources: c.result.resources, transport: c.result.transport,
          completed: c.result.completed, engineering: c.result.engineering } : {}) })) } : { status: 'NOT_STARTED' },
    currentCapabilities: { continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    counters: { actualModelRuns: browser?.actualModelRuns ?? 0, modelRunCountComplete: browser?.modelRunCountComplete ?? true,
      previousInvalidatedModelRuns: priorInvalidation?.actualInvalidatedModelRuns ?? 0,
      totalPhaseModelRuns: (browser?.actualModelRuns ?? 0) + (priorInvalidation?.actualInvalidatedModelRuns ?? 0),
      newExternalDatasets: 0, newScientificAccuracyBenchmarks: 0, realDeviceProbes: 0 },
    invalidatedPriorFreeze: priorInvalidation,
    limitations: ['Fake-device track native rate is not the AudioContext rate and neither proves native hardware qualification',
      'Acoustic fixture may produce zero onsets; deterministic product publication tests supply verdict semantics, not natural piano accuracy',
      'MediaRecorder logical segment mapping is qualified; physical input latency, recording start latency, actual media duration and subjective UX are not',
      'No latency SLO, real-device, commercial or production microphone claim'],
    protections: { F5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', phase9GB: 'STATISTICAL_TIE', winner: null,
      acousticCoreIdentity: 'robust-browser-engineering-default-xc4-v1', acousticCoreSha256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
      ViennaP15P22InferenceIncrease: 0, commercialQualification: 'NOT_PERFORMED', productLatencySlo: 'NOT_YET_FROZEN', noOptimalProfileClaim: true } });
  console.log(disposition);
} else if (mode === 'github') {
  const head = git('rev-parse', 'HEAD');
  const credential = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const token = credential.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9); if (!token) throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
  async function api(endpoint) {
    const res = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!res.ok) throw new Error('GITHUB_API_STATUS:' + res.status); return res.json();
  }
  const combined = await api(`commits/${head}/status`), statuses = await api(`commits/${head}/statuses`), workflows = await api(`actions/runs?head_sha=${head}`);
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0]; if (remote !== head) throw new Error('POST_PUSH_HEAD_MISMATCH');
  await newJson(path.join(reportDir, `continuous_controller_github_receipt_${id}_2026-10-17.json`), {
    phase: PHASE, queriedAt: new Date().toISOString(), evidenceCommit: head, actualRemoteHead: remote,
    commitsSinceStart: git('log', '--reverse', '--format=%H %s', `${START}..HEAD`).split('\n'), combinedState: combined.state, statuses,
    workflow_runs: workflows.workflow_runs, interpretation: statuses.length === 0 && workflows.workflow_runs.length === 0 ? 'NOT CI PASS' : 'ACTUAL_GITHUB_EVIDENCE_ONLY' });
  console.log(JSON.stringify({ head, combinedState: combined.state, statuses: statuses.length, workflow_runs: workflows.workflow_runs.length }));
}
