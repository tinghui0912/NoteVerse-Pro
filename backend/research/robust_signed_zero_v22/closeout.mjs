import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ROOT, OUT, V21, START, bytes, json, save, hash, git, now, execution } from './io.mjs';
import { verify, scope, remote } from './evidence.mjs';

export async function report() {
  await verify(); const r=await json(OUT+'/reevaluation-results.json'), identities=await json(OUT+'/evidence-identities.json');
  const noChallenger=r.disposition==='ROBUST_V22_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED';
  const preciseConclusion=noChallenger
    ? 'Across the preregistered onset [.15,.20,.25,.30,.35] x frame [.05,.10,.15,.20] grid at frozen Robust 600/1050/170 geometry, none of the 19 non-control operating points converted an exposed supported-ambiguity RETRY into a safe automatic MATCH under the V18 runtime policy.'
    : 'See the independently recomputed meaningful challenger set and frozen lexicographic ranking. No production promotion is authorized.';
  const answers={
    '01_V21ImmutableAndStillIntegrityBlocked':true,'02_V21Resumed':false,'03_neuralRuns':execution.neuralRuns,
    '04_decoderRuns':execution.decoderACalls+execution.decoderBCalls+execution.decoderCCalls,
    '05_productRuntimeAndVerdictRuns':{constructions:execution.StepPracticeRuntimeConstructions,verdicts:execution.productVerdictRuns},
    '06_stageAArtifactHashesVerified':identities.stageAArtifacts.length,'07_stageBArtifactHashesVerified':identities.stageBArtifacts.length,
    '08_V21RawStudyResultSha256':identities.rawGeneratedStudyResultsSha256,
    '09_onlyPermittedNormalization':r.normalization,'10_epsilonOrRoundingToleranceIntroduced':false,
    '11_independentSemanticParity':r.independentSemanticParity,'12_controlTargetViewMetrics':r.control.views,
    '13_eligibleChallengers':r.counts.eligible,'14_meaningfulChallengers':r.counts.meaningful,
    '15_challengersWithAnySafeMatchRecovery':r.counts.anySafeRecovery,
    '16_challengersWithNewUnsupportedHallucinations':r.challengerMatrix.filter(p=>p.newUnsupportedHallucinationViewIds.length>0).map(p=>p.profileId),
    '17_challengersRegressingBaselineSafeMatch':r.challengerMatrix.filter(p=>p.baselineSafeMatchRegressionViewIds.length>0).map(p=>p.profileId),
    '18_challengersLosingRequiredTargetRecall':r.challengerMatrix.filter(p=>p.requiredTargetRecallRegression).map(p=>p.profileId),
    '19_finalV22Disposition':r.disposition,'20_currentDefault030005Retained':true,
    '21_retainedBaselineNotGlobalOptimum':true,'22_geometryChangedOrExecuted':false,
    '23_600120OnlyPossibleNextDesignQuestion':true,'24_ContinuousRerun':false,'25_capabilitiesChanged':false,
    '26_productionModified':false,'27_GitHubCIPass':'Actual final result-commit statuses/workflows are recorded separately in remote-result-proof.json; local PASS is never CI.'};
  await save(OUT+'/assessment.json',{phase:r.phase,createdAt:now(),classification:r.classification,
    startingRemoteHead:START,completeCommitChainAtAssessment:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    historicalStatements:r.historicalStatements,historicalV21Disposition:r.historicalV21Disposition,
    freezeCommit:r.proof.freezeCommit,freezeSha256:r.proof.freezeSha256,remoteFreezeVerifiedAt:r.proof.remoteVerifiedAt,
    reevaluationStartedAt:r.startedAt,prospectiveRemoteFreezeProven:r.proof.remoteVerifiedAt<r.startedAt,
    sourceIdentities:r.sourceIdentities,answers,preciseConclusion,control:r.control,
    distinctChallengerProductMetricVectors:r.distinctChallengerProductMetricVectors,challengerMatrix:r.challengerMatrix,
    selection:r.selection,execution,realEvidenceArithmeticEvaluations:r.realEvidenceArithmeticEvaluations,
    negativeZeroRepresentationLocations:r.negativeZeroRepresentationLocations,semanticMismatches:r.semanticMismatches,
    exactStructuralChecks:r.exactStructuralChecks,productionDiff:[],V3ThroughV21Diff:[],currentDefaults:r.currentDefaults,
    geometryRecommendationDesignOnly:r.nextGeometryQuestionDesignOnly,ContinuousConclusion:'NO_NEW_CONTINUOUS_THRESHOLD_CONCLUSION',
    sharedRobustModelStrategyUnchanged:true,ContinuousOwnership:'MATCHED_WRONG_EXTRA_UNCHANGED',
    V16SourceSensitiveInterpretation:'CARRIED_FORWARD_NOT_EXPANDED',promotion:r.promotion,capabilities:r.capabilities,
    globalOptimumClaimed:false,qualificationStarted:false,disposition:r.disposition,nextAllowedPhase:r.nextAllowedPhase});
  const lines=['# V22 Evidence-Only Signed-Zero Closure','',r.disposition,'',
    'V21_NOT_RESUMED. V22_IS_NEW_ADDITIVE_EVIDENCE_REEVALUATION. V21 remains permanently ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED.','',
    preciseConclusion,'',
    `Independent verification: ${r.comparedProfiles} profiles; ${r.challengers} non-control challengers; ${r.exactStructuralChecks} exact structural checks; no remaining semantic mismatch.`,
    'Only numeric signed zero was canonicalized. No epsilon, rounding, coercion, field omission or array reordering was allowed. No V21 executable module or acoustic/product pipeline was imported.','',
    `Control target views: ${r.control.views.intendedGestureTargetViews}. Classifications: ${JSON.stringify(r.control.views.classifications)}.`,
    `Required pitch recall ${r.control.views.requiredTargetPitchRecall.numerator}/${r.control.views.requiredTargetPitchRecall.denominator}; complete required targets ${r.control.views.allRequiredTargetsPresent.numerator}/${r.control.views.allRequiredTargetsPresent.denominator}; unsupported target coverage ${r.control.views.unsupportedTargetHallucination.numerator}/${r.control.views.unsupportedTargetHallucination.denominator}.`,'',
    '| Challenger | Eligible | Meaningful | Recovered views | Paired gestures | Recordings | New hallucinations | Safe regressions | Recall regression | Dangerous MATCH | Reasons |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |',
    ...r.challengerMatrix.map(p=>`| ${p.profileId} | ${p.eligible} | ${p.meaningful} | ${p.newlyRecoveredSafeTargetViews} | ${p.pairedRecoveredPhysicalGestures} | ${p.recoveredRecordingIds.length} | ${p.newUnsupportedHallucinationViewIds.length} | ${p.baselineSafeMatchRegressionViewIds.length} | ${p.requiredTargetRecallRegression} | ${p.dangerousAutomaticMatchCount} | ${p.rejectionReasons.join(', ')} |`),'',
    'The complete matrix, target-view membership/multiplicity, per-rate summaries, hashes and distinct product-metric vectors are retained as JSON. Denominators are candidate independent. Rates and counterfactual rows are correlated, not independent recordings or population estimates.','',
    'Current .30/.05 remains a retained engineering baseline, not a global/scientific optimum. Nothing here shows thresholds can never help on other data, nor that Robust has no acoustic problem. Raw acoustic counts remain diagnostics, not the selection objective.','',
    'Geometry 600/170 versus 600/120 is only a possible later design question. No alternate geometry was executed or simulated. Continuous was not rerun; no Continuous threshold conclusion follows from this STEP evidence. Broad Continuous regression and fresh microphone qualification remain required before any shared-default promotion.','',
    'Production and V3-V21 remain unchanged. Every V22 neural/session/Worker/PCM/resampling/decoder/H50/runtime/verdict/Continuous/fresh-holdout/warmup/unknown counter is zero. The verifier read existing serialized verdicts; it did not create new product results. Capabilities remain closed.','',
    'Local verification is not CI. See preflight-tests.json, local-verification.json and the actual GitHub receipt in remote-result-proof.json.','',
    'STOP. Independent audit only.'];
  await writeFile(path.join(ROOT,OUT,'assessment.md'),lines.join('\n')+'\n',{flag:'wx'});
  console.log(JSON.stringify({disposition:r.disposition,counts:r.counts,execution}));
}

export async function receipt() {
  await verify(); const head=await remote(), files=await scope(), identities=[];
  for(const p of files) {
    const b=await bytes(p), committed=execFileSync('git',['show',head+':'+p],{cwd:ROOT,maxBuffer:64*1024*1024});
    assert.equal(hash(b),hash(committed),'COMMITTED_RESULT_BYTES:'+p); identities.push({path:p,sha256:hash(b)});
  }
  const github=JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",head],
    {cwd:ROOT,encoding:'utf8',maxBuffer:8*1024*1024}));
  const result=await json(OUT+'/reevaluation-results.json');
  await save(OUT+'/remote-result-proof.json',{phase:result.phase,startingRemoteHead:START,resultCommit:head,endingRemoteHeadAtResultSeal:head,
    remoteVerifiedAt:now(),completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    exactChangedFiles:files,resultIdentities:identities,allResultBytesMatchRemoteCommit:true,productionDiff:[],V3ThroughV21Diff:[],
    V21StudyResultSha256:hash(await bytes(V21+'/study-results.json')),V21HistoricalDisposition:'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED',
    execution,reevaluationExecutions:1,github,cleanWorktreeAtVerification:true,disposition:result.disposition,
    receiptCommitNote:'This additive receipt is committed afterwards; the final receipt commit is independently fetched and verified, without a self-referential hash.'});
  console.log(JSON.stringify({head,github,disposition:result.disposition}));
}
