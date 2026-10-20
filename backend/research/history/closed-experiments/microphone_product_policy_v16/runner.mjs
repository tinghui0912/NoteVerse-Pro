import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { inventory, evidencePaths, staticOnlySources } from './inventory.mjs';
import { ROOT, DIR, OUT, START, BRANCH, execution, hash, git, now, bytes, load, save,
  checkScope, historicalSnapshot, verifyFrozen, isolationBundle, freezeValue, validateCompleted, completedRecords, saveIdenticalInventory } from './core.mjs';
import { normalized, exact, p0, p1, classify, midiNumber, confusion, continuousProjection } from './policies.mjs';

async function continuousInventory() {
  const musical = await load(evidencePaths.musical), parity = await load(evidencePaths.parity), seal = await load(evidencePaths.continuousSeal);
  if (seal.status !== 'ACOUSTIC_PREDICTIONS_SEALED' || hash(await bytes(evidencePaths.musical)) !== seal.sha256
    || parity.status !== 'PASS' || parity.semanticDiffs.length || musical.status !== 'PASS' || !musical.countComplete) throw Error('CONTINUOUS_SEAL_OR_PARITY_INTEGRITY');
  const records = completedRecords(parity, musical);
  if (records.length !== 36) throw Error('EXISTING_EVALUATION_INVENTORY_CHANGED');
  const sourceManifest = await load(evidencePaths.sourceManifest);
  if (sourceManifest.clips[0].id !== musical.results[0].id) throw Error('CONTROLLER_SOURCE_BINDING');
  return { records, rows: records.map(r => ({ id: r.id, physicalClipId: r.physicalClipId, rate: r.rate, role: r.role,
    sourceMetadata: sourceManifest.clips.filter(c => c.id === r.physicalClipId).map(c => ({ takeId: c.takeId,
      sourceWav: c.sourceWav, sourceWavSha256: c.sourceWavSha256, startSeconds: c.startSeconds, prerollMs: c.prerollMs,
      sourceRateFixtureSha256: c.pcm[r.rate].sha256, pcmReadInV16: false })),
    ...validateCompleted(r.evaluation, r.publications) })), acousticSealSha256: seal.sha256 };
}

const mode = process.argv[2];
if (mode === 'prepare') {
  await checkScope(); const contract = await load(DIR + '/contract.json');
  await saveIdenticalInventory('historical-raw-identities.json', { startingHead: START, files: await historicalSnapshot(),
    note: 'Baseline raw checkout bytes after clean starting gate; existing Git text filters do not justify altering any historical bytes.' });
  const codeInventory = [];
  for (const row of inventory) {
    const content = (await bytes(row.path)).toString('utf8'), offset = content.indexOf(row.anchor);
    if (offset < 0) throw Error('INVENTORY_ANCHOR_MISSING:' + row.path);
    codeInventory.push({ ...row, line: content.slice(0, offset).split('\n').length, sha256: hash(await bytes(row.path)) });
  }
  await saveIdenticalInventory('continuous-code-inventory.json', { rows: codeInventory,
    scoreFormula: 'NOT_FOUND_IN_INSPECTED_CURRENT_COMPLETED_EVALUATION_TO_UI_AND_SAVE_PATHS',
    actualPersistence: 'Transient store includes evaluation; durable media-take API excludes evaluation/counts/numerical score',
    liveFeedback: 'Finalized MATCHED/MISSING annotations only; no provisional low-latency match path or direct WRONG/EXTRA badge currently wired',
    recommendation: 'Preserve finality; future provisional positive feedback requires a separate non-authoritative design, not promoting unfinalized ownership',
    userErrorClaim: 'Microphone Extra playing label is not validated as physical key-event truth; public microphone capability remains closed' });
  const ci = await continuousInventory();
  await save('existing-evidence-inventory.json', { records: ci.rows, completedEvaluations: ci.rows.length,
    uniqueMusicalClips: 3, rates: [44100, 48000], counterfactualLedgerCount: 36, controllerLedgersProjected: 0,
    controllerDiagnostic: { completedStatus: 'COMPLETE', retainedPublicationCount: 11, retainedPublicationArray: false,
      usedForProjection: false, classification: 'STRICT_PUBLICATION_CONTENT_LINK_NOT_AVAILABLE_IN_RETAINED_CONTROLLER_TRACE',
      selectionDecision: 'PREFREEZE_PROVENANCE_COMPLETENESS_ONLY_NO_COUNTERFACTUAL_OUTPUT_READ' },
    notIndependentAcousticTrials: true, silenceCompletedScenariosNotFabricated: true,
    provenanceStatus: 'SUFFICIENT_FOR_CATEGORY_ONLY_REINTERPRETATION_NOT_PHYSICAL_USER_ERROR_VALIDATION' });
  const graph = (await isolationBundle()).inputGraph;
  const sourceFiles = (await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p);
  const files = [];
  for (const file of [...new Set([...sourceFiles, ...inventory.map(r => r.path), ...Object.values(evidencePaths), ...staticOnlySources, ...graph,
    OUT + '/historical-raw-identities.json', OUT + '/continuous-code-inventory.json', OUT + '/existing-evidence-inventory.json',
    OUT + '/research-tests-v2.json', OUT + '/local-verification.json', OUT + '/prefreeze-tooling-observations.json'])].sort()) files.push({ path: file, sha256: hash(await bytes(file)) });
  await save('policy-research-freeze.json', { role: 'V16_ZERO_NEURAL_PRODUCT_POLICY_RESEARCH_FREEZE', createdAt: now(), startingHead: START,
    contract, files, testRuntimeImportGraph: graph, newExecutionBudget: execution,
    counterfactualAnalysis: 'NOT_STARTED', analysisExecutionsAllowed: 1, remoteProofRequired: true,
    initialGitHub: { queriedAt: '2026-10-19T05:04:57.597822+00:00', combinedState: 'pending', statuses: [], workflow_runs: [], ciInterpretation: 'NOT CI PASS' } });
  console.log(JSON.stringify({ files: files.length, completedEvaluations: ci.rows.length,
    freezeSha256: hash(await bytes(OUT + '/policy-research-freeze.json')) }));
} else if (mode === 'proof') {
  await verifyFrozen(); const head = git('rev-parse', 'HEAD');
  if (git('rev-parse', 'origin/' + BRANCH) !== head || git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0] !== head) throw Error('REMOTE_FREEZE_MISMATCH');
  await save('remote-policy-freeze-proof.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: hash(await bytes(OUT + '/policy-research-freeze.json')), counterfactualAnalysis: 'NOT_STARTED', execution });
  console.log(head);
} else if (mode === 'analyze') {
  const frozen = await verifyFrozen(), proof = await load(OUT + '/remote-policy-freeze-proof.json'), startedAt = now();
  if (proof.freezeCommit !== proof.remoteHead || proof.freezeSha256 !== hash(await bytes(OUT + '/policy-research-freeze.json'))
    || !(Date.parse(proof.remoteVerifiedAt) < Date.parse(startedAt))) throw Error('REMOTE_PROOF_REQUIRED');
  await save('analysis-started.json', { startedAt, executionOrdinal: 1, freezeCommit: proof.freezeCommit, execution, noRetry: true });
  try {
    const v15 = freezeValue(await load(evidencePaths.v15)), scenarios = (await load(evidencePaths.scenarios)).scenarios;
    const truth = (await load(evidencePaths.truth)).cases, attempts = [];
    if (v15.disposition !== frozen.contract.historicalV15Disposition || v15.cells.length !== 22) throw Error('V15_HISTORICAL_RESULT_DRIFT');
    for (const cell of v15.cells) {
      const scenario = scenarios.find(s => s.scenarioId === cell.scenarioId), physical = truth[cell.family];
      if (!scenario || scenario.audioBoundCaseId !== cell.audioBoundCaseId || physical.audioBoundCaseId !== cell.audioBoundCaseId) throw Error('CASE_BINDING');
      for (const t of cell.traces) {
        const target = normalized(scenario.targetPitchSets[t.ready.step.currentIndex]);
        if (!exact(target, t.activeTarget.attackPitches.map(midiNumber))) throw Error('ACTIVE_TARGET_MISMATCH');
        const physicalGesture = physical.originalTruthCase.gestures.find(g => g.gestureId === t.physicalTruth.gestureId);
        if (!physicalGesture || JSON.stringify(physicalGesture) !== JSON.stringify(t.physicalTruth)) throw Error('PHYSICAL_TRUTH_BINDING');
        const observed = normalized(t.assembly.observations.map(o => o.midiPitch));
        if (!exact(observed, t.observedMidiPitchSet)) throw Error('ACOUSTIC_SET_MUTATION');
        const baseline = p0(observed, target), coverage = p1(observed, target);
        if (baseline !== t.verdict || baseline !== t.productRecord.verdict) throw Error('P0_V15_PARITY_FAILURE');
        const support = normalized(physicalGesture.normalizedPitchSet);
        attempts.push({ scenarioId: cell.scenarioId, family: cell.family, rate: cell.sourceRateHz, jobId: cell.jobId,
          audioBoundCaseId: cell.audioBoundCaseId, attemptOrdinal: t.ordinal, v15AttemptId: t.identity.attemptId,
          targetGeneration: t.identity.targetGeneration, expected: target, physicalTruth: support,
          physicalGestureId: physicalGesture.gestureId, physicalOnsetMs: physicalGesture.onsetMs, acousticObserved: observed,
          sealedObservationIds: t.assembly.observations.map(o => o.observationId),
          P0: { verdict: baseline, ...classify(baseline, support, target) },
          P1: { verdict: coverage, ...classify(coverage, support, target) },
          midiExactPhysicalSupport: exact(support, target),
          specialClassification: cell.scenarioId === 'wrong_octave' && coverage === 'MATCH' && !classify(coverage, support, target).fullPhysicalSupport
            ? 'MICROPHONE_COVERAGE_POLICY_UNSAFE_WRONG_OCTAVE_FALSE_ACCEPT'
            : cell.scenarioId === 'extra_chord_tone' && coverage === 'MATCH' ? 'MICROPHONE_EXTRA_NONBLOCKING_BY_DESIGN' : null });
      }
    }
    if (attempts.length !== 34) throw Error('ATTEMPT_INVENTORY_DRIFT');
    const aggregate = rows => ({ attempts: rows.length, P0: confusion(rows.map(r => r.P0)), P1: confusion(rows.map(r => r.P1)) });
    const table = [aggregate(attempts)];
    const byRate = [44100, 48000].map(rate => ({ rate, ...aggregate(attempts.filter(a => a.rate === rate)) }));
    const byScenario = v15.cells.map(c => ({ scenarioId: c.scenarioId, family: c.family, rate: c.sourceRateHz,
      ...aggregate(attempts.filter(a => a.scenarioId === c.scenarioId && a.rate === c.sourceRateHz)) }));
    const byFamily = [...new Set(attempts.map(a => a.family))].flatMap(family => [44100, 48000].map(rate => ({ family, rate,
      ...aggregate(attempts.filter(a => a.family === family && a.rate === rate)) })));
    const falseAccepts = attempts.filter(a => a.P1.classification === 'FALSE_ACCEPT');
    const stepDisposition = falseAccepts.some(a => a.scenarioId === 'wrong_octave')
      ? 'STEP_MICROPHONE_V16_NAIVE_REQUIRED_PITCH_COVERAGE_UNSAFE_WRONG_OCTAVE_FALSE_ACCEPT'
      : falseAccepts.length ? 'MICROPHONE_REQUIRED_PITCH_COVERAGE_NOT_SAFE_AS_UNCONDITIONAL_MATCH_POLICY'
      : 'STEP_MICROPHONE_V16_REQUIRED_PITCH_COVERAGE_DEVELOPMENT_POLICY_SUPPORTED_ON_EXISTING_EXPOSED_EVIDENCE';
    await save('step-policy-results.json', { startedAt, completedAt: now(), inputSha256: hash(await bytes(evidencePaths.v15)),
      label: frozen.contract.label, attempts, overall: table[0], byRate, byScenario, byFamily,
      P0V15Parity: '34_OF_34_EXACT', P1FalseAccepts: falseAccepts,
      P1MatchPhysicalSupportAudit: attempts.filter(a => a.P1.verdict === 'MATCH').map(a => ({ scenarioId: a.scenarioId, rate: a.rate,
        ordinal: a.attemptOrdinal, expected: a.expected, physicalTruth: a.physicalTruth, fullPhysicalSupport: a.P1.fullPhysicalSupport })),
      physicalTruthCriterion: frozen.contract.physicalTruth, hypotheticalProgressionExecuted: false,
      unconditionalCoveragePolicy: falseAccepts.length ? 'MICROPHONE_REQUIRED_PITCH_COVERAGE_NOT_SAFE_AS_UNCONDITIONAL_MATCH_POLICY' : 'EXPOSED_DEVELOPMENT_SUPPORT_ONLY',
      noQualifiedProductionMicrophoneVerdictPolicy: true, P2Implemented: false, newReadoutRequiredByThisEvidence: 'NOT_ESTABLISHED',
      retirement: frozen.contract.retirement, execution, disposition: stepDisposition });

    const ci = await continuousInventory(), continuous = [];
    for (const r of ci.records) {
      const evaluation = freezeValue(r.evaluation), before = hash(JSON.stringify(evaluation));
      const C0 = continuousProjection(evaluation, 'MICROPHONE', 'C0'), C1 = continuousProjection(evaluation, 'MICROPHONE', 'C1');
      if (JSON.stringify(C0.internalCategoryCounts) !== JSON.stringify(C1.internalCategoryCounts)
        || JSON.stringify(C0.targetStrikeRecall) !== JSON.stringify(C1.targetStrikeRecall)
        || JSON.stringify(C0.chordCompleteness) !== JSON.stringify(C1.chordCompleteness)
        || JSON.stringify(C0.timing) !== JSON.stringify(C1.timing) || before !== hash(JSON.stringify(evaluation))) throw Error('CONTINUOUS_PROJECTION_MUTATED_OWNERSHIP_OR_METRICS');
      continuous.push({ id: r.id, role: r.role, physicalClipId: r.physicalClipId, rate: r.rate, family: r.family,
        evaluationSha256Before: before, evaluationSha256After: hash(JSON.stringify(evaluation)),
        provenance: validateCompleted(evaluation, r.publications), C0, C1,
        changes: { targetStrikeRecall: 0, chordCompleteness: 0, timing: 'EXACTLY_UNCHANGED',
          strongNegativeCategoryItems: C1.strongNegativeCount - C0.strongNegativeCount,
          numericalScore: 'NOT_COMPARABLE_NO_CURRENT_FORMULA', internalOwnership: 'EXACTLY_UNCHANGED' } });
    }
    const aggregateContinuous = rows => ({ records: rows.length,
      C0StrongNegativeCategoryItems: rows.reduce((n, r) => n + r.C0.strongNegativeCount, 0),
      C1StrongNegativeCategoryItems: rows.reduce((n, r) => n + r.C1.strongNegativeCount, 0),
      internalCategoryCounts: Object.fromEntries(['MATCHED', 'MISSING', 'WRONG', 'EXTRA', 'NOT_REACHED'].map(k => [k, rows.reduce((n, r) => n + r.C0.internalCategoryCounts[k], 0)])),
      targetStrikeRecallChange: 0, chordCompletenessChange: 0, timingChange: 'UNCHANGED',
      finalScore: 'NOT_COMPARABLE_NO_CURRENT_FORMULA' });
    const continuousDisposition = 'CONTINUOUS_MICROPHONE_SOURCE_SENSITIVE_PRODUCT_INTERPRETATION_SUPPORTED_FOR_FURTHER_DEVELOPMENT';
    await save('continuous-projection-results.json', { startedAt, completedAt: now(), records: continuous,
      overall: aggregateContinuous(continuous), byRate: [44100, 48000].map(rate => ({ rate, ...aggregateContinuous(continuous.filter(r => r.rate === rate)) })),
      independentRecordingWarning: '36 ledgers share 3 musical clips across two rates. Repeated counterfactual ledgers are not independent acoustic trials. Controller completion excluded prospectively because only publication count, not array, was retained.',
      strongNegativeMeaning: frozen.contract.continuousMetrics.strongNegativeCount,
      currentScoringAndPersistence: 'No deterministic numerical score/accuracy or durable evaluation upload in inspected current path. C1 does not demonstrate a score improvement.',
      currentVsProposed: 'Live matched/missing annotations already exclude direct EXTRA/WRONG observation badges. Final review Extra playing count is current; C1 possible-acoustic wording is proposed only.',
      noEvidenceOfPhysicalExtraKeyTruth: true, publicMicrophoneValidation: 'NOT_ESTABLISHED',
      modelQuality: { inputEvidenceUnchanged: true, rawOwnershipCategoriesRetained: true, acousticPrecisionOrFalseOnsetsNotRecomputed: true,
        historicalMetricSource: evidencePaths.historicalQualityMetrics, historicalMetricSha256: hash(await bytes(evidencePaths.historicalQualityMetrics)) },
      futureEvidenceNeeded: ['Prospectively frozen actual-device acoustic observations with independent physical truth and source provenance',
        'Calibration of false wrong/extra physical-key claims across rooms, chords/octaves, noise, instruments',
        'A retained controller publication array, not count 11, if that completion is to enter strict per-observation-content projection',
        'Independent acceptance of source-sensitive wording and any separately preregistered scoring policy',
        'No new overall score formula inferred from category counts'],
      productionModified: false, execution, disposition: continuousDisposition });
    await verifyFrozen();
    await save('analysis-complete.json', { startedAt, completedAt: now(), analysisExecutions: 1,
      freezeCommit: proof.freezeCommit, remoteVerifiedAt: proof.remoteVerifiedAt,
      remoteVerifiedBeforeAnalysis: true, stepDisposition, continuousDisposition, execution });
    console.log(JSON.stringify({ attempts: attempts.length, byRate, P1FalseAccepts: falseAccepts.length,
      continuous: aggregateContinuous(continuous), stepDisposition, continuousDisposition }));
  } catch (error) {
    await save('analysis-integrity-failure.json', { startedAt, failure: String(error), failedAt: now(), noRetry: true, execution });
    throw error;
  }
} else throw Error('Only prepare/proof/analyze exist; no neural, decoder, PCM or product execution command.');
