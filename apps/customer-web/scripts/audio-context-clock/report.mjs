import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, WORK, REPORTS, FREEZE, START, PHASE, git, hash, newJson } from './protocol.mjs';

const read = async file => JSON.parse(await readFile(file, 'utf8'));
async function optional(name) {
  try { return await read(path.join(WORK, name)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
if (process.argv[2] === 'evidence') {
  const verification = await optional('verification.json'), gate1 = await optional('gate1.json'), gate2 = await optional('gate2.json'), failure = await optional('failure.json');
  const outputs = { verification, gate1, gate2, failure };
  const receipts = [];
  for (const [name, value] of Object.entries(outputs)) if (value) {
    const destination = path.join(REPORTS, `continuous_audio_context_clock_v2_${name}_2026-10-17.json`);
    await newJson(destination, value);
    receipts.push({ path: path.relative(ROOT, destination).replaceAll('\\', '/'), sha256: hash(await readFile(destination)) });
  }
  const freeze = await read(FREEZE);
  const changed = git('diff', '--name-only', START, 'HEAD').split('\n').filter(Boolean);
  const forbiddenChanges = changed.filter(p => p.startsWith('apps/customer-web/src/')
    && !p.startsWith('apps/customer-web/src/lib/practice/continuous/continuous-capture-clock-synchronizer'));
  const originalReports = new Set(git('ls-tree', '-r', '--name-only', START, 'backend/research/reports').split('\n'));
  const historicalReportsChanged = changed.filter(p => originalReports.has(p));
  const disposition = failure?.disposition ?? (verification?.status === 'PASS' && gate1?.status === 'PASS' && gate2?.status === 'PASS'
    ? 'CONTINUOUS_AUDIO_CONTEXT_CLOCK_CONTRACT_READY_FOR_CONTROLLER_INTEGRATION' : 'CONTINUOUS_MODEL_NEUTRAL_RUNTIME_REQUALIFICATION_BLOCKED');
  if (forbiddenChanges.length || historicalReportsChanged.length) throw new Error('PROTECTED_SOURCE_OR_HISTORY_CHANGED');
  await newJson(path.join(REPORTS, 'continuous_audio_context_clock_v2_final_2026-10-17.json'), {
    phase: PHASE, startingHead: START, disposition, implementationCommit: freeze.implementationAndToolingCommit,
    freezeCommit: (gate1 ?? failure ?? verification)?.proof.freezeCommit, receipts,
    oldProtocol: { status: 'FAILED_HISTORICAL_ONLY', archiveManifest: 'backend/research/history/continuous-clock-contract-v1-output-timestamp/manifest.json',
      productSynchronizerRemoved: true, selectableOutputTimestampStrategy: false },
    gate1: gate1 ? { disposition: gate1.disposition, actualModelRuns: gate1.actualModelRuns,
      rates: gate1.results.map(r => ({ rate: r.rate, offlineAt: r.offlineAt, windows: r.result.snapshot.counts, model: r.result.model,
        capture: r.result.capture, terminalFrontier: r.result.publications.at(-1).frontier, outstanding: r.result.snapshot.outstanding,
        inferenceDoesNotChangeClock: r.result.inferenceDoesNotChangeClock })) } : { status: 'NOT_PASSED' },
    gate2: gate2 ? { status: gate2.status, results: gate2.results.map(r => ({ rate: r.rate, scenario: r.scenario,
      boundaries: r.boundaries, segments: r.segments, maximumDurationMismatchSamples: r.maximumDurationMismatchSamples,
      capture: r.capture, analysisState: r.snapshot.state, failureWitness: r.failureWitness,
      actualNeuralRuns: r.actualNeuralRuns, metronomePulseCount: r.metronome.pulses.length })) } : { status: 'NOT_RUN' },
    sourceAudit: { protectedProductChanges: forbiddenChanges, historicalReportsChanged, changedPaths: changed,
      inferenceRewriteCommit: '27767818c89246f48d484715cba5bef57a9989a7', noInferenceSourceChange: true,
      noFinalizerChange: true, noHookChange: true, noPerformanceClockChange: true, noSTEPChange: true,
      noFIRChange: true, noDecoderChange: true, noThresholdChange: true, noGeometryChange: true },
    capabilities: { continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    counters: { neuralRuns: gate1?.actualModelRuns ?? failure?.gate1?.reduce((n, r) => n + (r.result?.snapshot?.counts?.windowsStarted ?? 0), 0) ?? 0,
      newDatasets: 0, newScientificBenchmarks: 0, realDeviceProbes: 0, controllerImplementations: 0 },
    interpretation: 'Internal same-AudioContext render-timeline consistency only; not input hardware latency, output latency, natural piano accuracy, real-device, UX latency, commercial or capability qualification.',
    verification: verification?.results.map(r => ({ name: r.name, exitCode: r.exitCode, counts: r.counts, messages: r.messages, output: r.output })),
    protections: { F5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', phase9GB: 'STATISTICAL_TIE', winner: null,
      acousticCoreSha256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
      commercialQualification: 'NOT_PERFORMED', productLatencySlo: 'NOT_YET_FROZEN', ViennaP15P22InferenceIncrease: 0 },
  });
  console.log(disposition);
} else if (process.argv[2] === 'github') {
  const head = git('rev-parse', 'HEAD');
  const credential = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const token = credential.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
  async function api(endpoint) {
    const response = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error('GITHUB_API_STATUS:' + response.status);
    return response.json();
  }
  const combined = await api(`commits/${head}/status`), statuses = await api(`commits/${head}/statuses`), workflows = await api(`actions/runs?head_sha=${head}`);
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (remote !== head) throw new Error('POST_PUSH_HEAD_MISMATCH');
  const receipt = { phase: PHASE, queriedAt: new Date().toISOString(), evidenceCommit: head, actualRemoteHead: remote,
    commitsSinceStart: git('log', '--reverse', '--format=%H %s', `${START}..HEAD`).split('\n'),
    combinedState: combined.state, statuses, workflow_runs: workflows.workflow_runs,
    interpretation: statuses.length === 0 && workflows.workflow_runs.length === 0 ? 'NOT CI PASS' : 'ACTUAL_GITHUB_EVIDENCE_ONLY' };
  await newJson(path.join(REPORTS, 'continuous_audio_context_clock_v2_github_receipt_2026-10-17.json'), receipt);
  console.log(JSON.stringify({ head, combinedState: receipt.combinedState, statuses: statuses.length, workflow_runs: workflows.workflow_runs.length }));
}
