import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ROOT, DIR, OUT, V20, START, BRANCH, bytes, load, save, git, hash, canonical, now, zero } from './io.mjs';
import { foundation } from './foundation.mjs';
import { profiles, CONTROL } from './profiles.mjs';
import { physicalKey, viewKey, covers, uniqueViews } from './metrics.mjs';
export const inputs = {
  v15: 'backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json',
  v17: 'backend/research/reports/step_microphone_tristate_v17/tristate-results.json',
  v18: 'backend/research/reports/step_runtime_verdict_v18/runtime-replay-results.json',
  cases: 'backend/research/reports/step_waiting_h50_holdout_v6/audio-bound-cases.json',
  scenarios: 'backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json'
};
const expected = {
  v15: '290c41185e488bfb6d08fd50b193d175ba5941ed37171ba2db73e969339e8b8a',
  v17: 'a3550bb66830c04a002ced4951e69631162d5307c9c67b54891f26929b129002',
  cases: '745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e',
  scenarios: 'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55'
};
export async function scope() {
  assert.equal(git('merge-base', START, 'HEAD'), START);
  assert.equal(git('branch', '--show-current'), BRANCH);
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(changed.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'OUT_OF_SCOPE_CHANGE');
  return changed;
}
export async function verify() {
  await scope(); const freeze = await load(OUT + '/protocol-freeze.json');
  for (const f of freeze.files) assert.equal(hash(await bytes(f.path)), f.sha256, 'FROZEN_MUTATION:' + f.path);
  for (const f of (await load(OUT + '/historical-identities.json')).files) assert.equal(hash(await bytes(f.path)), f.sha256, 'HISTORICAL_MUTATION:' + f.path);
  return freeze;
}
export async function remoteHead() {
  const h = git('rev-parse', 'HEAD');
  assert.equal(git('rev-parse', 'origin/' + BRANCH), h);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], h);
  assert.equal(git('status', '--porcelain'), '', 'REMOTE_BOUNDARY_REQUIRES_CLEAN_WORKTREE');
  return h;
}
export async function bundles() {
  const builder = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const result = [];
  for (const name of ['decoder','domain']) {
    const p = OUT + '/bundles/' + name + '.mjs';
    const built = await builder.build({ absWorkingDir: ROOT, entryPoints: [DIR + '/' + name + '.ts'],
      outfile: path.join(ROOT, p), bundle: true, platform: 'node', format: 'esm', metafile: true, logLevel: 'silent' });
    const graph = Object.keys(built.metafile.inputs);
    for (const f of graph) {
      assert.ok(!/model-inference|onnxruntime|source-analysis-runtime|decoder-b|xc2_decoders/.test(f), 'FORBIDDEN_EXECUTABLE:' + f);
      if (name === 'decoder') assert.ok(f === DIR + '/decoder.ts' || f.startsWith('apps/customer-web/src/lib/practice/acoustic/'), 'BLIND_GRAPH_LEAK:' + f);
      else assert.ok(f === DIR + '/domain.ts' || f.endsWith('/step_waiting_topology_v3/assembly.ts') || f.startsWith('apps/customer-web/src/lib/practice/local-core/'), 'DOMAIN_GRAPH_LEAK:' + f);
    }
    result.push({ name, path: p, sha256: hash(await bytes(p)), graph });
  }
  return result;
}
export async function plan() {
  for (const [k, sha] of Object.entries(expected)) assert.equal(hash(await bytes(inputs[k])), sha);
  const v15 = await load(inputs.v15), v17 = await load(inputs.v17), v18 = await load(inputs.v18);
  const cases = (await load(inputs.cases)).cases, scenarios = (await load(inputs.scenarios)).scenarios;
  const rows = v17.rows.map(old => {
    const cell = v15.cells.find(c => c.scenarioId === old.scenarioId && c.sourceRateHz === old.rate);
    const t = cell.traces.find(t => t.ordinal === old.ordinal), c = cases[old.family];
    const g = c.originalTruthCase.gestures.find(g => g.gestureId === old.physicalGestureId);
    const s = scenarios.find(s => s.scenarioId === old.scenarioId);
    const prior = v18.rows.find(r => r.rowId === old.rowId);
    assert.deepEqual(g.normalizedPitchSet, old.physicalTruth);
    assert.deepEqual(t.assembly.observations, old.observations);
    assert.equal(prior.productRecord.verdict, old.P2.verdict);
    assert.equal(c.audioBoundCaseId, old.audioBoundCaseId);
    assert.ok(s.targetPitchSets.some(target => canonical([...target].sort((a,b) => a-b)) === canonical([...old.expected].sort((a,b) => a-b))));
    return { rowId: old.rowId, scenarioId: old.scenarioId, ordinal: old.ordinal, family: old.family,
      recordingId: old.recordingId, audioBoundCaseId: old.audioBoundCaseId, physicalGestureId: old.physicalGestureId,
      rate: old.rate, jobId: cell.jobId, physicalTruth: old.physicalTruth, expected: old.expected,
      physicalOnsetMs: g.onsetMs, eligibilityBoundarySample: t.originalEligibilityBoundarySample,
      semanticEndSample: Math.round((g.onsetMs + 100) * old.rate / 1000),
      attributionGestures: c.originalTruthCase.gestures.map(g => ({ gestureId: g.gestureId, onsetMs: g.onsetMs })),
      physicalTargetSupported: covers(old.physicalTruth, old.expected),
      baselineObserved: old.acousticObserved, baselineVerdict: old.P2.verdict, baselineClassification: old.classification,
      baselineObservationIds: old.observations.map(o => o.observationId) };
  });
  assert.equal(rows.length, 34);
  const oracle = rows.map(r => ({ ...r, acousticObserved: r.baselineObserved, classification: r.baselineClassification }));
  const views = uniqueViews(oracle);
  return { rows, rowCount: rows.length, physicalUnits: [...new Set(rows.map(r => physicalKey(r)))],
    rateIgnoredPhysicalGestures: [...new Set(rows.map(r => physicalKey(r, true)))],
    targetViewIds: [...new Set(rows.map(viewKey))],
    baselineSafeMatchViewIds: views.filter(r => r.classification === 'SAFE_MATCH').map(r => r.viewId).sort(),
    baselineUnsupportedCoveredViewIds: views.filter(r => !r.physicalTargetSupported && covers(r.acousticObserved, r.expected)).map(r => r.viewId).sort(),
    baselineOracleViews: views.map(r => ({ viewId: r.viewId, classification: r.classification, observed: r.acousticObserved, rowIds: r.rowIds, multiplicity: r.multiplicity })),
    epoch: { readyMs: 10000, rearmMs: 20000, label: 'SYNTHETIC_TARGET_VIEW_REPLAY_NOT_DEVICE_UX_LATENCY_OR_MICROPHONE_COOLDOWN' },
    dedupKey: ['recordingId','physicalGestureId','sourceRateHz','normalizedPhysicalTruth'], targetViewAdds: 'normalizedExpectedTarget', candidateDependentFieldsInKey: [] };
}
async function prepare() {
  await scope(); const f = await foundation(), b = await bundles(), p = await plan();
  await save(OUT + '/foundation-verification.json', { verifiedAt: now(), ...f.receipt, zero });
  await save(OUT + '/replay-plan.json', p);
  const files = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) files.push({ path: p, sha256: hash(await bytes(p)) });
  await save(OUT + '/historical-identities.json', { startingHead: START, files });
  const stageAPaths = [DIR + '/stage-a.mjs', DIR + '/io.mjs', DIR + '/foundation.mjs', DIR + '/profiles.mjs',
    ...b.filter(b => b.name === 'decoder').flatMap(b => [b.path, ...b.graph])];
  const stageASources = [];
  for (const p of stageAPaths) stageASources.push({ path: p, sha256: hash(await bytes(p)) });
  await save(OUT + '/blind-config.json', { schema: 'V21_BLIND_THRESHOLD_CONFIG_NO_TRUTH_OR_TARGETS',
    profiles, bundles: b.filter(b => b.name === 'decoder'), stageASources,
    rawBlobPaths: f.manifest.blobs.map(b => b.path),
    baselineAcousticReference: { path: V20 + '/baseline-parity.json', sha256: hash(await bytes(V20 + '/baseline-parity.json')) } });
  const paths = [...new Set([...(await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p),
    ...b.flatMap(x => [x.path, ...x.graph]), ...Object.values(inputs),
    V20 + '/tensor-corpus-manifest.json', V20 + '/raw-tensor-seal.json', V20 + '/baseline-parity.json',
    OUT + '/foundation-verification.json', OUT + '/replay-plan.json', OUT + '/historical-identities.json', OUT + '/blind-config.json',
    OUT + '/preflight-tests.json', OUT + '/local-verification.json', OUT + '/starting-gate.json'])].sort();
  const identities = [];
  for (const p of paths) identities.push({ path: p, sha256: hash(await bytes(p)) });
  await save(OUT + '/protocol-freeze.json', { phase: 'ROBUST_A_THRESHOLD_OPERATING_POINT_V21',
    role: 'V21_PROSPECTIVE_THRESHOLD_ONLY_ZERO_NEURAL_PROTOCOL_FREEZE', createdAt: now(), startingHead: START,
    classification: 'EXPOSED_DEVELOPMENT_ONLY_ZERO_NEURAL_NOT_MICROPHONE_QUALIFICATION_NOT_PRODUCTION_DEFAULT_SELECTION',
    files: identities, profiles, control: CONTROL, bundles: b, rawBlobPaths: f.manifest.blobs.map(b => b.path),
    stageASources,
    expectedDecoderCalls: 4560, allowedStageAExecutions: 1, allowedStageBExecutions: 1, zero,
    rankingOrder: ['pairedRecoveredPhysicalGestures DESC','supportedSafeTargetViews DESC','unsupportedCoveredViews ASC','supportedRetryViews ASC','gridStepDistance ASC'],
    ties: 'NO_UNIQUE_SELECTION_AFTER_ALL_FIVE_CRITERIA', recurrence: { physicalGestures: 2, recordings: 2, rates: [44100,48000] },
    protocolDefinition: DIR + '/protocol.md', executableMetricDefinition: DIR + '/metrics.mjs',
    baselineSafeMatchViewIds: p.baselineSafeMatchViewIds, baselineUnsupportedCoveredViewIds: p.baselineUnsupportedCoveredViewIds,
    stop: 'ANY_INTEGRITY_OR_CONTROL_FAILURE_PRESERVE_PARTIAL_EVIDENCE_NO_REPAIR_OR_RERUN', StageA: 'NOT_STARTED' });
  console.log(JSON.stringify({ files: identities.length, history: files.length, planRows: p.rows.length,
    physicalUnits: p.physicalUnits.length, physicalGestures: p.rateIgnoredPhysicalGestures.length, views: p.targetViewIds.length,
    freezeSha256: hash(await bytes(OUT + '/protocol-freeze.json')) }));
}
async function proof(kind) {
  await verify(); const head = await remoteHead();
  if (kind === 'protocol') await save(OUT + '/remote-protocol-proof.json', { commit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: hash(await bytes(OUT + '/protocol-freeze.json')), blindConfigSha256: hash(await bytes(OUT + '/blind-config.json')), StageA: 'NOT_STARTED', zero });
  else {
    const seal = await load(OUT + '/stage-a-seal.json'); assert.equal(seal.decoderCalls, 4560);
    for (const f of seal.artifacts) assert.equal(hash(await bytes(f.path)), f.sha256);
    await save(OUT + '/remote-stage-a-proof.json', { commit: head, remoteHead: head, remoteVerifiedAt: now(),
      stageASealSha256: hash(await bytes(OUT + '/stage-a-seal.json')), outputCorpusSha256: seal.outputCorpusSha256,
      artifacts: seal.artifacts, status: 'STAGE_A_THRESHOLD_OUTPUTS_SEALED_BEFORE_PRODUCT_SCORING', StageB: 'NOT_STARTED', zero });
  }
  console.log(head);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === 'prepare') await prepare();
  else if (process.argv[2] === 'proof-protocol') await proof('protocol');
  else if (process.argv[2] === 'proof-stage-a') await proof('stage-a');
  else if (process.argv[2] === 'verify') console.log(JSON.stringify({ changed: await scope(), verified: !!await verify() }));
  else throw Error('Only prepare/proof-protocol/proof-stage-a/verify');
}
