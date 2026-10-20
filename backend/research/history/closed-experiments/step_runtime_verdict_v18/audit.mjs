import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/step_runtime_verdict_v18';
export const OUT = 'backend/research/reports/step_runtime_verdict_v18';
export const START = '7cc9f96ccd66c8025a3e4cca41e51e36c94a5993';
const BRANCH = 'codex/customer-web-delivery-boundary';
const production = ['local-core/step-attempt.ts', 'local-core/step-runtime.ts', 'local-core/session.ts',
  'local-core/step-attempt.test.ts', 'local-core/step-runtime-status.test.ts',
  'local-core/step-verdict-policy.test.ts', 'step/step-architecture.test.ts']
  .map(p => 'apps/customer-web/src/lib/practice/' + p);
export const input = {
  v15: 'backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json',
  v16: 'backend/research/reports/microphone_product_policy_v16/step-policy-results.json',
  v17: 'backend/research/reports/step_microphone_tristate_v17/tristate-results.json',
  v17Assessment: 'backend/research/reports/step_microphone_tristate_v17/assessment.json',
  v17Freeze: 'backend/research/reports/step_microphone_tristate_v17/tristate-policy-freeze.json',
  scenarios: 'backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json',
  cases: 'backend/research/reports/step_waiting_h50_holdout_v6/audio-bound-cases.json',
  acoustic: 'backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic.json'
};
const accepted = {
  [input.v15]: '290c41185e488bfb6d08fd50b193d175ba5941ed37171ba2db73e969339e8b8a',
  [input.v16]: 'fa08a97eb24af34b0d3fcb41e94be44cb04fc771614690ebc43ba816ead8d858',
  [input.v17]: 'a3550bb66830c04a002ced4951e69631162d5307c9c67b54891f26929b129002',
  [input.v17Assessment]: '5cce86826debd195af29dd580060fdd94a0cd65a7759ceeb35d4fb554cc69d04',
  [input.v17Freeze]: '4a51c2eb0ebd2497f156735d051141019bbc08d035b5043c423b4ed26a26c3e4',
  [input.scenarios]: 'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55',
  [input.cases]: '745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e',
  [input.acoustic]: '61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1'
};
export const execution = Object.freeze({ newNeuralRuns: 0, modelSessionLoads: 0, acousticWorkerConstructions: 0,
  decoderARuns: 0, decoderBRuns: 0, selectedPcmDecodeRuns: 0, StepAcousticReruns: 0,
  ContinuousAcousticReruns: 0, StageAReruns: 0, freshHoldoutAccess: 0, hiddenWarmupRuns: 0, unknownRuns: 0 });
export const now = () => new Date().toISOString();
export const hash = b => createHash('sha256').update(b).digest('hex');
export const bytes = p => readFile(path.join(ROOT, p));
export const load = async p => JSON.parse(await bytes(p));
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
export async function save(name, value) {
  await mkdir(path.join(ROOT, OUT), { recursive: true });
  await writeFile(path.join(ROOT, OUT, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
const canonical = a => [...new Set(a)].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const equalSet = (a, b) => same(canonical(a), canonical(b));
export async function scope() {
  assert.equal(git('merge-base', START, 'HEAD'), START);
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(changed.every(p => production.includes(p) || p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'OUT_OF_SCOPE_CHANGE');
  for (const [p, sha] of Object.entries(accepted)) assert.equal(hash(await bytes(p)), sha, 'IMMUTABLE_INPUT:' + p);
  return changed;
}
export function assertGraph(graph) {
  for (const p of graph) assert.ok(p === DIR + '/domain.ts' || p.startsWith('apps/customer-web/src/lib/practice/local-core/'), 'ACOUSTIC_EXECUTABLE_REACHABLE:' + p);
}
export async function domain() {
  const builder = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const file = path.join(ROOT, 'backend/data/work/step_runtime_verdict_v18/domain.mjs');
  const built = await builder.build({ absWorkingDir: ROOT, entryPoints: [DIR + '/domain.ts'], outfile: file,
    bundle: true, platform: 'node', format: 'esm', metafile: true, logLevel: 'silent' });
  const graph = Object.keys(built.metafile.inputs); assertGraph(graph);
  return { graph, module: await import(pathToFileURL(file).href) };
}
async function verify() {
  const changed = await scope(), freeze = await load(OUT + '/runtime-replay-freeze.json');
  for (const f of [...freeze.files, ...(await load(OUT + '/historical-raw-identities.json')).files]) {
    assert.equal(hash(await bytes(f.path)), f.sha256, 'FROZEN_OR_HISTORY_MUTATION:' + f.path);
  }
  return { changed, freeze };
}
async function remote() {
  const head = git('rev-parse', 'HEAD');
  assert.equal(git('rev-parse', 'origin/' + BRANCH), head);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], head);
  return head;
}
async function inventory() {
  const files = ['backend/research/browser_runtime/xc2_r1_browser_acoustic.mjs',
    'backend/research/browser_runtime/run_phase9ga3_challenger_sweep.mjs',
    'apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts',
    'apps/customer-web/src/lib/practice/acoustic/runtime/inference-types.ts',
    'backend/research/step_waiting_h50_holdout_v7/entry.ts',
    'backend/research/reports/step_next_acoustic_wave1_v11/assessment.json',
    'backend/research/reports/step_next_acoustic_wave1_v14/assessment.json'];
  const historicalExecutor = (await bytes(files[0])).toString(), calibration = (await bytes(files[1])).toString();
  assert.ok(historicalExecutor.includes('rawTensorExportEnabled: false'));
  const grid = { onset: JSON.parse(calibration.match(/const onsetGrid = (\[[^;]+\]);/)[1]),
    frame: JSON.parse(calibration.match(/const frameGrid = (\[[^;]+\]);/)[1]) };
  const c = await load(DIR + '/contract.json');
  assert.deepEqual(grid.onset, c.historicalGrid.onset); assert.deepEqual(grid.frame, c.historicalGrid.frame);
  const inference = (await bytes(files[2])).toString();
  assert.ok(inference.includes('return { events, inferenceMs:'));
  const acoustic = await load(input.acoustic), buffers = [];
  function visit(value, field = '$') {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value) && value.length >= 183 * 88 && value.every(v => typeof v === 'number')) buffers.push(field);
    else for (const [k, v] of Object.entries(value)) visit(v, field + '.' + k);
  }
  visit(acoustic); assert.deepEqual(buffers, []);
  const manifests = git('ls-files', 'backend/research/reports/step_waiting_h50_holdout_v7',
    'backend/research/reports/step_microphone_tristate_v17', 'backend/research/reports/step_next_acoustic_wave1_v11',
    'backend/research/reports/step_next_acoustic_wave1_v14').split('\n');
  const tensorArtifacts = manifests.filter(p => /\.(?:npy|npz|f32|bin|safetensors)$|raw[-_]tensor|tensor[-_]journal/i.test(p));
  assert.deepEqual(tensorArtifacts, []);
  return { sourceFiles: await Promise.all(files.map(async p => ({ path: p, sha256: hash(await bytes(p)) }))),
    historicalExecutorRawTensorExportEnabled: false, productionReturn: 'Decoded events/run diagnostics only; not reusable raw onset/frame tensors',
    scope: 'Current V7/V17 evidence lineage. Not a claim that unrelated older calibration caches never existed.',
    sealedAcousticNumericTensorBuffers: buffers, scopedCommittedArtifactsChecked: manifests.length,
    committedReusableTensorArtifactsForCurrentEvidence: tensorArtifacts,
    unexecutedV11JournalDesignNotEvidence: true, rawTensorRequirement: c.rawTensorRequirement,
    grid, gridClassification: c.historicalGrid.label, calibratedForCurrentRobust600170: false,
    gridExecuted: false, directionSelected: false, productionChangesRequiredForInventory: false };
}
async function prepare() {
  await scope(); const d = await domain(), contract = await load(DIR + '/contract.json');
  const history = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) history.push({ path: p, sha256: hash(await bytes(p)) });
  await save('historical-raw-identities.json', { startingHead: START, files: history });
  const inv = await inventory(); await save('raw-tensor-and-grid-inventory.json', inv);
  const paths = [...new Set([...(await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p),
    ...production, ...d.graph, ...Object.values(input), ...inv.sourceFiles.map(f => f.path),
    'apps/customer-web/src/lib/practice/step/step-practice-controller.ts',
    'apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts',
    'apps/customer-web/src/hooks/practice/use-step-local-practice.ts',
    'apps/customer-web/src/lib/practice/input-capability.ts',
    'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json',
    OUT + '/historical-raw-identities.json', OUT + '/raw-tensor-and-grid-inventory.json',
    OUT + '/research-tests.json', OUT + '/local-verification.json'])].sort();
  const files = [];
  for (const p of paths) files.push({ path: p, sha256: hash(await bytes(p)) });
  await save('runtime-replay-freeze.json', { role: 'V18_RUNTIME_OWNERSHIP_ZERO_NEURAL_REPLAY_FREEZE', createdAt: now(),
    startingHead: START, contract, files, domainGraph: d.graph, replayExecutionsAllowed: 1, execution,
    initialGitHub: { queriedAt: '2026-10-19T07:52:02.582304+00:00', combinedState: 'pending', statuses: [], workflow_runs: [], ciInterpretation: 'NOT CI PASS' } });
  console.log(JSON.stringify({ files: files.length, historicalFiles: history.length, freezeSha256: hash(await bytes(OUT + '/runtime-replay-freeze.json')) }));
}
async function proof() {
  await verify(); const head = await remote();
  await save('remote-replay-freeze-proof.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: hash(await bytes(OUT + '/runtime-replay-freeze.json')), replay: 'NOT_STARTED', execution });
  console.log(head);
}
async function replay() {
  const { freeze } = await verify(), proof = await load(OUT + '/remote-replay-freeze-proof.json'), startedAt = now();
  assert.equal(proof.freezeSha256, hash(await bytes(OUT + '/runtime-replay-freeze.json')));
  assert.ok(proof.remoteVerifiedAt < startedAt); assert.equal(proof.freezeCommit, proof.remoteHead);
  await save('replay-started.json', { startedAt, executionOrdinal: 1, proof, execution });
  const rows = [], cells = [];
  try {
    const v17 = await load(input.v17), v15 = await load(input.v15), v16 = await load(input.v16);
    const cases = (await load(input.cases)).cases, scenarios = (await load(input.scenarios)).scenarios;
    const d = await domain(); assert.deepEqual(d.graph, freeze.domainGraph);
    assert.equal(v17.rows.length, 34);
    for (const cell of v17.cells) {
      const oldRows = v17.rows.filter(r => r.scenarioId === cell.scenarioId && r.rate === cell.sourceRateHz);
      const scenario = scenarios.find(s => s.scenarioId === cell.scenarioId);
      const h = d.module.runtime(scenario.targetPitchSets, `v18:${cell.scenarioId}:${cell.sourceRateHz}`), cellRows = [];
      h.owner.setInputUnavailable(); h.owner.acceptInputAfter(h.time(oldRows[0].domainTrace.ready.step.inputEligibleAfter.ms));
      for (const old of oldRows) {
        const sourceCell = v15.cells.filter(c => c.scenarioId === old.scenarioId && c.sourceRateHz === old.rate);
        assert.equal(sourceCell.length, 1); const original = sourceCell[0].traces.find(t => t.ordinal === old.ordinal);
        const prior16 = v16.attempts.filter(r => r.scenarioId === old.scenarioId && r.rate === old.rate && r.attemptOrdinal === old.ordinal);
        assert.equal(prior16.length, 1);
        assert.equal(sourceCell[0].audioBoundCaseId, old.audioBoundCaseId);
        assert.deepEqual(original.assembly.observations, old.observations);
        assert.ok(equalSet(original.assembly.observations.map(o => o.midiPitch), old.acousticObserved));
        assert.ok(equalSet(prior16[0].expected, old.expected));
        const source = cases[old.family]; assert.equal(source.audioBoundCaseId, old.audioBoundCaseId);
        const physical = source.originalTruthCase.gestures.filter(g => g.gestureId === old.physicalGestureId);
        assert.equal(physical.length, 1); assert.ok(equalSet(physical[0].normalizedPitchSet, old.physicalTruth));
        const ready = h.owner.snapshot();
        assert.equal(ready.version.schemaVersion, 6); assert.equal(ready.version.runtimeVersion, 'step-source-sensitive-verdict-v6');
        assert.ok(equalSet(h.owner.currentTarget().attackPitches, old.expected.map(d.module.pitch)));
        h.clock.set(old.identity.attemptStartSessionTime.ms);
        const identity = h.owner.openAttempt(h.time(h.clock.nowMs())); assert.ok(identity);
        assert.equal(h.owner.analyzeAttempt(identity), true);
        // No target-aware branch: every row, including historical RETRY, is ordinary evidence.
        const evidence = { kind: 'EVIDENCE', observedAttackPitches: [...original.assembly.pitches],
          confidence: original.assembly.confidence, captureEndSessionTime: h.time(original.productRecord.captureEndSessionTime.ms) };
        const completed = h.owner.completeAttempt(identity, evidence);
        assert.equal(completed.kind, 'FINALIZED'); const record = completed.record;
        const postVerdict = h.owner.snapshot();
        if (record.verdict !== old.P2.verdict || record.retryReason !== old.P2.reason) throw Object.assign(Error('PER_ROW_V17_PARITY:' + old.rowId), { parity: true });
        assert.deepEqual(record.observedAttackPitches, canonical(evidence.observedAttackPitches));
        assert.equal(record.confidence, evidence.confidence);
        assert.deepEqual(record.captureEndSessionTime, evidence.captureEndSessionTime);
        assert.equal(postVerdict.step.attemptState, 'POST_VERDICT');
        assert.equal(postVerdict.step.targetGeneration, ready.step.targetGeneration);
        assert.equal(h.owner.openAttempt(h.time(evidence.captureEndSessionTime.ms + 1)), null);
        h.clock.set(old.domainTrace.rearmed.step.inputEligibleAfter.ms); h.owner.rearm(h.time(h.clock.nowMs()));
        const rearmed = h.owner.snapshot();
        assert.equal(rearmed.step.targetGeneration, ready.step.targetGeneration + (record.verdict === 'MATCH' ? 1 : 0));
        assert.equal(h.owner.openAttempt(h.time(h.clock.nowMs())), null);
        const supported = old.expected.every(p => physical[0].normalizedPitchSet.includes(p));
        const classification = record.verdict === 'MATCH' ? supported ? 'SAFE_MATCH' : 'DANGEROUS_FALSE_MATCH'
          : record.verdict === 'RETRY' ? supported ? 'SUPPORTED_RETRY' : 'UNSUPPORTED_RETRY' : supported ? 'FALSE_REJECT' : 'TRUE_REJECT';
        if (classification !== old.classification) throw Object.assign(Error('PHYSICAL_CLASSIFICATION_PARITY:' + old.rowId), { parity: true });
        const row = { rowId: old.rowId, scenarioId: old.scenarioId, family: old.family, rate: old.rate, ordinal: old.ordinal,
          audioBoundCaseId: old.audioBoundCaseId, physicalGestureId: old.physicalGestureId, expected: old.expected,
          physicalTruth: physical[0].normalizedPitchSet, acousticObserved: old.acousticObserved, observations: old.observations,
          submittedEvidence: evidence, identity, productRecord: record, expectedHistoricalP2: old.P2,
          physicalTargetSupported: supported, classification, domainTrace: { ready, postVerdict, rearmed },
          verdictOwner: 'StepPracticeRuntime.completeAttempt', externalPolicyExecuted: false };
        rows.push(row); cellRows.push(row);
      }
      cells.push({ scenarioId: cell.scenarioId, rate: cell.sourceRateHz, verdicts: cellRows.map(r => r.productRecord.verdict),
        finalSnapshot: h.owner.snapshot() });
    }
    const counts = list => ({ verdicts: Object.fromEntries(['MATCH', 'RETRY', 'MISMATCH'].map(k => [k, list.filter(r => r.productRecord.verdict === k).length])),
      classifications: Object.fromEntries(Object.keys(freeze.contract.parityGate.classifications).map(k => [k, list.filter(r => r.classification === k).length])) });
    const overall = counts(rows);
    if (rows.length !== 34 || cells.length !== 22 || !same(overall.verdicts, freeze.contract.parityGate.verdicts)
      || !same(overall.classifications, freeze.contract.parityGate.classifications)) throw Object.assign(Error('AGGREGATE_V17_PARITY'), { parity: true });
    await verify();
    await save('runtime-replay-results.json', { startedAt, completedAt: now(), proof, label: freeze.contract.label,
      totalAttempts: rows.length, totalCells: cells.length, submittedEvidenceKinds: { EVIDENCE: rows.length, RETRY: 0 },
      externalP2Executions: 0, perRowV17Parity: true, overall,
      byRate: [44100, 48000].map(rate => ({ rate, ...counts(rows.filter(r => r.rate === rate)) })), rows, cells,
      uncertaintyRecordsPreservingOriginalEvidence: rows.filter(r => r.productRecord.verdict === 'RETRY').length,
      limitations: freeze.contract.limitations, execution,
      disposition: 'STEP_V18_RUNTIME_OWNED_SOURCE_SENSITIVE_VERDICT_ESTABLISHED_V17_PARITY_PRESERVED' });
    await save('replay-complete.json', { completedAt: now(), startedAt, replayExecutions: 1, execution });
    console.log(JSON.stringify({ overall, evidenceOnly: true, rows: rows.length, runtimeUncertaintyRecords: rows.filter(r => r.productRecord.verdict === 'RETRY').length }));
  } catch (error) {
    await save('replay-failure.json', { failedAt: now(), failure: String(error.stack ?? error), partialRows: rows, partialCells: cells,
      disposition: error.parity ? 'STEP_V18_RUNTIME_OWNERSHIP_PARITY_FAILURE' : 'STEP_V18_EVALUATION_INTEGRITY_BLOCKED', execution, rerunAllowed: false });
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode === 'prepare') await prepare();
  else if (mode === 'proof') await proof();
  else if (mode === 'replay') await replay();
  else if (mode === 'verify') { const { changed } = await verify(); console.log(JSON.stringify({ changed, execution })); }
  else throw Error('Only prepare/proof/replay/verify. No acoustic execution commands.');
}
