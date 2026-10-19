import assert from 'node:assert/strict';
import { OUT, V21, START, json, bytes, save, hash, now, execution, git } from './io.mjs';
import { verify } from './evidence.mjs';
import { normalizeSignedZero, equalEvidence, identityJSON } from './numeric.mjs';
import { verifyRows, physicalIdentity, groupViews, recompute, acousticStatistics, selection } from './recompute.mjs';

export async function evaluate() {
  const freeze=await verify(), proof=await json(OUT+'/remote-freeze-proof.json'), startedAt=now();
  assert.equal(proof.freezeCommit,proof.remoteHead);
  assert.equal(proof.freezeSha256,hash(await bytes(OUT+'/protocol-freeze.json')));
  assert.ok(proof.remoteVerifiedAt<startedAt);
  for(const f of freeze.immutableEvidence) assert.equal(hash(await bytes(f.path)),f.sha256,'EVIDENCE_IDENTITY:'+f.path);
  await save(OUT+'/reevaluation-started.json',{startedAt,proof,realEvaluationOrdinal:1,execution,V21_NOT_RESUMED:true});
  const verifiedProfiles=[], mismatchEvidence=[]; let arithmeticChecks=0;
  const check=(a,b,label)=>{
    try { equalEvidence(a,b,label); arithmeticChecks++; }
    catch(error) { mismatchEvidence.push({label,recomputed:normalizeSignedZero(a),stored:normalizeSignedZero(b)}); throw error; }
  };
  try {
    const identities=await json(OUT+'/evidence-identities.json'), previous=await json(V21+'/study-results.json');
    const profiles=identities.profiles, definitions=freeze.definitions;
    const parsed=[];
    for(const p of profiles) {
      const artifact=identities.stageBArtifacts.find(f=>f.path.endsWith('/'+p.profileId+'.json'));
      const data=await json(artifact.path); check(data.profile,p,p.profileId+':frozenProfileIdentity');
      parsed.push({profile:p,path:artifact.path,stored:data,rows:verifyRows(data.rows,check)});
    }
    const control=parsed.find(p=>p.profile.profileId===definitions.control); assert.ok(control);
    const metrics=[], artifacts=[], rawZeroLocations=[];
    let serializedVerdictRecordsRead=0;
    for(const candidate of parsed) {
      const profile=candidate.profile, id=profile.profileId;
      const result=recompute(candidate.rows,control.rows,profile);
      const a=await json(identities.stageAArtifacts.find(f=>f.profileId===id).path);
      check(a.profile,profile,id+':blindProfileIdentity');
      result.acousticDiagnostics=acousticStatistics(a.jobs);
      check(result,candidate.stored.result,id+':allStageBResultFields');
      // V21's study summary schema excludes targetViews, which were already compared in full above.
      const summary=Object.fromEntries(Object.entries(result).filter(([key])=>key!=='targetViews'));
      summary.targetViewArtifact=candidate.path;
      check(summary,previous.profiles.find(p=>p.profileId===id),id+':allStoredStudySummaryFields');
      for(const [component,value] of result.rankingComponents.entries()) if(Object.is(value,-0)) rawZeroLocations.push({profileId:id,component});
      serializedVerdictRecordsRead+=candidate.rows.filter(r=>r.productRecord!==null).length;
      const audit={profile,sourceArtifact:candidate.path,independentResultSummary:normalizeSignedZero(summary),
        targetViews:result.targetViews.map(v=>({viewId:v.viewId,physicalUnitId:v.physicalUnitId,physicalGestureKey:v.physicalGestureKey,
          rowIds:v.rowIds,multiplicity:v.multiplicity,expected:v.expected,physicalTruth:v.physicalTruth,
          acousticObserved:v.acousticObserved,physicalTargetSupported:v.physicalTargetSupported,
          serializedVerdict:v.productRecord?.verdict??null,classification:v.classification})),
        fullStageBResultExactAfterZeroOnlyNormalization:true,
        recomputedSemanticSha256:hash(identityJSON(normalizeSignedZero(result))),
        storedSemanticSha256:hash(identityJSON(normalizeSignedZero(candidate.stored.result))),execution};
      const path=OUT+'/profiles/'+id+'.json'; await save(path,audit);
      artifacts.push({profileId:id,path,sha256:hash(await bytes(path))});
      metrics.push(result); verifiedProfiles.push(id);
    }
    const controlMetric=metrics.find(p=>p.profileId===definitions.control);
    const denominator={counterfactualRowsPerProfile:control.rows.length,targetViewsPerProfile:groupViews(control.rows).length,
      physicalRateUnits:new Set(control.rows.map(r=>physicalIdentity(r))).size,
      physicalGesturesIgnoringRate:new Set(control.rows.map(r=>physicalIdentity(r,false))).size,
      ratesCorrelatedNotIndependentRecordings:true,populationEstimate:'NOT_GENERALIZABLE_PRODUCT_RATE'};
    check(denominator,previous.denominators,'fixedDenominators');
    const stageASeal=await json(V21+'/stage-a-seal.json');
    const historicalReceipt={neuralRuns:0,modelSessionLoads:0,acousticWorkerConstructions:0,pcmDecodeRuns:0,resamplingRuns:0,
      freshHoldoutAccess:0,modelWarmupRuns:0,unknownNeuralExecutions:0,decoderBRuns:0,decoderCRuns:0,ContinuousAcousticReruns:0,
      stageADecoderCalls:stageASeal.decoderCalls,StageBDecoderCalls:0,productVerdictRuns:serializedVerdictRecordsRead,
      evidenceOnly:parsed.every(p=>p.rows.every(r=>!r.productRecord||r.submittedEvidence.kind==='EVIDENCE')),
      externalP2Executions:0,profiles:parsed.length};
    check(historicalReceipt,previous.receipt,'historicalExecutionReceipt_TheseAreNotV22Executions');
    const challengers=metrics.filter(p=>p.profileId!==definitions.control);
    assert.equal(challengers.length,profiles.length-1);
    const ranked=selection(challengers), normalizedSelection=selection(normalizeSignedZero(challengers));
    check(ranked,normalizedSelection,'rankingAndTiesInvariantUnderZeroNormalization');
    check(ranked,previous.selection,'completeFrozenSelection');
    check(ranked.selected?profiles.find(p=>p.profileId===ranked.selected):null,previous.nominatedCandidate,'nominatedCandidate');
    check(ranked.disposition,previous.disposition,'rawGeneratedV21Disposition_notHistoricalV21Assessment');
    const disposition=ranked.leaders.length===0?'ROBUST_V22_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED'
      :ranked.leaders.length===1?'ROBUST_V22_THRESHOLD_DEVELOPMENT_CHALLENGER_REESTABLISHED_FROM_IMMUTABLE_V21_EVIDENCE'
      :'ROBUST_V22_MULTIPLE_EQUIVALENT_THRESHOLD_CHALLENGERS_NO_UNIQUE_SELECTION';
    const matrix=challengers.map(p=>({profileId:p.profileId,eligible:p.eligibility==='ELIGIBLE',meaningful:p.meaningful,
      rejectionReasons:p.reasons,newlyRecoveredSafeTargetViews:p.newlyRecoveredSafeTargetViewIds.length,
      recoveredDistinctPhysicalGestures:p.recoveredDistinctPhysicalGestures,
      pairedRecoveredPhysicalGestures:p.pairedRecoveredPhysicalGestures.length,
      recoveredRecordingIds:Array.from(new Set(p.targetViews.filter(v=>p.newlyRecoveredSafeTargetViewIds.includes(v.viewId)).map(v=>v.recordingId))).sort(),
      pairedRecoveredRecordingIds:p.pairedRecoveredRecordingIds,
      newUnsupportedHallucinationViewIds:p.newUnsupportedCoveredViewIds,baselineSafeMatchRegressionViewIds:p.baselineSafeMatchRegressions,
      requiredTargetRecallRegression:p.reasons.includes('REQUIRED_TARGET_RECALL_REGRESSION'),
      dangerousAutomaticMatchCount:p.views.classifications.DANGEROUS_FALSE_MATCH,rankingComponents:normalizeSignedZero(p.rankingComponents)}));
    const vectorGroups=new Map();
    for(const p of challengers) {
      const vector={classifications:p.views.classifications,requiredTargetPitchRecall:p.views.requiredTargetPitchRecall,
        allRequiredTargetsPresent:p.views.allRequiredTargetsPresent,unsupportedTargetHallucination:p.views.unsupportedTargetHallucination,
        safeAutoMatchCoverage:p.views.safeAutoMatchCoverage,supportedAmbiguityRetryRate:p.views.supportedAmbiguityRetryRate};
      const key=identityJSON(vector);
      if(!vectorGroups.has(key)) vectorGroups.set(key,{vector,profileIds:[]});
      vectorGroups.get(key).profileIds.push(p.profileId);
    }
    await verify();
    const result={phase:definitions.phase,classification:definitions.classification,startedAt,completedAt:now(),
      historicalStatements:definitions.historicalStatements,historicalV21Disposition:definitions.historicalV21Disposition,
      startingRemoteHead:START,completeCommitChainAtEvaluation:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
      proof,normalization:definitions.normalization,normalizationRule:definitions.normalizationRule,
      sourceIdentities:{V21Protocol:identities.protocolFreezeSha256,V21StageAOutputCorpus:identities.stageAOutputCorpusSha256,
        V21RawStudyResult:identities.rawGeneratedStudyResultsSha256,V20RawCanonicalCorpus:identities.V20CanonicalCorpusSha256},
      comparedProfiles:metrics.length,challengers:challengers.length,artifacts,exactStructuralChecks:arithmeticChecks,
      independentSemanticParity:true,semanticMismatches:mismatchEvidence,negativeZeroRepresentationLocations:rawZeroLocations,
      comparisonCoverage:['all Stage-B result fields including full targetViews','all study profile summary fields','fixed denominators',
        'historical execution receipt (read only, not new execution)','selection order/leaders/nomination/raw generated disposition'],
      normalizationDoesNotReorderArraysOmitFieldsOrCoerceValues:true,
      denominators:denominator,control:{profileId:definitions.control,rows:controlMetric.rows,views:controlMetric.views,
        byRate:controlMetric.byRate,rankingComponents:normalizeSignedZero(controlMetric.rankingComponents)},
      challengerMatrix:matrix,distinctChallengerProductMetricVectors:Array.from(vectorGroups.values()),
      productMetricVectorDefinition:'All view classifications and product rates, excludes engineering grid distance; per-profile ranking vectors remain in matrix',
      counts:{eligible:matrix.filter(p=>p.eligible).length,meaningful:matrix.filter(p=>p.meaningful).length,
        anySafeRecovery:matrix.filter(p=>p.newlyRecoveredSafeTargetViews>0).length,
        newHallucination:matrix.filter(p=>p.newUnsupportedHallucinationViewIds.length>0).length,
        baselineSafeMatchRegression:matrix.filter(p=>p.baselineSafeMatchRegressionViewIds.length>0).length,
        recallRegression:matrix.filter(p=>p.requiredTargetRecallRegression).length},
      selection:normalizeSignedZero(ranked),selectedReadout:ranked.selected?profiles.find(p=>p.profileId===ranked.selected):null,
      serializedVerdictRecordsRead,realEvidenceArithmeticEvaluations:1,execution,
      productionDiff:[],V3ThroughV21Diff:[],currentDefaults:definitions.productionDefaults,
      baselineInterpretation:ranked.selected?'EXPOSED_DEVELOPMENT_ONLY_NOT_PRODUCTION_PROMOTION'
        :'CURRENT_030_005_BASELINE_RETAINED_NO_EXPOSED_THRESHOLD_EVIDENCE_FOR_CHANGE',
      globalOptimumClaimed:false,geometryExecuted:false,ContinuousRerun:false,freshHoldoutTouched:false,
      nextGeometryQuestionDesignOnly:definitions.geometryNextQuestionOnly,promotion:definitions.promotion,
      capabilities:definitions.capabilities,disposition,nextAllowedPhase:'STOP_WAIT_FOR_INDEPENDENT_AUDIT_NO_AUTOMATIC_EXECUTION'};
    await save(OUT+'/reevaluation-results.json',result);
    await save(OUT+'/challenger-matrix.json',{phase:definitions.phase,controlExcluded:definitions.control,matrix,selection:result.selection,
      disposition,interpretation:'EXPOSED_STEP_PRODUCT_POLICY_EVIDENCE_ONLY_NOT_CONTINUOUS_OR_MICROPHONE_QUALIFICATION'});
    await save(OUT+'/reevaluation-complete.json',{completedAt:now(),executions:1,profiles:metrics.length,execution,disposition});
    console.log(JSON.stringify({disposition,counts:result.counts,control:result.control.views,checks:arithmeticChecks,execution}));
  } catch(error) {
    await save(OUT+'/reevaluation-failure.json',{failedAt:now(),failure:String(error.stack??error),cause:String(error.cause?.stack??''),
      verifiedProfiles,mismatchEvidence,arithmeticChecks,execution,
      mismatchClassification:error.semanticMismatch?'ROBUST_V22_V21_SEMANTIC_RECOMPUTATION_MISMATCH':'ROBUST_V22_EVIDENCE_INTEGRITY_BLOCKED',
      disposition:'ROBUST_V22_EVIDENCE_INTEGRITY_BLOCKED',rerunAllowed:false});
    throw error;
  }
}
