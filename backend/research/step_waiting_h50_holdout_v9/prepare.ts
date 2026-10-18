import {reconstruct,selectLateWindow} from './geometry';
import {load,save,raw,hash,OUT,WORK,V6,DIR} from './io';
const scenarios=await load(V6+'/scenario-manifest.json');
const cases=(await load(V6+'/audio-bound-cases.json')).cases;
const jobs=(await load('backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json')).jobs;
const mapping=await load(V6+'/input-preservation.json');
const geometries=[];
for(const job of jobs){
  const bytes=await raw('apps/customer-web/public/model-assets/practice-acoustic/'+(job.sourceRateHz===44100?'fir-160-441.f32':'fir-1-3.f32'));
  const a=await reconstruct(job,bytes,0),b=await reconstruct(job,bytes,0.125);
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error('GEOMETRY_DEPENDS_ON_SAMPLE_VALUE');
  geometries.push({...a,sampleValueIndependenceVerified:true});
}
const cells=[];
for(const scenario of scenarios.scenarios)for(const rate of [44100,48000]){
  const c=cases[scenario.family];
  const ms=mapping.results.filter((r:any)=>r.audioBoundCaseId===scenario.audioBoundCaseId&&r.sourceRateHz===rate);
  if(ms.length!==1||c.audioBoundCaseId!==scenario.audioBoundCaseId)throw Error('FROZEN_MAPPING_NOT_UNIQUE');
  const job=jobs.find((j:any)=>j.jobId===ms[0].jobId),g=geometries.find(g=>g.jobId===job.jobId)!;
  const physical=c.originalTruthCase.gestures;
  const armMs=scenario.schedule.kind==='pre_ready'?scenario.schedule.armOriginalSourceMs:scenario.inputEligibleAfterOriginalSourceMs;
  const arm=Math.max(armMs*rate/1000,g.firstCompleteOwnedIntervalAnalyzedAt);
  const last=physical.at(-1).onsetMs;
  const semanticEndMs=c.originalTruthCase.guard?.endMs??last+100;
  const late=scenario.scenarioId==='late_publication'?selectLateWindow(g.windows,physical[1].onsetMs*rate/1000,job.sourceOriginSample,rate):null;
  cells.push({scenarioId:scenario.scenarioId,family:scenario.family,audioBoundCaseId:scenario.audioBoundCaseId,jobId:job.jobId,sourceRateHz:rate,
    architectureOnly:scenario.scenarioId==='rearm_equality',prospectiveEmpiricalTrial:scenario.scenarioId!=='rearm_equality',
    inputEligibleAfterSourceSample:arm,semanticEndSourceSample:Math.ceil(semanticEndMs*rate/1000),
    scoringScope:'Frozen guard, otherwise first exclusive READY through last selected physical gesture + frozen 100ms attribution horizon; later publications may finish an already opened attempt, never open outside source-event scope.',
    latePublicationWindowIndex:late,publicationDelayMs:scenario.schedule.publicationDelayMs??0,analysisHoldMs:scenario.schedule.analysisHoldMs??0,
    physicalGestureIds:physical.map((p:any)=>p.gestureId),
    causalGate:scenario.scenarioId==='rearm_equality'?'ARCHITECTURE_ONLY_NO_EMPIRICAL_DENOMINATOR':
      c.originalTruthCase.guard?'ACTUAL_READY_THROUGH_WHOLE_NOTE_ON_FREE_GUARD':
      scenario.scenarioId==='pre_ready_ignored'?'PHYSICAL_GESTURE_BEFORE_ARM_AND_LATE_ELIGIBILITY_REJECTION':
      scenario.schedule.analysisHoldMs?'FIRST_GESTURE_READY_AND_SECOND_PHYSICALLY_BUSY_WITH_NO_QUEUE':
      physical.length>1?'EACH_SELECTED_PHYSICAL_GESTURE_ACTUALLY_READY_EXCLUSIVE':'PHYSICAL_GESTURE_ACTUALLY_READY_EXCLUSIVE'});
}
if(cells.length!==40||cells.filter(c=>c.prospectiveEmpiricalTrial).length!==38)throw Error('DENOMINATOR_MATRIX_DRIFT');
await save(OUT+'/stage-a-capture-watermark-reconstruction.json',{geometryOnly:true,selectedPcmRead:false,newNeuralRuns:0,
  algorithm:'Replay exact v7 through(start)/through(end)/through(sourceEnd) 2048 endpoints and await-drain barriers. Production QualifiedSourceAdapter output length + production planWindow only; no SourceAnalysisRuntime/inference.',
  sourceExecutionSha256:hash(await raw('backend/research/step_waiting_h50_holdout_v7/source-execution.ts')),
  geometrySampleValues:[0,0.125],geometries});
await save(OUT+'/counter-denominator-contract.json',{HMs:50,cells,scenarioCells:40,empiricalMaximum:38,equalityArchitectureWitnesses:2,
  safetyCounters:scenarios.safetyCounters,zeroOverZero:'NOT_EVALUABLE',
  truthAttribution:'nearest frozen physical onset within <=100ms; equal-distance ties NOT_EVALUABLE; target never consulted',
  crossScenarioIndependence:'Each counterfactual scenario-rate is a separate product session. One global map records original observationId -> scenario-rate session -> attempt owner; no reuse inside any session, cross-counterfactual reuse explicitly reported, not pooled into one live session.',
  lateSelector:'Unique half-open source-owned window containing frozen second physical gesture; source geometry only, never pitch/confidence.',
  holdClock:'1000ms source-capture progression; no alignment with offline performance.now. Delay only changes delivery capture progress, original availability retained.',
  eventOrder:'At same source coordinate: physical truth snapshot first (strict equality ineligible), captureThrough/expired analysis+reset, ARM, original publications ordered by frozen windowIndex, delayed publications ordered by original windowIndex. No perfect-oracle event sorting.',
  rearm:'Actual continuously progressed physical capture watermark at verdict/RESET, not analysis frontier.',
  sustain:'Require actual READY throughout declared guard; count only guard events; no physical note-on in frozen guard.',
  positiveSequences:{correct_single:['MATCH'],correct_chord:['MATCH'],post_ready_repeat:['MATCH','MATCH'],match_followed_by_next_target:['MATCH','MATCH'],
    multiple_wrong_then_correct:['MISMATCH','MISMATCH','MATCH'],partial_then_full:['MISMATCH','MATCH'],mismatch_same_target_rearm:['MISMATCH','MATCH']},
  ambiguity:'NOT_EVALUABLE and evaluation integrity blocked; no target-conditioned rematching',
  noAttempt:'Recognition absence is usability/functional failure, not fabricated safety denominator.',
  retryClassifier:'NOT_IMPLEMENTED_NO_RETRY_INVENTION',retryRate:'NOT_MEASURED',
  latency:'publicationAvailabilityMs is offline performance.now, cannot subtract physical source clock; source capture replay durations separately labelled; device/UX latency NOT_MEASURED',
  dispositionPriority:['EVALUATION_INTEGRITY_BLOCKED','SAFETY_BLOCKED','CAUSAL_DENOMINATOR_MISSING','FUNCTIONAL_RECOGNITION_BLOCKED','PASS'],
  actualValidCausalDenominators:'NOT_MEASURED',safetyCountersMeasured:false});
console.log(JSON.stringify({jobs:geometries.length,windows:geometries.reduce((n,g)=>n+g.windows.length,0),cells:cells.length,newNeuralRuns:0,acousticPayloadOpened:false}));
