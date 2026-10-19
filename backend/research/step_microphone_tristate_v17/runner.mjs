import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, START, BRANCH, inputs, productionSources, execution, now, hash, git, bytes, load, save,
  checkScope, continuousUnchanged, historicalSnapshot, verifyFrozen, bundleDomain } from './core.mjs';
import { norm, equal, covers, p2, physicalClass, groupPhysical, usability, reopen, stable } from './policy.mjs';

const mode = process.argv[2];
if (mode === 'prepare') {
  await checkScope(); const contract = await load(DIR + '/contract.json'), domain = await bundleDomain();
  const model = await load('apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json');
  if (model.model.onnxSha256 !== contract.baseline.modelSha256 || model.input.modelInputSamples !== 29120 || model.input.sampleRateHz !== 16000
    || model.input.modelInputMs !== 1820 || model.decoder.default !== 'A' || model.decoder.onsetThreshold !== .30 || model.decoder.frameThreshold !== .05
    || model.ownership.ownedMs !== 600 || model.ownership.fullWindowPastMs !== 1050 || model.ownership.futureContextMs !== 170) throw Error('FROZEN_BASELINE_DRIFT');
  const attempt = (await bytes(productionSources[1])).toString();
  if (!attempt.includes("StepAttemptVerdict = 'MATCH' | 'MISMATCH' | 'RETRY'") || !attempt.includes("StepRetryReason = 'UNCERTAIN' | 'TOO_QUIET'")) throw Error('EXISTING_RETRY_SEMANTICS_MISSING');
  await save('historical-raw-identities.json', { startingHead: START, files: await historicalSnapshot() });
  await save('existing-domain-and-ui-inventory.json', { productionRuntime: 'StepPracticeRuntime schema5 / step-paced-attempt-v5',
    finalizedRetry: true, retryReason: 'UNCERTAIN', phase: 'POST_VERDICT', advancementOnRetry: false,
    explicitRearmRequired: true, currentSkip: 'READY-only explicit command creates a separate skip record; not a MATCH',
    presentation: 'Controller/hook expose lastFinalizedVerdict and interaction phase. practice-status maps RETRY during POST_VERDICT to stepPostVerdictRetry. No microphone analyzer or qualified microphone RETRY policy is wired.',
    UIImplementationInV17: false, Continuous: await continuousUnchanged(),
    sourceFiles: await Promise.all(productionSources.map(async p => ({ path: p, sha256: hash(await bytes(p)) }))) });
  const ownFiles = (await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p), continuous = await load(inputs.continuousInventory), files = [];
  for (const p of [...new Set([...ownFiles, ...Object.values(inputs), ...productionSources, ...domain.graph,
    ...continuous.rows.map(r => r.path), OUT + '/historical-raw-identities.json', OUT + '/existing-domain-and-ui-inventory.json',
    OUT + '/research-tests.json', OUT + '/local-verification.json'])].sort()) files.push({ path: p, sha256: hash(await bytes(p)) });
  await save('tristate-policy-freeze.json', { role: 'V17_CONSERVATIVE_TRISTATE_RESEARCH_PROTOCOL_FREEZE', startingHead: START,
    createdAt: now(), contract, files, executableDomainGraph: domain.graph, execution, analysis: 'NOT_STARTED',
    analysisExecutionsAllowed: 1, remoteProofRequired: true,
    initialGitHub: { queriedAt: '2026-10-19T05:43:31.327113+00:00', combinedState: 'pending', statuses: [], workflow_runs: [], ciInterpretation: 'NOT CI PASS' } });
  console.log(JSON.stringify({ files: files.length, freezeSha256: hash(await bytes(OUT + '/tristate-policy-freeze.json')) }));
} else if (mode === 'proof') {
  await verifyFrozen(); const head = git('rev-parse', 'HEAD');
  if (git('rev-parse', 'origin/' + BRANCH) !== head || git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0] !== head) throw Error('REMOTE_FREEZE_MISMATCH');
  await save('remote-freeze-proof.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: hash(await bytes(OUT + '/tristate-policy-freeze.json')), analysis: 'NOT_STARTED', execution });
  console.log(head);
} else if (mode === 'analyze') {
  const freeze = await verifyFrozen(), proof = await load(OUT + '/remote-freeze-proof.json'), startedAt = now();
  if (proof.freezeCommit !== proof.remoteHead || proof.freezeSha256 !== hash(await bytes(OUT + '/tristate-policy-freeze.json'))
    || !(Date.parse(proof.remoteVerifiedAt) < Date.parse(startedAt))) throw Error('PROSPECTIVE_REMOTE_PROOF_REQUIRED');
  await save('analysis-started.json', { startedAt, freezeCommit: proof.freezeCommit, executionOrdinal: 1, execution });
  const rows = [], cells = [];
  try {
    const v15 = await load(inputs.v15), v16 = await load(inputs.v16), cases = (await load(inputs.cases)).cases;
    const scenarios = (await load(inputs.scenarios)).scenarios, domain = await bundleDomain();
    if (stable(domain.graph) !== stable(freeze.executableDomainGraph) || v15.cells.length !== 22 || v16.attempts.length !== 34) throw Error('INPUT_OR_DOMAIN_GRAPH_DRIFT');
    for (const cell of v15.cells) {
      const scenario = scenarios.find(s => s.scenarioId === cell.scenarioId), source = cases[cell.family];
      if (!scenario || scenario.audioBoundCaseId !== cell.audioBoundCaseId || source.audioBoundCaseId !== cell.audioBoundCaseId) throw Error('CASE_BINDING_MISMATCH');
      const h = domain.module.runtime(scenario.targetPitchSets, `v17:${cell.scenarioId}:${cell.sourceRateHz}`), cellRows = [];
      h.owner.setInputUnavailable(); h.owner.acceptInputAfter(h.time(cell.traces[0].ready.step.inputEligibleAfter.ms));
      for (const t of cell.traces) {
        const old = v16.attempts.filter(r => r.scenarioId === cell.scenarioId && r.rate === cell.sourceRateHz && r.attemptOrdinal === t.ordinal);
        if (old.length !== 1) throw Error('V16_ROW_MAPPING_AMBIGUOUS');
        const r = old[0], gesture = source.originalTruthCase.gestures.find(g => g.gestureId === r.physicalGestureId);
        if (!gesture || stable(gesture) !== stable(t.physicalTruth) || !equal(gesture.normalizedPitchSet, r.physicalTruth)
          || !equal(r.expected, scenario.targetPitchSets[t.ready.step.currentIndex]) || r.audioBoundCaseId !== cell.audioBoundCaseId) throw Error('PHYSICAL_OR_TARGET_BINDING');
        const observed = norm(t.assembly.observations.map(o => o.midiPitch));
        if (!equal(observed, r.acousticObserved) || stable(r.sealedObservationIds) !== stable(t.assembly.observations.map(o => o.observationId))
          || r.P0.verdict !== t.verdict || (equal(observed, r.expected) ? 'MATCH' : 'MISMATCH') !== r.P0.verdict
          || (covers(observed, r.expected) ? 'MATCH' : 'MISMATCH') !== r.P1.verdict) throw Error('V15_V16_EVIDENCE_OR_POLICY_PARITY');
        const result = p2(observed, r.expected), physical = physicalClass(result, r.physicalTruth, r.expected);
        if (physical.classification === 'DANGEROUS_FALSE_MATCH') {
          await save('dangerous-match-witness.json', { sourceRow: r, result, physical, execution });
          throw Object.assign(Error('P2_CONSERVATIVE_TRISTATE_SAFETY_FAILURE'), { safety: true });
        }
        const ready = h.owner.snapshot(), target = h.owner.currentTarget();
        if (!h.owner.canAcceptAttempt || stable([...target.attackPitches].sort()) !== stable(r.expected.map(domain.module.pitch).sort())) throw Error('PRODUCT_READY_TARGET_DIVERGENCE');
        h.clock.set(t.identity.attemptStartSessionTime.ms);
        const identity = h.owner.openAttempt(h.time(h.clock.nowMs()));
        if (!identity || !h.owner.analyzeAttempt(identity)) throw Error('PRODUCT_OPEN_ANALYZE_DIVERGENCE');
        const evidence = result.verdict === 'RETRY' ? { kind: 'RETRY', reason: 'UNCERTAIN', captureEndSessionTime: h.time(t.productRecord.captureEndSessionTime.ms) }
          : { kind: 'EVIDENCE', observedAttackPitches: [...t.assembly.pitches], confidence: t.assembly.confidence, captureEndSessionTime: h.time(t.productRecord.captureEndSessionTime.ms) };
        const completed = h.owner.completeAttempt(identity, evidence);
        if (completed.kind !== 'FINALIZED' || completed.record.verdict !== result.verdict
          || completed.record.retryReason !== result.reason) throw Error('PRODUCTION_VERDICT_PARITY');
        const post = h.owner.snapshot();
        if (post.step.attemptState !== 'POST_VERDICT' || post.step.targetGeneration !== ready.step.targetGeneration) throw Error('POST_VERDICT_EARLY_ADVANCEMENT');
        h.clock.set(t.rearmed.step.inputEligibleAfter.ms); h.owner.rearm(h.time(h.clock.nowMs()));
        const rearmed = h.owner.snapshot();
        if (result.verdict !== 'MATCH' && rearmed.step.targetGeneration !== ready.step.targetGeneration) throw Error('RETRY_OR_MISMATCH_ADVANCED');
        const row = { rowId: `${cell.scenarioId}:${cell.sourceRateHz}:${t.ordinal}`, scenarioId: cell.scenarioId, family: cell.family,
          ordinal: t.ordinal, rate: cell.sourceRateHz, recordingId: source.originalTruthCase.recordingId,
          audioBoundCaseId: r.audioBoundCaseId, physicalGestureId: r.physicalGestureId, physicalOnsetMs: gesture.onsetMs,
          expected: r.expected, physicalTruth: r.physicalTruth, acousticObserved: observed, observations: t.assembly.observations,
          P0: r.P0, P1: r.P1, P2: result, ...physical, identity, productRecord: completed.record,
          domainTrace: { ready, postVerdict: post, rearmed },
          retryEvidenceSidecar: result.verdict === 'RETRY' ? 'Original acoustic observations preserved here; existing product RETRY record has []/null by design, not target-filtered evidence' : null };
        rows.push(row); cellRows.push(row);
      }
      cells.push({ scenarioId: cell.scenarioId, sourceRateHz: cell.sourceRateHz,
        verdicts: cellRows.map(r => r.P2.verdict), attemptIds: cellRows.map(r => r.identity.attemptId),
        targetGenerationsAtOpen: cellRows.map(r => r.identity.targetGeneration), allPostVerdictAndExplicitRearm: true });
    }
    if (rows.length !== 34 || cells.length !== 22) throw Error('INCOMPLETE_COUNTERFACTUAL_COVERAGE');
    const groups = groupPhysical(rows), burden = usability(groups), recommendation = reopen(groups, 0);
    const counts = list => ({ verdicts: Object.fromEntries(['MATCH', 'RETRY', 'MISMATCH'].map(k => [k, list.filter(r => r.P2.verdict === k).length])),
      classifications: Object.fromEntries(['SAFE_MATCH', 'DANGEROUS_FALSE_MATCH', 'SUPPORTED_RETRY', 'UNSUPPORTED_RETRY', 'TRUE_REJECT', 'FALSE_REJECT'].map(k => [k, list.filter(r => r.classification === k).length])) });
    const targetViews = groups.flatMap(g => g.targetViews.map(v => ({ ...v, unitId: g.unitId, observed: g.acousticObserved })));
    const supported = targetViews.filter(v => v.physicalTargetSupported), unsupported = targetViews.filter(v => !v.physicalTargetSupported);
    const rate = (n, d) => ({ numerator: n, denominator: d, value: d ? n / d : null });
    const requiredCount = supported.reduce((n, v) => n + v.expected.length, 0), requiredPresent = supported.reduce((n, v) => n + v.expected.filter(p => v.observed.includes(p)).length, 0);
    const diagnostics = { unitTargetViews: targetViews.length, supportedTargetViews: supported.length, unsupportedTargetViews: unsupported.length,
      requiredTargetPitchRecall: rate(requiredPresent, requiredCount),
      cleanExactTargetRate: rate(supported.filter(v => equal(v.observed, v.expected)).length, supported.length),
      supportedAmbiguityRate: rate(supported.filter(v => v.P2.verdict === 'RETRY').length, supported.length),
      dangerousTargetHallucinationRate: rate(unsupported.filter(v => covers(v.observed, v.expected)).length, unsupported.length),
      missingTargetFalseNegativeRate: rate(supported.filter(v => !covers(v.observed, v.expected)).length, supported.length),
      interpretation: 'UNIQUE_UNIT_TARGET_VIEWS_NOT_INDEPENDENT_RECORDINGS_NOT_GENERALIZABLE_PRODUCT_RATE',
      hallucinationRiskNotEliminatedByRetry: true };
    await save('tristate-results.json', { label: freeze.contract.label, startedAt, completedAt: now(), rows, cells,
      counterfactualAttempts: rows.length, scenarioRateCells: cells.length, overall: counts(rows),
      byRate: [44100, 48000].map(rate => ({ rate, ...counts(rows.filter(r => r.rate === rate)) })),
      byScenario: cells.map(c => ({ scenarioId: c.scenarioId, rate: c.sourceRateHz, ...counts(rows.filter(r => r.scenarioId === c.scenarioId && r.rate === c.sourceRateHz)) })),
      uniquePhysicalEvidenceUnits: groups.length, physicalGroups: groups, multiplicitySum: groups.reduce((n, g) => n + g.multiplicity, 0),
      distinctRecordingIds: [...new Set(groups.map(g => g.recordingId))].sort(),
      distinctPhysicalGesturesIgnoringRate: [...new Set(groups.map(g => stable([g.recordingId, g.key.physicalGestureId])))].length,
      supportedUniqueUnitBurden: burden, burdenByRate: [44100, 48000].map(rate => ({ rate, ...usability(groups.filter(g => g.key.sourceRateHz === rate)) })),
      productRelevantOperatingPointDiagnostics: diagnostics, reopenDecision: recommendation,
      persistentRetry: 'PERSISTENT_ACOUSTIC_AMBIGUITY_USABILITY_RISK',
      persistentRetryLimitation: 'Two rate variants are not repeated user trials. Distinct frozen same-target physical repeats can both return RETRY. Deterministic ambiguity may persist; no population or repeated-device-run rate claim.',
      retirement: freeze.contract.retirement, baselineUnchanged: freeze.contract.baseline, modelInputContract: 'MODEL_INPUT_CONTRACT_NOT_REOPENED',
      Continuous: await continuousUnchanged(), execution,
      disposition: 'STEP_MICROPHONE_V17_CONSERVATIVE_TRISTATE_SAFETY_SUPPORTED_ON_EXISTING_EXPOSED_EVIDENCE' });
    await verifyFrozen();
    await save('analysis-complete.json', { startedAt, completedAt: now(), analysisExecutions: 1, freezeCommit: proof.freezeCommit,
      freezeSha256: proof.freezeSha256, remoteVerifiedAt: proof.remoteVerifiedAt, remoteVerifiedBeforeAnalysis: true, execution });
    console.log(JSON.stringify({ counts: counts(rows), uniquePhysicalUnits: groups.length, burden, reopen: recommendation.recommendation, diagnostics }));
  } catch (error) {
    await save('analysis-failure.json', { failure: String(error), partialRows: rows, partialCells: cells, failedAt: now(), noRetry: true,
      disposition: error.safety ? 'STEP_MICROPHONE_V17_CONSERVATIVE_TRISTATE_SAFETY_FAILURE' : 'STEP_MICROPHONE_V17_EVALUATION_INTEGRITY_BLOCKED', execution });
    throw error;
  }
} else throw Error('Only prepare/proof/analyze; no model, decoder, PCM, Continuous projection or parameter execution command.');
