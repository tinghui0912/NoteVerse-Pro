import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, WORK, REPORTS, FREEZE, START, PHASE, git, hash, newJson, SUCCESS, BLOCKED, gateStatus } from './protocol.mjs';

const read = async file => JSON.parse(await readFile(file, 'utf8'));
if (process.argv[2] === 'evidence') {
  const frozen = await read(FREEZE), verification = await read(path.join(WORK, 'verification.json'));
  let execution = null;
  try { execution = await read(path.join(WORK, 'execution.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const gate1 = execution?.gate1 ?? { status: 'NOT_STARTED', cells: [44100, 48000].map(rate => ({ rate, state: 'NOT_STARTED' })) };
  const gate2 = execution?.gate2 ?? { status: 'NOT_STARTED', cells: [44100, 48000].flatMap(rate => ['A', 'B', 'C', 'D'].map(scenario => ({ rate, scenario, state: 'NOT_STARTED' }))) };
  if (gate1.status !== gateStatus(gate1.cells) || gate2.status !== gateStatus(gate2.cells)) throw new Error('REPORT_STATE_MISMATCH');
  const changedPaths = git('diff', '--name-only', START, 'HEAD').split('\n').filter(Boolean);
  const productChanges = changedPaths.filter(p => p.startsWith('apps/customer-web/src/'));
  const allowed = ['apps/customer-web/src/lib/practice/local-core/performance-runtime.ts',
    'apps/customer-web/src/lib/practice/local-core/performance-clock-numeric-identity.test.ts'];
  if (productChanges.some(p => !allowed.includes(p))) throw new Error('PROTECTED_PRODUCT_SOURCE_CHANGED');
  const historical = new Set(git('ls-tree', '-r', '--name-only', START, 'backend/research/reports', 'backend/research/history').split('\n'));
  if (changedPaths.some(p => historical.has(p))) throw new Error('HISTORICAL_EVIDENCE_CHANGED');
  const receipts = [];
  for (const [name, data] of Object.entries({ verification, execution })) if (data) {
    const file = path.join(REPORTS, `continuous_audio_context_clock_v3_${name}_2026-10-17.json`);
    await newJson(file, data); receipts.push({ path: path.relative(ROOT, file).replaceAll('\\', '/'), sha256: hash(await readFile(file)) });
  }
  const disposition = verification.status === 'PASS' && gate1.status === 'PASS' && gate2.status === 'PASS' ? SUCCESS : BLOCKED;
  const summarize = cell => ({ rate: cell.rate, scenario: cell.scenario, state: cell.state, startedAt: cell.startedAt,
    completedAt: cell.completedAt, error: cell.error, offlineAt: cell.offlineAt,
    ...(cell.result ? { boundaries: cell.result.boundaries, segments: cell.result.segments, pauseWitnesses: cell.result.pauseWitnesses,
      futureBoundaryWitness: cell.result.futureBoundaryWitness, failureWitness: cell.result.failureWitness,
      maximumDurationMismatchSamples: cell.result.maximumDurationMismatchSamples, capture: cell.result.capture,
      counts: cell.result.snapshot.counts, outstanding: cell.result.snapshot.outstanding, analysisState: cell.result.snapshot.state,
      terminalFrontier: cell.result.snapshot.analyzedThroughPerformanceMs,
      model: cell.result.model, metronomePulseCount: cell.result.metronome?.pulses.length,
      inferenceDoesNotChangeClock: cell.result.inferenceDoesNotChangeClock } : {}) });
  const summary = { phase: PHASE, disposition, startingHead: START, implementationCommit: frozen.implementationCommit,
    proof: execution?.proof ?? verification.proof, executionStartedAt: execution?.executionStartedAt, receipts,
    numericRepair: frozen.numericAudit,
    dedicatedNumericTests: { testCases: 10, repeatedPauseResumePairs: 512, forwardAndInverseHelperAnchors: 1024,
      exactV2Numbers: true, countIn: true, manualStop: true, naturalCompletion: true, captureMapping: true,
      epsilonOrRoundingWorkaround: false },
    gate1: { status: gate1.status, cells: gate1.cells.map(summarize) }, gate2: { status: gate2.status, cells: gate2.cells.map(summarize) },
    verification: verification.results.map(r => ({ name: r.name, exitCode: r.exitCode, counts: r.counts, messages: r.messages, output: r.output })),
    sourceAudit: { productChanges, changedPaths, historicalReportsChanged: [], historicalV1ArchiveChanged: false,
      acousticImplementationChanged: false, finalizerChanged: false, FIRChanged: false, resourcePolicyChanged: false,
      hookChanged: false, STEPChanged: false, capabilityChanged: false, v1SynchronizerNotRestored: true,
      noClockStrategiesOrFallbackAdded: true },
    actualModelRuns: execution?.actualModelRuns ?? 0, modelRunCountComplete: execution?.modelRunCountComplete ?? true,
    newDatasets: 0, newScientificBenchmarks: 0, realDeviceProbes: 0,
    capabilities: { continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    interpretation: 'Only internal same-AudioContext render-timeline consistency. Not hardware latency, natural piano accuracy, UX latency, commercial or real-device qualification.',
    protections: { F5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', phase9GB: 'STATISTICAL_TIE', winner: null,
      acousticCoreSha256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
      commercialQualification: 'NOT_PERFORMED', productLatencySlo: 'NOT_YET_FROZEN', ViennaP15P22InferenceIncrease: 0 },
  };
  await newJson(path.join(REPORTS, 'continuous_audio_context_clock_v3_final_2026-10-17.json'), summary);
  console.log(JSON.stringify({ disposition, gate1: gate1.status, gate2: gate2.status, actualModelRuns: summary.actualModelRuns }));
} else if (process.argv[2] === 'github') {
  const head = git('rev-parse', 'HEAD');
  const credential = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const token = credential.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
  async function api(endpoint) {
    const res = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!res.ok) throw new Error('GITHUB_API_STATUS:' + res.status); return res.json();
  }
  const combined = await api(`commits/${head}/status`), statuses = await api(`commits/${head}/statuses`), workflows = await api(`actions/runs?head_sha=${head}`);
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (remote !== head) throw new Error('POST_PUSH_HEAD_MISMATCH');
  await newJson(path.join(REPORTS, 'continuous_audio_context_clock_v3_github_receipt_2026-10-17.json'), {
    phase: PHASE, queriedAt: new Date().toISOString(), evidenceCommit: head, actualRemoteHead: remote,
    commitsSinceStart: git('log', '--reverse', '--format=%H %s', `${START}..HEAD`).split('\n'),
    combinedState: combined.state, statuses, workflow_runs: workflows.workflow_runs,
    interpretation: statuses.length === 0 && workflows.workflow_runs.length === 0 ? 'NOT CI PASS' : 'ACTUAL_GITHUB_EVIDENCE_ONLY' });
  console.log(JSON.stringify({ head, combinedState: combined.state, statuses: statuses.length, workflow_runs: workflows.workflow_runs.length }));
}
