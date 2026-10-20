import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ROOT,OUT,DIR,START,bytes,load,save,hash,git,now } from './io.mjs';
import { verify,scope,remote } from './control.mjs';

const optional=async p=>load(p).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
export async function report(){
  const freeze=await optional(OUT+'/capture-protocol-freeze.json');if(freeze)await verify();else await scope();
  const r=await optional(OUT+'/geometry-results.json'),c=await load(DIR+'/contract.json');
  const failures=[];
  for(const name of ['control-failure.json','tests-failure.json','stage-b-failure.json']){
    const f=await optional(OUT+'/'+name);if(f)failures.push({path:OUT+'/'+name,...f});
  }
  const raw=await optional(OUT+'/tensor-corpus-manifest.json');if(raw?.failure)failures.push({phase:'StageA',failure:raw.failure,receipt:raw.receipt});
  const disposition=failures.length||!r?'ROBUST_V23_GEOMETRY_STUDY_INTEGRITY_BLOCKED':r.disposition;
  const a=raw?.receipt??{modelSessionLoads:0,attemptedSessionRuns:0,successfulSessionRuns:0,failedSessionRuns:0,hiddenWarmupRuns:0,
    rawTensorPairs:0,rawCanonicalBytes:0,decoderRuns:0,truthAccessCount:0,productVerdictRuns:0,unknownRuns:0};
  const answers={
    '01_V22Immutable':true,'02_V21StillHistoricallyIntegrityBlocked':true,'03_candidateGeometryExecutions':a.modelSessionLoads?1:0,
    '04_baselineNeuralRerun':false,'05_candidateAttemptedModelRuns':a.attemptedSessionRuns,'06_candidateModelSessions':a.modelSessionLoads,
    '07_hiddenWarmups':a.hiddenWarmupRuns,'08_candidateInputSamples':29120,'09_fullSlotPastMs':1100,'10_nominalFutureMs':120,
    '11_ownedWidthMs':600,'12_allContextRealNoPadding':true,'13_StageABlind':a.truthAccessCount===0,
    '14_rawRemoteSealBeforeDecoder':r?.rawSealPrecedesDecoder??false,'15_candidateDecoderACalls':r?.stageB.decoderARuns??0,
    '16_alternativeThresholdsAndDecoders':r?.stageB.alternativeThresholdDecoderRuns??0,
    '17_fixedDenominators':r?{rows:r.rows.length,targetViews:r.result.targetViews.length}:{status:'NOT_EXECUTED'},
    '18_actualSchema6RuntimeOwnsVerdicts':r?true:'NOT_EXECUTED',
    '19_candidateClassifications':r?.result.views.classifications??null,'20_dangerousAutomaticMatches':r?.result.views.classifications.DANGEROUS_FALSE_MATCH??null,
    '21_newUnsupportedHallucinationIdentities':r?.result.newUnsupportedCoveredViewIds??null,
    '22_requiredTargetRecallPreserved':r?!r.regressionReasons.includes('REQUIRED_TARGET_RECALL_REGRESSION'):null,
    '23_baselineSafeMatchRegressions':r?.result.baselineSafeMatchRegressions??null,
    '24_recoveredSupportedRetryViews':r?.recoveredTargetViewIds??null,'25_recoveredPhysicalGestures':r?.recoveredDistinctGestures??null,
    '26_recoveredRecordingIds':r?.recoveredRecordingIds??null,'27_bothRateQualifyingRecoveries':r?.pairedRecoveries??null,
    '28_meaningfulSTEPUsabilityImprovement':r?.meaningfulUsabilityImprovement??null,
    '29_exactSTEPProductParity':r?.exactStepProductParity??null,'29_optionalParityLabel':r?.optionalParityLabel??null,
    '30_physicalUXLatencyClaimed':false,'31_ContinuousExecuted':false,'32_productionChanged':false,
    '33_defaultGeometryRemains6001050170':true,'34_capabilitiesUnchanged':true,
    '35_GitHubCIPass':'Actual result-commit checks are recorded separately in remote-result-proof.json. Local tests are not CI.'};
  await save(OUT+'/assessment.json',{phase:c.phase,classification:c.classification,createdAt:now(),startingRemoteHead:START,
    completeCommitChainAtAssessment:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    freezeProof:await optional(OUT+'/remote-capture-permission.json'),rawSealProof:await optional(OUT+'/remote-raw-seal-proof.json'),
    candidate:c.candidate,baseline:c.baseline,answers,stageA:a,stageB:r?.stageB??null,failures,
    inputPreservation:OUT+'/input-preservation.json',rawManifest:raw?OUT+'/tensor-corpus-manifest.json':null,
    resultArtifact:r?OUT+'/geometry-results.json':null,productionDiff:[],V3ThroughV22Diff:[],
    defaults:{...c.baselineGeometry,onset:.30,frame:.05,modelSha256:c.modelSha256,inputSamples:29120,inputMs:1820,sampleRateHz:16000},
    sourceTimeQuantization:'Accepted planner round(ownedEnd+futureSamples); fractional final owned endpoints have at most half a target sample quantization, not a fitted offset',
    contextDelta:{futureContextMs:[170,120],deltaMs:-50,physicalUXLatencyMeasured:false},
    inferenceEngineeringDiagnostics:r?.inferenceEngineeringDiagnostics??null,baselineNeuralRuns:0,baselineProductRuntimeRuns:0,
    sharedModelStrategy:c.sharedModelStrategy,capabilities:c.capabilities,
    Continuous:'NOT_EXECUTED_NO_AUTOMATIC_BROAD_CONTINUOUS_RUN',promotion:c.promotion,
    historical:{V21:'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED',V22:'ROBUST_V22_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED'},
    disposition,nextAllowedPhase:'STOP_WAIT_FOR_INDEPENDENT_AUDIT'});
  const lines=['# V23 Single Geometry Development Screen','',disposition,'',
    'Exposed development only. No microphone qualification, scientific winner or production promotion. V3-V22 remain unchanged.','',
    'Candidate: '+c.candidate+'. Only context changes: owned600/past1100/future120, full 29120 real samples. Baseline 600/1050/170 neural and product execution were not rerun. Decoder A remains .30/.05.','',
    r?'Target-view classifications: '+JSON.stringify(r.result.views.classifications):'Execution blocked; see immutable failure evidence.',
    r?'Safe recovered target views: '+r.recoveredTargetViewIds.length+'; distinct gestures: '+r.recoveredDistinctGestures+'; recordings: '+r.recoveredRecordingIds.length+'; both-rate paired gestures: '+r.pairedRecoveries.length+'.':'',
    r?'Regression reasons: '+JSON.stringify(r.regressionReasons)+'. Meaningful improvement: '+r.meaningfulUsabilityImprovement+'.':'',
    r?'Optional product parity label: '+(r.optionalParityLabel??'NOT_ESTABLISHED')+'. This does not override the primary disposition.':'','',
    'Full source coordinate mapping and owned intervals are preserved. Partial windows retain all 1820ms real input. Fractional final owned endpoints use the pre-existing nearest-target-sample rule, not a fitted alignment. No zero-padding or shortened model input.','',
    'Fixed evidence: 34 counterfactual rows / 26 target views / 18 rate-specific physical units / 9 rate-ignored gestures. Rates and repeated counterfactuals are correlated, not independent recordings.','',
    'Stage A has one capture owner/session and is raw-only; ORT subordinate infrastructure is classified separately. Raw corpus is remotely sealed before decoder access. Stage B uses actual production decoder/sourcePublication and schema6 StepPracticeRuntime, EVIDENCE only, accepted target-independent H50 and explicit rearm. No external P2 verdict owner.','',
    'Future context 170 -> 120ms is a deterministic -50ms context requirement, NOT a measured physical-device/UX latency gain. Inference timing is engineering-only. No Continuous run or default promotion occurs.','',
    'Current shared defaults remain Robust / 16k mono / 29120 / 1820ms / decoder A .30/.05 / 600/1050/170. Runtime v6, policy/rearm and capabilities remain unchanged. No fixed microphone cooldown was selected.','',
    'All 35 answers are in assessment.json. Local tests are not CI; actual GitHub status/workflows are in remote-result-proof.json.','',
    'STOP. Independent audit only.'];
  await writeFile(path.join(ROOT,OUT,'assessment.md'),lines.join('\n')+'\n',{flag:'wx'});
  console.log(JSON.stringify({disposition,stageA:a,stageB:r?.stageB??null}));
}
export async function receipt(){
  if(await optional(OUT+'/capture-protocol-freeze.json'))await verify();else await scope();
  const head=await remote(),files=await scope(),identities=[];
  for(const p of files){const b=await bytes(p),remoteBytes=execFileSync('git',['show',head+':'+p],{cwd:ROOT,maxBuffer:64*1024*1024});
    if(hash(b)!==hash(remoteBytes))throw Error('REMOTE_RESULT_BYTES:'+p);identities.push({path:p,sha256:hash(b)});}
  const github=JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",head],{cwd:ROOT,encoding:'utf8'}));
  await save(OUT+'/remote-result-proof.json',{startingRemoteHead:START,resultCommit:head,endingRemoteHeadAtResultSeal:head,remoteVerifiedAt:now(),
    completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),exactChangedFiles:files,identities,
    productionDiff:[],V3ThroughV22Diff:[],allResultBytesMatchRemoteCommit:true,github,cleanWorktreeAtVerification:true,
    disposition:(await load(OUT+'/assessment.json')).disposition,
    receiptCommitNote:'This additive receipt is committed afterwards; final receipt HEAD is independently fetched and verified without self-reference.'});
  console.log(JSON.stringify({head,github}));
}
