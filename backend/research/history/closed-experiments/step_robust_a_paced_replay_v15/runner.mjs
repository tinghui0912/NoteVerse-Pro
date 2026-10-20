import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, START, BRANCH, FIXED, COUNTS, hash, git, now, load, save, integrity, bundle, extractMetrics } from './core.mjs';

const metricPath = 'backend/research/reports/phase9g_xc2_stage_a_decoder_resampler_development_2026-10-15.json';
const runtimePaths = ['step-runtime.ts', 'step-attempt.ts', 'artifact.ts', 'evidence.ts', 'session.ts', 'timebase.ts', 'practice-tempo.ts']
  .map(p => 'apps/customer-web/src/lib/practice/local-core/' + p);
const metadataPaths = ['apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json',
  'apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/model-validation.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts',
  'backend/research/step_waiting_topology_v3/assembly.ts', metricPath];
async function verifyFreeze() {
  const freeze = await load(OUT + '/replay-protocol-freeze.json');
  for (const item of freeze.files) if (hash(await readFile(path.join(ROOT, item.path))) !== item.sha256) throw Error('V15_FREEZE_MUTATION:' + item.path);
  return freeze;
}
const mode = process.argv[2];
if (mode === 'prepare') {
  const checks = await integrity();
  const policy = await load(DIR + '/policy.json');
  if (policy.HMs !== 50 || policy.roster.join() !== 'ROBUST_A_CURRENT_CONTROL') throw Error('POLICY_DRIFT');
  const model = await load('apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json');
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (model.model.onnxSha256 !== policy.model.sha256 || model.model.onnxBytes !== policy.model.bytes
    || model.decoder.default !== 'A' || model.decoder.onsetThreshold !== .3 || model.decoder.frameThreshold !== .05
    || hash(canonical(model)) !== '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443'
    || model.identityName !== policy.model.identity || JSON.stringify(model.input.shape) !== '[1,29120]'
    || model.input.dtype !== 'float32' || model.input.sampleRateHz !== 16000
    || model.ownership.ownedMs !== 600 || model.ownership.fullWindowPastMs !== 1050 || model.ownership.futureContextMs !== 170
    || model.runtime.ortWebVersion !== '1.20.1' || model.runtime.provider !== 'webgpu' || model.runtime.automaticFallback !== false
    || model.runtime.graphOptimizationLevel !== 'disabled') throw Error('PRODUCTION_MODEL_IDENTITY');
  const descriptor = await readFile(path.join(ROOT, metadataPaths[2]), 'utf8');
  for (const assertion of ["graphOptimizationLevel: 'disabled'", "inputDescriptor: { name: 'audio', dtype: 'float32', shape: [1, 29120] }",
    'outputDescriptors: { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] }']) if (!descriptor.includes(assertion)) throw Error('CURRENT_RUNTIME_DESCRIPTOR_DRIFT');
  const { inputs } = await bundle();
  await save('starting-gate-and-integrity.json', { startingHead: START, localHeadAtGate: START, remoteHeadAtGate: START,
    mergeBase: START, ahead: 0, behind: 0, cleanWorktreeBeforeEdits: true, fetchFirst: true,
    initialGitHub: { queriedAt: '2026-10-19T03:40:17.402900+00:00', combinedState: 'pending', statuses: [], workflow_runs: [], ciInterpretation: 'NOT CI PASS' },
    ...checks, modelStaticIdentity: { status: 'EXACT_BYTES_AND_ACCEPTED_IDENTITY_NO_GRAPH_PARSE', model, runtimeDescriptorAssertions: 'PASS' } });
  const metrics = extractMetrics(await load(metricPath));
  await save('decoder-b-decision.json', { input: metricPath, inputSha256: hash(await readFile(path.join(ROOT, metricPath))),
    historicalGeometry: 'owned600/future220, not current owned600/future170', metrics,
    interpretation: 'EXISTING_EXPOSED_EVIDENCE_DOES_NOT_ESTABLISH_DECODER_B_AS_AN_EXTRA_PITCH_REPAIR',
    sourceObservation: { A: 'Thresholded onset region, earliest local region peak, frame support at that peak gates proposal creation.',
      B: 'upstreamOnsetProjection proposes interpolated onset regression peaks; frame score recorded but does not suppress proposal creation. Frame threshold concerns offsets, not onset creation.' },
    limits: 'Not a universal quality ordering. Existing metric geometry differs; no new B run is justified solely by the current excess-pitch blocker without a preregistered suppression mechanism.',
    conclusion: 'DECODER_B_NEW_EXECUTION_NOT_JUSTIFIED_BY_EXISTING_EXTRA_PITCH_EVIDENCE', decoderBRuns: 0 });
  const sourceFiles = (await readdir(path.join(ROOT, DIR))).map(f => DIR + '/' + f);
  const files = [];
  const verificationReports = ['replay-tests.json', 'static-verification.json', 'prefreeze-tooling-observations.json', 'decoder-b-decision.json']
    .map(p => OUT + '/' + p);
  for (const file of [...new Set([...sourceFiles, ...runtimePaths, ...metadataPaths, ...verificationReports, ...Object.values(FIXED).map(v => v[0])])].sort())
    files.push({ path: file, sha256: hash(await readFile(path.join(ROOT, file))) });
  await save('replay-protocol-freeze.json', { role: 'V15_ZERO_NEURAL_PACED_REPLAY_PROTOCOL_FREEZE', createdAt: now(), startingHead: START,
    policy, files, executableBundleInputs: inputs, execution: COUNTS, v9VerdictsRead: false,
    payloadStatus: 'EXPOSED_EVIDENCE_ONLY_NO_NEW_ACOUSTIC_EXECUTION', beforeReplayRemoteVerificationRequired: true });
  console.log(JSON.stringify({ freezeSha256: hash(await readFile(path.join(ROOT, OUT, 'replay-protocol-freeze.json'))), inputCount: inputs.length }));
} else if (mode === 'proof') {
  await integrity(); await verifyFreeze();
  const head = git('rev-parse', 'HEAD');
  if (git('rev-parse', 'origin/' + BRANCH) !== head || git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0] !== head) throw Error('REMOTE_FREEZE_MISMATCH');
  await save('replay-remote-proof.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: hash(await readFile(path.join(ROOT, OUT, 'replay-protocol-freeze.json'))), execution: COUNTS });
  console.log(head);
} else if (mode === 'replay') {
  await integrity(); const freeze = await verifyFreeze();
  const proof = await load(OUT + '/replay-remote-proof.json'), startedAt = now();
  if (proof.remoteHead !== proof.freezeCommit || proof.freezeSha256 !== hash(await readFile(path.join(ROOT, OUT, 'replay-protocol-freeze.json')))
    || !(Date.parse(proof.remoteVerifiedAt) < Date.parse(startedAt))) throw Error('PROSPECTIVE_REPLAY_PROOF_REQUIRED');
  const { module: replay, inputs } = await bundle();
  if (JSON.stringify(inputs) !== JSON.stringify(freeze.executableBundleInputs)) throw Error('IMPORT_GRAPH_DRIFT');
  const scenarios = (await load(FIXED.scenarios[0])).scenarios;
  const cases = (await load(FIXED.cases[0])).cases, mapping = (await load(FIXED.mapping[0])).results;
  const acoustic = await load(FIXED.acoustic[0]);
  if (acoustic.trace.results.length !== 18 || acoustic.actualModelRuns !== 228 || !acoustic.modelRunCountComplete) throw Error('SEALED_ACOUSTIC_ACCOUNTING');
  const cells = [];
  try {
    for (const [scenarioId, expected] of Object.entries(freeze.policy.expectedSequences)) {
      const s = scenarios.find(s => s.scenarioId === scenarioId), c = cases[s.family];
      if (s.audioBoundCaseId !== c.audioBoundCaseId || s.HMs !== 50) throw Error('SCENARIO_BINDING_INVALID');
      const gestures = s.physicalTruthGestureIds.map(id => {
        const found = c.originalTruthCase.gestures.filter(g => g.gestureId === id);
        if (found.length !== 1) throw Error('TRUTH_IDENTITY_AMBIGUOUS'); return found[0];
      });
      for (const rate of freeze.policy.rates) {
        const mappings = mapping.filter(m => m.audioBoundCaseId === c.audioBoundCaseId && m.sourceRateHz === rate);
        if (mappings.length !== 1) throw Error('JOB_MAPPING_AMBIGUOUS');
        const m = mappings[0], jobs = acoustic.trace.results.filter(j => j.jobId === m.jobId);
        if (jobs.length !== 1 || jobs[0].sourceRateHz !== rate || jobs[0].sourceOriginSample !== m.sourceOriginSample) throw Error('SEALED_JOB_BINDING');
        cells.push(replay.replayCell(s, gestures, jobs[0], expected, freeze.policy.pacing.epochStrideMs));
      }
    }
    const failed = cells.filter(c => !c.expectedBehaviorSatisfied);
    const dangerous = cells.flatMap(c => c.traces.filter(t => t.verdict === 'MATCH' && !t.fullPhysicalSupport).map(t => ({ scenarioId: c.scenarioId, rate: c.sourceRateHz, ordinal: t.ordinal })));
    const disposition = failed.length ? 'STEP_ROBUST_A_V15_V13_PACED_REPLAY_COMPLETE_EXACT_SET_RECOGNITION_BLOCKER_REMAINS'
      : 'STEP_ROBUST_A_V15_V13_PACED_REPLAY_PASSES_READY_FOR_FRESH_MICROPHONE_QUALIFICATION_DESIGN';
    await save('paced-replay-results.json', { label: freeze.policy.replayLabel, evidenceStatus: 'EXPOSED_DEVELOPMENT_ONLY',
      startedAt, completedAt: now(), replayCount: 1, freezeCommit: proof.freezeCommit, freezeSha256: proof.freezeSha256,
      remoteVerifiedBeforeReplay: true, acousticOutputSha256: FIXED.acoustic[1], actualRuntime: freeze.policy.runtime,
      v9VerdictsRead: false, cellsExpected: 22, cellsCompleted: cells.length, cells, failedCells: failed.map(c => ({ scenarioId: c.scenarioId,
        sourceRateHz: c.sourceRateHz, classification: c.classification, actualSequence: c.actualSequence })),
      unsupportedMatchWitnesses: dangerous, oldBusyLateDenominators: freeze.policy.oldDenominators,
      productLatency: 'NOT_MEASURED', microphoneCooldown: 'NOT_SELECTED', execution: COUNTS, disposition });
    await integrity(); console.log(JSON.stringify({ cells: cells.length, failures: failed.length, unsupportedMatches: dangerous.length, disposition }));
  } catch (error) {
    await save('replay-integrity-failure.json', { startedAt, failedAt: now(), failure: String(error), partialCells: cells,
      execution: COUNTS, disposition: 'STEP_ROBUST_A_V15_REPLAY_INTEGRITY_BLOCKED', noRetry: true });
    throw error;
  }
} else throw Error('Only prepare/proof/replay allowed; no acoustic execution entrypoint exists.');
