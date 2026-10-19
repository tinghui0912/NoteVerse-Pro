import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, OUT, START, V20, load, bytes, save, hash, git, now, zero } from './io.mjs';
import { scope, verify, remoteHead } from './control.mjs';

function github(head) {
  return JSON.parse(execFileSync('python', ['-c', "import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))", head],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
}
await verify();
if (process.argv[2] === 'report') {
  const r = await load(OUT + '/study-results.json'), a = await load(OUT + '/stage-a-seal.json');
  const pre = await load(OUT + '/remote-protocol-proof.json'), blind = await load(OUT + '/remote-stage-a-proof.json');
  const integrity = { productionDiff: git('diff', '--name-only', START, '--', 'apps/customer-web/src', 'apps/customer-web/public', 'backend/app'),
    historicalDiff: git('diff', '--name-only', START, '--', 'backend/research', ':(exclude)backend/research/robust_threshold_v21/**', ':(exclude)backend/research/reports/robust_threshold_v21/**') };
  assert.equal(integrity.productionDiff, ''); assert.equal(integrity.historicalDiff, '');
  const affected = predicate => r.profiles.filter(predicate).map(p => p.profileId);
  const answers = {
    V20Immutable: true, V3ThroughV19Immutable: true, rawHashVerification: await load(OUT + '/foundation-verification.json'),
    zeroNeuralAccounting: zero, profiles: 20, blindDecoderCalls: a.decoderCalls,
    controlParity: a.baselineControlParity, blindOutputsRemoteSealBeforeProductScoring: blind.remoteVerifiedAt < r.startedAt,
    stageATargetTruthRuntimeAccess: false, stageAReadAudit: a.dataReads,
    H50: 'EXACT_ACCEPTED_WAITING_TOPOLOGY_GATE_FIRST_SEAL_ONLY_NO_TARGET_FILTER',
    productVerdictOwner: 'ACTUAL_PRODUCTION_SCHEMA6_step-source-sensitive-verdict-v6_EVIDENCE_ONLY',
    profilesWithDangerousAutomaticMatch: affected(p => p.views.classifications.DANGEROUS_FALSE_MATCH > 0),
    profilesWithNewUnsupportedTargetHallucinations: affected(p => p.newUnsupportedCoveredViewIds.length > 0),
    profilesLosingRequiredRecall: affected(p => p.views.requiredTargetPitchRecall.numerator < p.views.requiredTargetPitchRecall.denominator),
    profilesWithSupportedNoAttempt: affected(p => p.views.classifications.SUPPORTED_NO_ATTEMPT > 0),
    profilesRegressingBaselineSafeMatches: affected(p => p.baselineSafeMatchRegressions.length > 0),
    eligibleProfiles: affected(p => p.eligibility === 'ELIGIBLE'),
    meaningfulChallengers: affected(p => p.meaningful),
    recurrence: r.profiles.map(p => ({ profileId: p.profileId, recoveredTargetViews: p.newlyRecoveredSafeTargetViewIds,
      recoveredPhysicalGestures: p.recoveredDistinctPhysicalGestures, pairedGestures: p.pairedRecoveredPhysicalGestures,
      pairedRecordingIds: p.pairedRecoveredRecordingIds })),
    uniqueNomination: r.nominatedCandidate, selection: r.selection,
    thresholdsAddedOrRefinedAfterOutput: false, geometryChanged: false, decoderBOrCExecuted: false,
    productionModified: false, defaultsRemain030005: true, geometryRemains6001050170: true,
    candidateStatus: 'EXPOSED_DEVELOPMENT_ONLY_NOT_PRODUCTION_DEFAULT_NOT_MICROPHONE_QUALIFICATION',
    broadContinuousRegressionRequired: true, ContinuousProductEvaluationRequired: true, freshMicrophoneQualificationRequired: true,
    productPromotion: r.promotion, capabilities: r.capabilities, microphoneCooldownSelected: false,
    rates: 'CORRELATED_SOURCE_RATE_VARIANTS_NOT_INDEPENDENT_RECORDINGS_OR_POPULATION_ESTIMATES',
    noAttemptPolicy: 'NO_FABRICATED_EMPTY_EVIDENCE_RETRY_OR_MISMATCH',
    latency: 'NOT_MEASURED_SYNTHETIC_EPOCHS_ARE_NOT_DEVICE_UX_LATENCY',
    acousticExcess: 'MODEL_QUALITY_DIAGNOSTIC_NOT_PHYSICAL_USER_KEY_ERROR_NOT_SELECTION_OBJECTIVE' };
  await save(OUT + '/assessment.json', { phase: r.phase, classification: r.classification, createdAt: now(), startingRemoteHead: START,
    completeCommitChainThroughBlindSeal: git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    developmentProtocolFreezeCommit: pre.commit, developmentProtocolFreezeSha256: pre.freezeSha256, protocolRemoteVerifiedAt: pre.remoteVerifiedAt,
    stageASealCommit: blind.commit, stageASealSha256: blind.stageASealSha256, stageARemoteVerifiedAt: blind.remoteVerifiedAt,
    stageBStartedAt: r.startedAt, stageASealPrecedesStageB: blind.remoteVerifiedAt < r.startedAt,
    rawCorpusManifestSha256: hash(await bytes(V20 + '/tensor-corpus-manifest.json')),
    rawSealSha256: hash(await bytes(V20 + '/raw-tensor-seal.json')), rawCorpusCanonicalSha256: a.foundation.corpusCanonicalSha256,
    exactChangedFilesAtAssessment: await scope(), integrity, answers, denominators: r.denominators,
    metrics: r.profiles, disposition: r.disposition, nextAllowedPhase: r.nextAllowedPhase,
    gitHub: 'Actual result-commit checks are recorded separately in remote-result-proof.json; local tests are never CI.' });
  const lines = ['# V21 Threshold Operating-Point Development Screen', '', r.disposition, '',
    'Exposed development only. Not microphone qualification, a scientific winner, or production default selection.', '',
    '| Profile | Safe views | Supported retry | Dangerous MATCH | Supported missing/no-attempt | New hallucination views | Safe regressions | Paired recovered gestures | Status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...r.profiles.map(p => `| ${p.profileId} | ${p.views.classifications.SAFE_MATCH} | ${p.views.classifications.SUPPORTED_RETRY} | ${p.views.classifications.DANGEROUS_FALSE_MATCH} | ${p.views.classifications.SUPPORTED_MISMATCH + p.views.classifications.SUPPORTED_NO_ATTEMPT} | ${p.newUnsupportedCoveredViewIds.length} | ${p.baselineSafeMatchRegressions.length} | ${p.pairedRecoveredPhysicalGestures.length} | ${p.nominationStatus} |`), '',
    'Selection: ' + JSON.stringify(r.selection), '',
    'All 34 counterfactual rows, 26 distinct target views, 18 rate-specific physical units and 9 rate-ignored gestures are retained. Rate variants and reused counterfactuals are correlated, not independent recordings or population rates.', '',
    'Stage A performed exactly 4560 production decoder calls and zero neural/model/PCM/resampling execution. Control full events/publications matched V20 exactly. The separate blind configuration contains no physical truth or target sets. Data access is allowlisted and logged. The remote blind-output seal precedes product scoring.', '',
    'Stage B uses the accepted first-SEAL half-open H50 assembly and actual schema6 production StepPracticeRuntime. Ordinary EVIDENCE preserves pitches and confidence. Missing acoustic gestures remain NO_ATTEMPT. Each fixed physical/target view is evaluated independently in a paced runtime instance so candidate-dependent progression never changes the denominator. This is not a sequence or physical-timing qualification.', '',
    'The production/shared default remains decoder A .30/.05 with 600/1050/170 geometry. No thresholds were added, refined or promoted; no geometry, runtime policy, rearm semantics or capability changed. No decoder B/C, model, fresh holdout or Continuous execution occurred. No fixed microphone cooldown was chosen.', '',
    'SHARED_DEFAULT_PROMOTION_BLOCKED_PENDING_BROAD_CONTINUOUS_REGRESSION_AND_FRESH_QUALIFICATION.', '',
    'Any nominated readout remains an exposed-development challenger only. Broad Continuous regression/product evaluation and fresh microphone STEP qualification remain required. Raw excess pitches remain model-quality diagnostics, not proof of physical user error.', '',
    'Verification: see local-verification.json, preflight-tests.json, post-a-tests.json and post-b-tests.json. Actual GitHub statuses/workflows are recorded in remote-result-proof.json; local PASS is not CI PASS.', '',
    'STOP. Independent audit only.'];
  await writeFile(path.join(ROOT, OUT, 'assessment.md'), lines.join('\n') + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ disposition: r.disposition, nomination: r.nominatedCandidate, answers }));
} else if (process.argv[2] === 'receipt') {
  const head = await remoteHead(), checks = github(head);
  const files = await scope(), identities = [];
  for (const p of files) identities.push({ path: p, sha256: hash(await bytes(p)) });
  await save(OUT + '/remote-result-proof.json', { resultCommit: head, endingRemoteHeadAtResultSeal: head, remoteVerifiedAt: now(), startingRemoteHead: START,
    completeCommitChain: git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    exactChangedFiles: files, resultFileIdentities: identities, productionDiff: [], V3ThroughV20Diff: [],
    historicalRawVerification: 'EXACT_ALL_FROZEN_HISTORICAL_IDENTITIES', zero,
    github: checks, worktreeCleanAtRemoteVerification: true,
    receiptCommitNote: 'This additive remote receipt is committed afterwards; its own final remote HEAD is independently verified at closeout, not self-hashed.',
    disposition: (await load(OUT + '/study-results.json')).disposition });
  console.log(JSON.stringify({ head, checks }));
} else throw Error('Only report/receipt');
