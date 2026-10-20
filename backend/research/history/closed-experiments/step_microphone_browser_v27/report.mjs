import { OUT,START,load,save,now } from './io.mjs';
import { verify } from './control.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './io.mjs';

const f=await verify(),r=await load(OUT+'/browser-campaign.json');
const cells=r.cells.map(c=>{
  const t=c.result,n=t?.finalCounts??t?.counts;
  return {id:c.id,status:c.status,rate:c.rate,environmentValidated:c.environmentValidated??false,counts:n??null,
    accounting:c.executionAccounting??null,GPU:c.GPU??null,modelReceipt:t?.modelReceipt??null,
    captured:t?.afterInputCleanup?.input?.capture??null,analysis:t?.afterInputCleanup?.input?.analysis??null,
    assembler:t?.afterInputCleanup?.input?.assembler??null,sourceChronology:c.captureChronology??null,
    gates:c.independentGates??null,diagnostics:c.engineeringDiagnostics??null,
    attempts:t?.attempts?.map(a=>({identity:a.identity,observed:a.evidence.observedAttackPitches,evidenceKind:a.evidence.kind,
      confidence:a.evidence.confidence,captureEnd:a.evidence.captureEndSessionTime,expected:a.expected,verdict:a.record.verdict,
      retryReason:a.record.retryReason,postVerdictPhase:a.after.step.attemptState,generationBefore:a.before.step.targetGeneration,generationAfter:a.after.step.targetGeneration}))??[],
    boundaries:t?.boundaries?.map(b=>({initial:b.initial,boundary:b.boundary,physical:b.before.input.capture.capturedThroughSourceSample,
      processed:b.before.input.assembler.processedThroughSourceSample,sourceRuntimeNext:b.before.input.analysis.nextSourceSampleIndex,
      contextTime:b.before.contextTime,beforeIndex:b.before.domain.step.currentIndex,afterIndex:b.after.domain.step.currentIndex,
      beforeGeneration:b.before.domain.step.targetGeneration,afterGeneration:b.after.domain.step.targetGeneration,sameStack:b.sameSynchronousCallStack}))??[],
    repeatedIdenticalTargetTransitions:t?.attempts?.flatMap((a,i,all)=>{
      if(i===0)return[];const p=all[i-1];
      return p.record.verdict==='MATCH'&&a.identity.targetGeneration===p.identity.targetGeneration+1&&JSON.stringify(a.expected)===JSON.stringify(p.expected)
        ?[{prior:p.identity,next:a.identity,distinctSourceTimes:p.identity.attemptStartSessionTime.sampleIndex<a.identity.attemptStartSessionTime.sampleIndex}]:[];
    })??[],
    sameTargetAttemptDiagnostic:t?.sameTargetAcceptance??'SECOND_IDENTICAL_TARGET_ACCEPTANCE_NOT_EXERCISED',
    infrastructure:t?.infrastructure??null,applicationFailures:t?.applicationFailures??null,inputFailures:t?.failures??null,
    rootStop:t?.rootImmediatelyAfterStop??null,afterInfrastructureLoss:t?.afterInfrastructureLoss??null,
    teardown:t?.teardown??null,error:c.error??t?.error??null,failureClassification:c.failureClassification??null};
});
const totals={ChromeLaunches:r.chromeLaunches,ChromeLaunchAttempts:r.chromeLaunchAttempts,browserContexts:r.browserContexts,
  AudioContexts:0,rootStreams:0,analysisClones:0,productWorkers:0,modelLoadAttempts:0,modelLoadsSucceeded:0,modelSessionsObserved:0,
  neuralRunRequests:0,successfulInferenceResponses:0,failedInferenceResponses:0,actualSessionRunsWithReceipts:0,decoderRunsWithReceipts:0,
  unacknowledgedModelRequests:0,publications:0,attempts:0,retirementBoundaries:0,workerDisposals:0,sourceDisposals:0,
  captureStopTransitions:0,infrastructureFailures:0,hiddenWarmups:0,unknownExecutions:0};
for(const c of cells){const a=c.accounting,n=c.counts;if(a){for(const key of Object.keys(a))if(key in totals)totals[key]+=a[key];}
  else if(n){totals.AudioContexts+=n.context;totals.rootStreams+=n.rootStreams;totals.analysisClones+=n.analysisClones;
    totals.productWorkers+=n.workerOwners;totals.modelLoadAttempts+=n.loadAttempts;totals.modelLoadsSucceeded+=n.loadSuccesses;
    totals.unknownExecutions+=Math.max(0,n.loadAttempts-n.loadSuccesses)+Math.max(0,n.runAttempts-n.runSuccesses);}}
const evaluated=cells.filter(c=>c.counts),normal=cells.filter(c=>c.id.startsWith('normal'));
const teardownOf=c=>c.teardown?.find(t=>t.kind==='INPUT_DISPOSE');
const result={phase:f.phase,recordedAt:now(),startingRemoteHead:START,disposition:r.disposition,
  authorization:f.contract.authorization,V26NotResumed:true,V26Disposition:f.contract.V26HistoricalDisposition,
  symbol:f.contract.symbol,bundlesRebuilt:0,immutableInputs:f.immutableCandidate.artifacts,virtualInputRecords:f.immutableCandidate.virtualInputs,
  buildSemantics:f.immutableCandidate.semantics,freezeProof:r.proof,browserLaunchAt:r.browserLaunchAt,
  remoteProofPrecededLaunch:r.remoteProofPrecededLaunch,browser:r.browser,GPU:r.GPU,cells,totals,
  answers:{
    '01_V26CompletelyImmutable':true,'02_V26NotResumed':true,'03_exactBundleWAVHashesReused':true,'04_bundlesRebuilt':false,
    '05_inputRepresentation':'FILESYSTEM_INPUT has exact real bytes/SHA and original metafile name; ESBUILD_VIRTUAL_INPUT has exact identifier, bundle membership and build-semantic provenance only',
    '06_virtualNodeReadAsFile':false,'07_unexpectedVirtualInputs':[],
    '08_newV27FreezeCreated':true,'09_remoteFreezeBeforeLaunch':r.remoteProofPrecededLaunch,
    '10_actualBrowserVersion':r.browser??'NOT_EXECUTED','11_actualGPU':r.GPU??'NOT_OBSERVED',
    '12_hardwareWebGPU':cells.some(c=>c.environmentValidated),
    '13_actualContextRates':evaluated.map(c=>({id:c.id,rate:c.captured?.sourceSampleRateHz??null,state:c.status})),
    '14_productionCaptureUsed':evaluated.some(c=>c.counts.captureConnections>0),
    '15_productionWorkerUsed':evaluated.some(c=>c.counts.workerOwners>0),
    '16_workersPerCell':evaluated.map(c=>({id:c.id,count:c.counts.workerOwners})),
    '17_modelOwnersPerCell':evaluated.map(c=>({id:c.id,attempts:c.counts.loadAttempts,loads:c.counts.loadSuccesses,sessionsObserved:c.modelReceipt?.actualSessionLoadCount??null})),
    '18_neuralAccounting':totals,'19_regionsPerCell':evaluated.map(c=>({id:c.id,regions:c.analysis?.counts.regionsStarted??null})),
    '20_chronology':cells.map(c=>({id:c.id,evidence:c.sourceChronology,status:c.status})),
    '21_fixedOrigin':cells.map(c=>({id:c.id,origin:c.captured?.audioContextOriginFrame??null})),
    '22_physicalRetirementEvidence':cells.map(c=>({id:c.id,boundaries:c.boundaries})),
    '23_processedUsedForRetirement':false,'24_fixedCooldownIntroduced':false,
    '25_ordinaryEvidenceReachedRuntime':cells.some(c=>c.attempts.some(a=>a.evidenceKind==='EVIDENCE')),
    '26_verdictOwner':'Actual schema6 StepPracticeRuntime; immutable harness assertions occur only after finalized ordinary EVIDENCE',
    '27_observationReuse':cells.map(c=>({id:c.id,validated:c.gates?.observationReuse??'NOT_EVALUATED'})),
    '28_normalRootPreserved':normal.map(c=>({id:c.id,root:teardownOf(c)?.root??null,status:c.status})),
    '29_normalBorrowedContext':normal.map(c=>({id:c.id,state:teardownOf(c)?.contextState??null,status:c.status})),
    '30_actualRootStopLoss':cells.filter(c=>c.id.startsWith('root-loss')).map(c=>({id:c.id,stopped:c.rootStop,watcher:c.infrastructure,classification:c.failureClassification,status:c.status})),
    '31_actualContextInterruption':cells.filter(c=>c.id.startsWith('context-loss')).map(c=>({id:c.id,watcher:c.infrastructure,inputFailures:c.inputFailures,status:c.status})),
    '32_syntheticInfrastructureEvents':false,'33_productionBackendDeliveryExercised':false,'34_freshHoldoutAccessed':false,
    '35_physicalMicrophoneQualified':false,'36_recognitionQualified':false,'37_controllerHookCapabilityModified':false,
    '38_capabilitiesClosed':true,'39_productionModified':false,'40_githubCI':'Local results are not CI; actual final status/workflows queried at Git closure'},
  defaults:f.campaignContract.currentDefaults,baselineClassification:f.campaignContract.baselineClassification,
  capabilities:f.contract.capabilities,physicalDevice:'REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED',
  permissionUXQualified:false,productionAssetDeliveryQualified:false,recognitionQualified:false,
  fixedCooldownSelected:false,freshHoldoutAccess:0,thresholdOrGeometryStudy:false,productionDiff:[],V3ThroughV26Diff:[],
  historicalRawFilesVerified:f.historyFiles,localTests:await load(OUT+'/local-verification.json'),
  failure:r.failure,causalFailure:r.causalFailure,nextAllowedPhase:f.contract.nextAllowedPhase};
await save('assessment.json',result);
await writeFile(path.join(ROOT,OUT,'assessment.md'),`# V27 Immutable Prepared Browser Graph\n\n${r.disposition}\n\n`+
  `V26 remains STEP_V26_BROWSER_EXECUTION_INTEGRITY_BLOCKED and was not resumed. Its exact prepared entry, Worker, WAV, metadata and contract were verified as a new immutable V27 input candidate. No bundle was rebuilt. The old runV26 global is historical symbol identity only.\n\n`+
  `The new manifest models filesystem inputs with real bytes/SHA and the sole <define:process.env> node with explicit semantic provenance. No filesystem read/fake byte SHA for that virtual node. New V27 freeze/proof precedes launch: ${r.remoteProofPrecededLaunch}.\n\n`+
  `Actual browser ${r.browser?.version??'NOT_EXECUTED'}, Playwright ${f.playwright.version}, headed; GPU ${JSON.stringify(r.GPU)}. Cells: ${cells.map(c=>c.id+'='+c.status).join(', ')}.\n\n`+
  `Execution totals: ${JSON.stringify(totals)}. Actual per-cell receipts/chronology/publications/EVIDENCE/domain records/retirement/teardown are retained in browser-campaign.json and assessment.json. NOT_EVALUATED or NOT_STARTED cells are not PASS.\n\n`+
  `Failure classification is causal: ${JSON.stringify(r.causalFailure)}. Resource construction alone is not a production defect. Missing real evidence is a separate coverage disposition; unsupported fake-media loss stimulus/unknown execution/tooling is integrity-blocking. No repair or cell retry.\n\n`+
  `Physical captured-through is the only retirement fact; acoustic processed frontier is not retirement. Blocked-publication stress is a test barrier, not a cooldown. Runtime v6 alone owns verdict/progression; desired recognition outcomes are diagnostic only. Same-target real acceptance is not inferred when absent.\n\n`+
  `CORE_GRAPH_ONLY_RESEARCH_MODEL_URL_OVERRIDE. Backend getPracticeAcousticModelAccess delivery is not exercised or qualified. REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED; fake-media flags bypass permission UX. No fresh recognition or physical latency qualification.\n\n`+
  `V3-V26 and production remain byte-identical. Shared Robust, decoder A .30/.05, 16k/29120/1820ms and 600/1050/170 remain current engineering defaults, not global optima. No model/threshold/geometry/cooldown change. Schema6 and controller/hook gating unchanged. STEP ATTEMPT_ANALYZER_NOT_VALIDATED; Continuous MODEL_NOT_VALIDATED; productionMicrophone=false; D4=false.\n\n`+
  `Local tests and local Chrome are not GitHub CI. Actual statuses/workflows are recorded at remote closure. All 40 requested answers are in assessment.json. STOP for independent audit.\n`,{flag:'wx'});
console.log(JSON.stringify({disposition:r.disposition,totals,cells:cells.map(c=>({id:c.id,status:c.status}))}));
