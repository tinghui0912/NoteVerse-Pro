import { readFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, WORK, START, PHASE, FREEZE, git, newJson, fileIdentity } from './continuous-application-protocol.mjs';
const reports = path.join(ROOT, 'backend/research/reports'), load = file => readFile(file, 'utf8').then(JSON.parse);
if (process.argv[2] === 'blocked-evidence') {
  const freeze = await load(FREEZE), result = await load(path.join(WORK, 'clock_gate_result_v1.json')), checks = await load(path.join(WORK, 'verification_v1.json'));
  if (result.status !== 'CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED') throw new Error('NOT_A_CLOCK_BLOCKER');
  const coreChanges = git('diff', START, '--name-only', '--', 'apps/customer-web/src/lib/practice/local-core', 'apps/customer-web/src/lib/practice/input-capability.ts');
  if (coreChanges) throw new Error('PROTECTED_CORE_CHANGED');
  for (const [source, target] of [['clock_gate_result_v1.json', 'continuous_application_clock_gate_result_v1_2026-10-17.json'],
    ['verification_v1.json', 'continuous_application_verification_v1_2026-10-17.json']]) await copyFile(path.join(WORK, source), path.join(reports, target));
  await newJson(path.join(reports, 'continuous_application_blocked_final_v1_2026-10-17.json'), {
    phase: PHASE, disposition: result.status, startingHead: START,
    productImplementationCommit: freeze.productImplementationCommit, qualificationToolingCommit: freeze.qualificationToolingCommit,
    freezeCommit: result.proof.freezeCommit, freezeSha256: result.proof.freezeSha256,
    evidenceCommit: 'BOUND_BY_CONTAINING_GIT_COMMIT', receiptCommit: 'BOUND_BY_SUBSEQUENT_GITHUB_RECEIPT_COMMIT',
    remoteVerifiedAt: result.proof.remoteVerifiedAt, executionStartedAt: result.executionStartedAt,
    scopeCompleted: ['Truthful model-neutral Continuous artifact manifest/verified OPFS loader; no historical identity mapping.',
      'Baseline AST import/reachability inventory; old executable paths identified but not deleted.',
      'Single frozen pure capture-clock synchronizer, mechanistic tests and bounded metadata-only fake-device clock gate.'],
    scopeNotPerformedAfterBlocker: ['ContinuousPracticeController', 'MIDI/microphone application adapters', 'React hook thinning',
      'Alternate executable path archival/removal', 'Natural terminal boundary cancellation/replacement', 'Recorder ownership migration',
      'Actual controller/browser/WebGPU qualification at either source rate', 'Production model-inference rewrite WebGPU execution qualification'],
    model: freeze.model, synchronizationProtocol: freeze.protocol, clockGate: result,
    maximumObservedMappingErrorSamples: Math.max(...result.results.map(r => r.mapper.maximumObservedErrorSamples)),
    interpretation: 'This frozen single-anchor protocol failed empirical timestamp consistency at the existing one-source-sample boundary. This is not proof that every possible synchronization architecture is impossible. No tolerance widening, refitting, algorithm fallback or alternate protocol was tried after results.',
    inputInventory: await fileIdentity('backend/research/reports/continuous_application_import_inventory_2026-10-17.json'),
    sourceHashes: freeze.files, inputs: freeze.assets, verification: checks,
    protections: { continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false,
      productCoreChanges: [], acousticModelBytesChanged: false, decoderThresholdGeometryFirChanges: false,
      F5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', phase9GB: 'STATISTICAL_TIE', winner: null,
      viennaP15P22InferenceIncrease: 0, noScoreFollowing: true, noBackendPracticeRuntime: true,
      commercialQualification: 'NOT_PERFORMED', productLatencySlo: 'NOT_YET_FROZEN' },
    counters: { neuralInference: 0, externalDatasetDownloads: 0, realDeviceProbes: 0 },
    limitation: 'Application orchestration is not integrated. Prior promoted-disabled runtime evidence is historical; model-neutral rewrite was not executed with ONNX in this phase. Clock gate is not a controller qualification.',
  });
} else if (process.argv[2] === 'github') {
  const commit = git('rev-parse', 'HEAD');
  const credentials = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const token = credentials.split('\n').find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GITHUB_AUTH_UNAVAILABLE');
  const get = async endpoint => {
    const response = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error('GITHUB_API_' + response.status); return response.json();
  };
  const combined = await get(`commits/${commit}/status`), statuses = await get(`commits/${commit}/statuses`), runs = await get(`actions/runs?head_sha=${commit}`);
  const receipt = { phase: PHASE, queriedAt: new Date().toISOString(), evidenceCommit: commit,
    remoteHead: git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0],
    combinedState: combined.state, statuses, workflow_runs: runs.workflow_runs,
    ciInterpretation: statuses.length === 0 && runs.workflow_runs.length === 0 ? 'NOT CI PASS' : 'SEE_ACTUAL_RESULTS' };
  await newJson(path.join(reports, 'continuous_application_github_receipt_v1_2026-10-17.json'), receipt); console.log(JSON.stringify(receipt));
}
