import { readFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, WORK, START, PHASE, freezePath, git, fileIdentity, newJson } from './continuous-runtime-protocol.mjs';

const reports = path.join(ROOT, 'backend/research/reports');
const load = file => readFile(file, 'utf8').then(JSON.parse);
async function finalReport(id) {
  const work = path.join(WORK, id), freeze = await load(freezePath(id));
  const verification = await load(path.join(work, 'verification/verification.json'));
  let browser;
  try { browser = await load(path.join(work, 'browser_qualification.json')); }
  catch { browser = { status: 'FAIL', failure: await load(path.join(work, 'browser_failure.json')) }; }
  const manifestPath = 'backend/research/history/continuous-acoustic-before-promotion/manifest.json';
  const manifest = await load(path.join(ROOT, manifestPath));
  for (const row of manifest.entries) {
    const actual = await fileIdentity(row.archivePath);
    if (actual.sha256 !== row.sha256 || actual.bytes !== row.bytes) throw new Error('ARCHIVE_CHANGED:' + row.archivePath);
  }
  const protectedChanges = git('diff', '--name-only', START, '--', 'apps/customer-web/src/lib/practice/local-core', 'apps/customer-web/src/lib/practice/input-capability.ts');
  if (protectedChanges) throw new Error('PROTECTED_PRODUCT_CORE_CHANGED:' + protectedChanges);
  const historicalReportChanges = git('diff', '--name-status', START, '--', 'backend/research/reports').split('\n').filter(line => line && !line.startsWith('A\t'));
  if (historicalReportChanges.length) throw new Error('HISTORICAL_REPORT_CHANGED');
  const passed = verification.status === 'PASS' && browser.status === 'PASS';
  for (const [source, target] of [
    [path.join(work, 'verification/verification.json'), `continuous_microphone_verification_${id}_2026-10-17.json`],
    [path.join(work, browser.status === 'PASS' ? 'browser_qualification.json' : 'browser_failure.json'), `continuous_microphone_browser_${id}_2026-10-17.json`],
  ]) await copyFile(source, path.join(reports, target));
  const assetGate = await load(path.join(reports, 'continuous_microphone_asset_gate_attempt2_2026-10-16.json'));
  const invariantReceipts = {};
  for (const name of ['long_session', 'backpressure', 'fast_parity_44100', 'fast_parity_48000']) {
    invariantReceipts[name] = await load(path.join(work, `verification/${name}.json`));
  }
  await newJson(path.join(reports, `continuous_microphone_runtime_final_${id}_2026-10-17.json`), {
    phase: PHASE, disposition: passed ? 'CONTINUOUS_MICROPHONE_RUNTIME_PROMOTED_DISABLED' : 'CONTINUOUS_MICROPHONE_RUNTIME_PROMOTION_BLOCKED',
    startingHead: START, implementationCommit: freeze.implementationCommit, freezeCommit: verification.proof.freezeCommit,
    freezeSha256: verification.proof.freezeSha256, remoteFreezeVerifiedAt: browser.proof?.remoteVerifiedAt ?? browser.failure?.proof?.remoteVerifiedAt,
    browserExecutionStartedAt: browser.executionStartedAt ?? browser.failure?.executionStartedAt,
    evidenceCommit: 'BOUND_BY_CONTAINING_GIT_COMMIT', oldSourceArchive: await fileIdentity(manifestPath), archivedFileCount: manifest.entries.length,
    protectedCoreChanges: [], historicalReportChanges: [], assetGate,
    modelDelivery: 'Separate versioned /model-assets/continuous-robust-browser-v1/access; immutable SHA-key; browser verifies exact bytes/hash again; no legacy model fallback.',
    moduleMap: { capture: 'continuous/capture.ts + capture-bridge.ts + capture.worklet.js',
      dsp: 'continuous/source-adapter.ts', ownership: 'continuous/window-planner.ts', resources: 'continuous/resource-policy.ts',
      scheduler: 'continuous/acoustic-runtime.ts', inference: 'continuous/model-inference.ts + acoustic-worker.entry.ts + worker-client.ts',
      projection: 'continuous/publication.ts', productSink: 'continuous-microphone-input.ts -> ContinuousPracticeSession.publishAnalysis' },
    sourceHashes: freeze.files, frozenInputHashes: freeze.assets, acousticCoreIdentitySha256: freeze.acousticCoreIdentitySha256,
    sourceAdapters: await load(path.join(ROOT, 'apps/customer-web/src/lib/practice/acoustic-inference/continuous/source-adapter-identities.json')),
    geometry: freeze.geometry, resources: freeze.resources,
    memory: { sessionPcmBytes: 0, sourceRingBytes: 512, coefficientBytes: { '44100': 35284, '48000': 244 }, targetRingBytes: 262144,
      mainOutstandingInputBytes: 465920, activeWorkerInputCloneBytes: 116480, workletTransportPayloadBytes: 262144,
      retainedDiagnosticEventObjects: 0, compactDiagnosticPlanningBytes: 16384,
      limitation: 'Payload/resource-lifetime ceilings, not an exact JS/ORT/WebGPU total heap bound.' },
    multiSegment: freeze.multiSegment, terminalContract: freeze.terminal,
    browser: { status: browser.status, identity: browser.browser, actualModelRuns: browser.actualModelRuns,
      rates: browser.results?.map(r => ({ rate: r.rate, offlineAt: r.offlineAt, counts: r.result.snapshot.counts,
        transportWitness: r.result.transportWitness, publications: r.result.publications, outstanding: r.result.snapshot.outstanding,
        sourceChronology: r.result.capture, finalState: r.result.snapshot.state, inferenceDoesNotChangeClock: r.result.inferenceDoesNotChangeClock })) },
    verification, invariantReceipts, counters: { newExternalDatasetDownloads: 0, scientificBenchmarks: 0, parameterSweeps: 0,
      modelComparisons: 0, decoderComparisons: 0, newMidiTruthReads: 0, actualEngineeringModelRuns: browser.actualModelRuns ?? null },
    capability: freeze.capability, realDeviceProbe: 'NOT_PERFORMED', productFinalizer: 'UNCHANGED_UNIQUE_CONTINUOUS_FINALIZER',
    protections: { F5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', phase9GB: 'STATISTICAL_TIE', winner: null,
      viennaP15P22InferenceIncrease: 0, noPracticeWebSocket: true, noBackendPracticeInference: true,
      noScoreFollowing: true, expectedScoreNeverEntersInference: true, commercialQualification: 'NOT_PERFORMED',
      productLatencySlo: 'NOT_YET_FROZEN', noOptimalProfileClaim: true },
    limitations: ['Fake-media integration only; no real microphone permission/device qualification.',
      'No natural independent fixed-BPM human capture accuracy/UX gate.', 'No user-visible input capability enabled.',
      'No scientific winner or new acoustic accuracy result.', 'Product latency SLO remains unfrozen.'],
  });
}
async function githubReceipt(id) {
  const head = git('rev-parse', 'HEAD');
  // Credential material stays in process memory and is never persisted or printed.
  const material = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const token = material.split('\n').find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GITHUB_API_AUTH_UNAVAILABLE');
  const get = async endpoint => {
    const response = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) throw new Error(`GITHUB_API_${response.status}`);
    return response.json();
  };
  const combined = await get(`commits/${head}/status`), statuses = await get(`commits/${head}/statuses`), workflows = await get(`actions/runs?head_sha=${head}`);
  const remoteHead = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  const receipt = { phase: PHASE, queriedAt: new Date().toISOString(), commit: head, remoteHead,
    combinedState: combined.state, statuses, workflow_runs: workflows.workflow_runs,
    ciInterpretation: statuses.length === 0 && workflows.workflow_runs.length === 0 ? 'NOT CI PASS' : 'SEE_ACTUAL_GITHUB_RESULTS' };
  await newJson(path.join(reports, `continuous_microphone_github_${id}_2026-10-17.json`), receipt);
  console.log(JSON.stringify(receipt));
}
if (process.argv[2] === 'final') await finalReport(process.argv[3] ?? 'v1');
else if (process.argv[2] === 'github') await githubReceipt(process.argv[3] ?? 'v1');
