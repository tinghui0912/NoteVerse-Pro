import {ProductAdapter,nearest,supported,same,denominator,claimTruth} from './domain';
import {payload,load,save,OUT,V6} from './io';

const zeroRuns={newNeuralRuns:0,RobustSessionRuns:0,AcousticModelWorkerRuns:0,InferenceSessionRuns:0,StageAReruns:0,ContinuousReruns:0};
const globalOwners=new Map<string,Map<string,string>>();
const perCounter:Record<string,string[]>={
 advanceWithoutNewTruthGesture:['*'],doubleAdvanceFromOneTruthGesture:['*'],busyPeriodCarryoverAdvance:['single_busy_retrigger','chord_busy_retrigger','busy_period_physical_input'],
 latePublicationCarryoverAdvance:['late_publication'],crossAttemptObservationReuse:['*'],matchWithoutFullTruthPitchSet:['*'],
 samePitchSustainAdvance:['same_pitch_sustain'],sameChordSustainAdvance:['same_chord_sustain'],extraToneFalseMatch:['extra_chord_tone'],
 incompleteChordFalseMatch:['missing_chord_tone','partial_then_full'],wrongPitchFalseMatch:['wrong_semitone','wrong_octave']};

function replay(spec:any,scenario:any,c:any,job:any,g:any,result:any,contract:any){
  const rate=spec.sourceRateHz,id=spec.scenarioId+':'+rate;
  const ms=(s:number)=>s*1000/rate;
  const physical=c.originalTruthCase.gestures;
  const guard=c.originalTruthCase.guard;
  const p=new ProductAdapter(rate,id,job.sourceOriginSample,spec.semanticEndSourceSample,scenario.targetPitchSets,spec.analysisHoldMs*rate/1000);
  const publications=result.publications;
  if(publications.length!==g.windows.length)throw Error('PUBLICATION_WINDOW_COUNT_DRIFT');
  const deliveries=publications.map((pub:any,index:number)=>{
    const w=g.windows[index];
    if(pub.window.windowIndex!==index||pub.window.startSample!==w.window.startSample||pub.window.endSample!==w.window.endSample||pub.sourceDomainId!==job.sourceDomainId)throw Error('PUBLICATION_SOURCE_GEOMETRY_DRIFT');
    for(const o of pub.observations)if(o.sourceEventSample!==(job.sourceOriginSample*16000+o.targetSample*rate)/16000||o.sourceDomainId!==job.sourceDomainId)throw Error('OBSERVATION_SOURCE_IDENTITY_DRIFT');
    return {pub,index,originalCapture:w.capturedThroughSourceSample,
      delivery:w.capturedThroughSourceSample+(index===spec.latePublicationWindowIndex?spec.publicationDelayMs*rate/1000:0),
      late:index===spec.latePublicationWindowIndex};
  });
  if(spec.architectureOnly){
    const boundary=scenario.schedule.watermarkOriginalSourceMs*rate/1000;
    p.capture(boundary);p.arm(boundary);
    const rejected=p.runtime.openAttempt(p.time(boundary))===null;
    return {...spec,actualValidCausalDenominator:null,architectureWitnessPass:rejected&&p.outcomes.length===0,
      physicalTruthGestureIds:physical.map((x:any)=>x.gestureId),physicalTruthTimes:physical.map((x:any)=>x.onsetMs),physicalTruthPitchSets:physical.map((x:any)=>x.normalizedPitchSet),
      targetPitchSets:scenario.targetPitchSets,productTrace:p.transitions,attempts:[],classification:rejected?'ARCHITECTURE_ONLY_PASS':'EVALUATION_INTEGRITY_FAILURE',
      safetyContributions:Object.fromEntries(Object.keys(perCounter).map(k=>[k,0])),expectedBehaviorSatisfied:rejected};
  }
  const end=job.sourceOriginSample+job.frames;
  const fixed=new Set<number>([...g.blocks.map((b:any)=>b.end),spec.inputEligibleAfterSourceSample,end]);
  for(const t of physical)fixed.add(t.onsetMs*rate/1000);
  if(guard){fixed.add(guard.startMs*rate/1000);fixed.add(guard.endMs*rate/1000);}
  for(const d of deliveries)if(d.delivery<=end)fixed.add(d.delivery);
  const scheduled=[...fixed].sort((a,b)=>a-b),truthStates:any[]=[],captureTrace:any[]=[],deliveryTrace:any[]=[],guardStates:any[]=[];
  let armed=false,current=job.sourceOriginSample,readyAt:number|null=null;
  while(scheduled.length){
    const nextFixed=scheduled[0],nextHold=p.gate.nextBoundary;
    const at=Math.min(nextFixed,nextHold);
    if(at>end||!Number.isFinite(at))break;
    if(at<current)throw Error('CAUSAL_SCHEDULE_BACKWARDS');current=at;
    if(at===nextFixed)scheduled.shift();
    for(const t of physical)if(t.onsetMs*rate/1000===at)truthStates.push({gestureId:t.gestureId,physicalSourceMs:t.onsetMs,sourceSample:at,
      state:p.state(),inputEligibleAfter:p.gate.snapshot().eligibleAfter,strictlyEligible:p.state()==='READY'&&at>p.gate.snapshot().eligibleAfter});
    p.capture(at);
    if(!armed&&at===spec.inputEligibleAfterSourceSample){p.arm(at);armed=true;readyAt=at;}
    captureTrace.push({sourceSample:at,sourceMs:ms(at),state:p.state(),inputEligibleAfter:p.gate.snapshot().eligibleAfter,
      sourceBlockEndpoint:g.blocks.some((b:any)=>b.end===at)});
    for(const d of deliveries.filter(d=>d.delivery===at).sort((a,b)=>Number(a.late)-Number(b.late)||a.index-b.index)){
      const before=p.state();
      p.accept({publicationId:`${job.sourceDomainId}:w${d.index}`,frontier:job.sourceOriginSample+d.pub.window.ownedEndTarget*rate/16000,
        wallMs:ms(at),capturedThrough:at,observations:d.pub.observations,late:d.late});
      deliveryTrace.push({windowIndex:d.index,originalPhysicalCapturedThrough:d.originalCapture,deliveredCapturedThrough:at,
        originalPublicationAvailabilityMs:d.pub.availabilityTimeMs,deliveryClock:'SOURCE_CAPTURE_PROGRESS_NOT_PERFORMANCE_NOW',
        late:d.late,stateBefore:before,stateAfter:p.state(),observationIds:d.pub.observations.map((o:any)=>o.observationId),
        sourceEvents:d.pub.observations.map((o:any)=>o.sourceEventSample)});
    }
    if(guard&&at>=guard.startMs*rate/1000&&at<=guard.endMs*rate/1000)guardStates.push({source:at,state:p.state()});
  }
  const contributions=Object.fromEntries(Object.keys(perCounter).map(k=>[k,0]));
  contributions.crossAttemptObservationReuse=p.ownershipViolations.length;
  const truthMatchOwners=new Set<string>(),ambiguous:any[]=[],unsupported:any[]=[];
  const attempts=p.outcomes.map(o=>{
    const anchorMs=ms(o.attempt.anchor),a=nearest(physical,anchorMs);
    const eligible=!!a.gesture&&a.gesture.onsetMs*rate/1000>o.eligibleAfter;
    const target=scenario.targetPitchSets[o.record.targetGeneration-1];
    if(!target)throw Error('FROZEN_TARGET_GENERATION_OUT_OF_RANGE');
    const full=eligible&&supported(a.gesture,target);
    if(a.status==='NOT_EVALUABLE_AMBIGUOUS_TRUTH')ambiguous.push({attemptId:o.record.attemptId,anchorMs});
    for(const observation of o.attempt.observations){
      const owners=globalOwners.get(observation.observationId)??new Map<string,string>();
      const old=owners.get(id);if(old&&old!==o.record.attemptId)contributions.crossAttemptObservationReuse++;
      owners.set(id,o.record.attemptId);globalOwners.set(observation.observationId,owners);
    }
    if(o.record.verdict==='MATCH'){
      if(!eligible)contributions.advanceWithoutNewTruthGesture++;
      if(!full)contributions.matchWithoutFullTruthPitchSet++;
      if(a.gesture&&!claimTruth(truthMatchOwners,a.gesture.gestureId))contributions.doubleAdvanceFromOneTruthGesture++;
      const busyTruth=truthStates.find(t=>t.gestureId===a.gesture?.gestureId&&['CAPTURING','ANALYZING','RESET'].includes(t.state));
      if(busyTruth&&perCounter.busyPeriodCarryoverAdvance.includes(spec.scenarioId))contributions.busyPeriodCarryoverAdvance++;
      if(spec.scenarioId==='late_publication'&&!eligible)contributions.latePublicationCarryoverAdvance++;
      if(spec.scenarioId==='same_pitch_sustain')contributions.samePitchSustainAdvance++;
      if(spec.scenarioId==='same_chord_sustain')contributions.sameChordSustainAdvance++;
      if(spec.scenarioId==='extra_chord_tone'&&!full)contributions.extraToneFalseMatch++;
      if(['missing_chord_tone','partial_then_full'].includes(spec.scenarioId)&&!full)contributions.incompleteChordFalseMatch++;
      if(['wrong_semitone','wrong_octave'].includes(spec.scenarioId)&&!full)contributions.wrongPitchFalseMatch++;
      if(!full)unsupported.push({attemptId:o.record.attemptId,attribution:a.status});
    }
    const relevant=deliveryTrace.find(d=>d.observationIds.some((id:string)=>o.attempt.observations.some((x:any)=>x.observationId===id)));
    return {...o,truthAttribution:a,physicalGestureEligible:eligible,fullPhysicalSupport:full,targetPitchSet:target,
      timing:{physicalSourceMs:a.gesture?.onsetMs??null,decodedSourceMs:anchorMs,
        publicationAvailabilityMs:relevant?.originalPublicationAvailabilityMs??null,captureReadyMs:ms(g.firstAuthoritativeBlockEnd),
        acousticPrerollReadyMs:ms(g.acousticPrerollReadySourceSample),targetWaitingMs:readyAt===null?null:ms(readyAt),inputEligibleAfterMs:ms(o.eligibleAfter),
        attemptOpenMs:ms(o.openCaptureSource),captureEndMs:ms(o.attempt.end),analysisEntryMs:ms(o.analysisCaptureSource),verdictMs:ms(o.verdictCaptureSource),
        rearmPhysicalWatermarkMs:o.rearmPhysicalWatermark===undefined?null:ms(o.rearmPhysicalWatermark),nextReadyMs:o.nextReadySource===undefined?null:ms(o.nextReadySource),
        sourceEventToAttemptOpenCaptureProgressMs:ms(o.openCaptureSource-o.attempt.anchor),sourceEventToVerdictCaptureProgressMs:ms(o.verdictCaptureSource-o.attempt.anchor),
        interpretation:'OFFLINE_CAUSAL_REPLAY_NOT_PHYSICAL_DEVICE_UX_LATENCY'}};
  });
  let valid=true;const reasons:string[]=[];
  const reject=(reason:string)=>{valid=false;reasons.push(reason);};
  if(!armed)reject('SEMANTIC_READY_NOT_ESTABLISHED');
  if(guard){
    if(!guard.allPitchNoteOnFree||spec.inputEligibleAfterSourceSample>guard.startMs*rate/1000||!guardStates.length||guardStates.some(s=>s.state!=='READY'))reject('NOT_EVALUABLE_READY_GUARD_NOT_ESTABLISHED');
  }else if(spec.scenarioId==='pre_ready_ignored'){
    if(truthStates.length!==physical.length||truthStates.some(t=>t.sourceSample>spec.inputEligibleAfterSourceSample))reject('NOT_EVALUABLE_PRE_READY_TOPOLOGY_NOT_ESTABLISHED');
  }else if(spec.analysisHoldMs){
    if(truthStates[0]?.strictlyEligible!==true||!['CAPTURING','ANALYZING','RESET'].includes(truthStates[1]?.state))reject('NOT_EVALUABLE_BUSY_TOPOLOGY_NOT_ACTUALLY_ESTABLISHED');
    if(spec.scenarioId==='late_publication'){
      const late=deliveryTrace.find(d=>d.late);
      const retired=p.transitions.filter(t=>t.action==='READY'&&t.sourceSample<=(late?.deliveredCapturedThrough??-Infinity)).at(-1);
      const second=physical[1].onsetMs*rate/1000;
      if(!late||!retired||second>retired.sourceSample)reject('NOT_EVALUABLE_LATE_PUBLICATION_NOT_RETIRED_BEFORE_READY');
    }
  }else if(truthStates.length!==physical.length||truthStates.some(t=>!t.strictlyEligible))reject('NOT_EVALUABLE_POST_READY_TOPOLOGY_NOT_ESTABLISHED');
  if(ambiguous.length)reject('NOT_EVALUABLE_AMBIGUOUS_TRUTH');
  const records=attempts.map(o=>o.record.verdict),sequence=contract.positiveSequences[spec.scenarioId];
  let expected=sequence?JSON.stringify(records)===JSON.stringify(sequence):records.every(v=>v!=='MATCH');
  if(spec.scenarioId==='post_ready_eligible')expected=attempts.length>0;
  if(spec.analysisHoldMs)expected=attempts.length===1&&attempts.every(o=>o.truthAttribution.gesture?.gestureId===physical[0].gestureId);
  if(spec.scenarioId==='mismatch_same_target_rearm')expected=expected&&attempts[0]?.record.targetGeneration===attempts[1]?.record.targetGeneration&&attempts[0]?.record.attemptId!==attempts[1]?.record.attemptId;
  if(['post_ready_repeat','match_followed_by_next_target'].includes(spec.scenarioId))expected=expected&&attempts[0]?.record.targetGeneration+1===attempts[1]?.record.targetGeneration;
  const danger=Object.values(contributions).some(n=>n>0);
  return {...spec,physicalTruthGestureIds:physical.map((x:any)=>x.gestureId),physicalTruthTimes:physical.map((x:any)=>x.onsetMs),physicalTruthPitchSets:physical.map((x:any)=>x.normalizedPitchSet),
    targetPitchSets:scenario.targetPitchSets,inputEligibleAfter:spec.inputEligibleAfterSourceSample,acousticPrerollEstablished:true,
    publicationDeliveryTrace:deliveryTrace,capturedThroughTrace:captureTrace,physicalCaptureStates:truthStates,guardStates,
    guardDurationMs:guard?.durationMs??null,attempts,productTrace:p.transitions,unresolvedAttempt:p.runtime.snapshot().step.activeAttempt,
    actualValidCausalDenominator:denominator(valid),notEvaluableReasons:reasons,expectedBehaviorSatisfied:expected,
    safetyContributions:contributions,ambiguous,unsupported,
    classification:ambiguous.length?'EVALUATION_INTEGRITY_FAILURE':danger?'SAFETY_FAILURE':!valid?'NOT_EVALUABLE':!expected?'FUNCTIONAL_RECOGNITION_FAILURE':'PASS'};
}

try{
  const contract=await load(OUT+'/counter-denominator-contract.json');
  const geometry=await load(OUT+'/stage-a-capture-watermark-reconstruction.json');
  const cases=(await load(V6+'/audio-bound-cases.json')).cases;
  const scenarios=(await load(V6+'/scenario-manifest.json')).scenarios;
  const jobs=(await load('backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json')).jobs;
  const acoustic=await payload();
  const cells=[];
  for(const spec of contract.cells){
    const scenario=scenarios.find((s:any)=>s.scenarioId===spec.scenarioId),job=jobs.find((j:any)=>j.jobId===spec.jobId);
    const result=acoustic.trace.results.find((r:any)=>r.jobId===spec.jobId),g=geometry.geometries.find((g:any)=>g.jobId===spec.jobId);
    const cell=replay(spec,scenario,cases[spec.family],job,g,result,contract);cells.push(cell);
    await save(OUT+`/cells/${spec.scenarioId}-${spec.sourceRateHz}.json`,cell);
  }
  const counters:Record<string,any>={};
  for(const [key,families] of Object.entries(perCounter)){
    const relevant=cells.filter(c=>!c.architectureOnly&&(families.includes('*')||families.includes(c.scenarioId)));
    counters[key]={dangerousCount:relevant.reduce((n,c)=>n+c.safetyContributions[key],0),validCausalDenominator:relevant.reduce((n,c)=>n+(c.actualValidCausalDenominator??0),0),
      byRate:Object.fromEntries([44100,48000].map(rate=>[rate,{dangerousCount:relevant.filter(c=>c.sourceRateHz===rate).reduce((n,c)=>n+c.safetyContributions[key],0),
        validCausalDenominator:relevant.filter(c=>c.sourceRateHz===rate).reduce((n,c)=>n+(c.actualValidCausalDenominator??0),0)}])),
      witnesses:relevant.filter(c=>c.safetyContributions[key]>0).map(c=>({scenarioId:c.scenarioId,rate:c.sourceRateHz,count:c.safetyContributions[key],attribution:c.classification,
        traceFile:`cells/${c.scenarioId}-${c.sourceRateHz}.json`})),status:relevant.some(c=>c.safetyContributions[key]>0)?'DANGEROUS_WITNESS':relevant.some(c=>c.actualValidCausalDenominator===1)?'ZERO_OBSERVED_ON_VALID_TRIALS':'NOT_EVALUABLE'};
  }
  const empirical=cells.filter(c=>!c.architectureOnly),eq=cells.filter(c=>c.architectureOnly);
  const integrity=cells.filter(c=>c.classification==='EVALUATION_INTEGRITY_FAILURE'),dangerous=cells.filter(c=>c.classification==='SAFETY_FAILURE');
  const missing=empirical.filter(c=>c.actualValidCausalDenominator!==1),functional=cells.filter(c=>c.classification==='FUNCTIONAL_RECOGNITION_FAILURE');
  const suffix=integrity.length?'EVALUATION_INTEGRITY_BLOCKED':dangerous.length?'SAFETY_BLOCKED':missing.length?'QUALIFICATION_NOT_ESTABLISHED_CAUSAL_DENOMINATOR_MISSING':functional.length?'FUNCTIONAL_RECOGNITION_BLOCKED':'PRODUCT_CAUSAL_QUALIFICATION_PASS_NO_TUNING';
  const positive=['correct_single','correct_chord','post_ready_repeat','match_followed_by_next_target','multiple_wrong_then_correct','partial_then_full','post_ready_eligible'];
  const usability=[44100,48000].map(rate=>{const valid=empirical.filter(c=>c.sourceRateHz===rate&&c.actualValidCausalDenominator===1&&positive.includes(c.scenarioId));
    const attempts=valid.flatMap(c=>c.attempts).filter(a=>a.truthAttribution.gesture&&same(a.truthAttribution.gesture.normalizedPitchSet,a.targetPitchSet));
    const expected=valid.reduce((n,c)=>n+(contract.positiveSequences[c.scenarioId]?.filter((x:string)=>x==='MATCH').length??1),0);
    const matched=attempts.filter(a=>a.record.verdict==='MATCH'&&a.fullPhysicalSupport).length;
    const repeats=valid.filter(c=>c.scenarioId==='post_ready_repeat');
    return {rate,correctAttemptAcceptance:{numerator:matched,denominator:expected},falseMismatch:{numerator:attempts.filter(a=>a.record.verdict==='MISMATCH').length,denominator:attempts.length},
      legitimatePostReadyRepeatAcceptance:{numerator:repeats.reduce((n,c)=>n+c.attempts.filter(a=>a.record.verdict==='MATCH'&&a.fullPhysicalSupport).length,0),denominator:repeats.length*2},
      retryRate:'NOT_MEASURED',retryVerdictCount:empirical.filter(c=>c.sourceRateHz===rate).flatMap(c=>c.attempts).filter(a=>a.record.verdict==='RETRY').length};});
  const ownerRows=[...globalOwners].map(([observationId,owners])=>({observationId,independentScenarioSessions:[...owners].map(([session,attemptId])=>({session,attemptId}))}));
  const distribution=(values:number[])=>{values.sort((a,b)=>a-b);return {count:values.length,p50:values[Math.ceil(values.length*.5)-1]??null,p95:values[Math.ceil(values.length*.95)-1]??null,max:values.at(-1)??null};};
  const sourceReplayLatency=[44100,48000].map(rate=>{
    const attempts=empirical.filter(c=>c.sourceRateHz===rate&&c.actualValidCausalDenominator===1).flatMap(c=>c.attempts).filter(a=>a.timing.physicalSourceMs!==null);
    return {rate,sourceEventToAttemptOpenCaptureProgressMs:distribution(attempts.map(a=>a.timing.attemptOpenMs-a.timing.physicalSourceMs)),
      sourceEventToVerdictCaptureProgressMs:distribution(attempts.map(a=>a.timing.verdictMs-a.timing.physicalSourceMs)),interpretation:'OFFLINE_CAUSAL_REPLAY_NOT_PHYSICAL_DEVICE_UX_LATENCY'};
  });
  const report={phase:'PRACTICE_STEP_H50_FROZEN_STAGE_B_PRODUCT_CAUSAL_QUALIFICATION_NO_NEURAL_NO_TUNING',completedAt:new Date().toISOString(),...zeroRuns,
    scenarioRateCellsExecuted:cells.length,empiricalCellsExpected:38,actualValidEmpiricalCells:empirical.length-missing.length,equalityWitnessesExpected:2,equalityWitnessesPass:eq.filter(c=>c.architectureWitnessPass).length,
    safetyCounters:counters,dangerousWitnesses:dangerous.map(c=>({scenario:c.scenarioId,rate:c.sourceRateHz,contributions:c.safetyContributions})),
    notEvaluableCells:missing.map(c=>({scenario:c.scenarioId,rate:c.sourceRateHz,reasons:c.notEvaluableReasons})),
    functionalFailures:functional.map(c=>({scenario:c.scenarioId,rate:c.sourceRateHz,actual:c.attempts.map(a=>a.record.verdict)})),ambiguousCells:integrity.map(c=>({scenario:c.scenarioId,rate:c.sourceRateHz})),
    usabilityMetrics:usability,sourceReplayLatency,latencyDomainInterpretation:{eventToFirstAvailability:'NOT_COMPARABLE_ACROSS_CLOCK_DOMAINS',deviceUXLatency:'NOT_MEASURED',sourceReplayDurations:'OFFLINE_CAUSAL_REPLAY_NOT_PHYSICAL_DEVICE_UX_LATENCY'},
    observationOwnership:{scope:contract.crossScenarioIndependence,rows:ownerRows,crossCounterfactualReuses:ownerRows.filter(r=>r.independentScenarioSessions.length>1).length},
    cells:cells.map(c=>({scenario:c.scenarioId,rate:c.sourceRateHz,valid:c.actualValidCausalDenominator,classification:c.classification,traceFile:`cells/${c.scenarioId}-${c.sourceRateHz}.json`})),
    StageAOutputUnchanged:true,productMicrophoneIntegrated:false,capabilities:{Continuous:'MODEL_NOT_VALIDATED',STEP:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
    commercialQualification:'NOT_PERFORMED',physicalMicrophoneQualification:'NOT_PERFORMED',realDeviceQualification:'NOT_PERFORMED',uxSloQualification:'NOT_PERFORMED',scientificWinner:'NOT_CLAIMED',
    disposition:'STEP_WAITING_H50_PRIMARY_STAGE_B_'+suffix,nextAllowedPhase:'STOP_FOR_INDEPENDENT_AUDIT_NO_MICROPHONE_INTEGRATION'};
  await save(OUT+'/stage-b-results.json',report);
  console.log(JSON.stringify({disposition:report.disposition,cells:cells.length,valid:report.actualValidEmpiricalCells,dangerous:dangerous.length,functional:functional.length,...zeroRuns}));
}catch(error){
  await save(OUT+'/stage-b-execution-failure.json',{failure:String(error),stack:error instanceof Error?error.stack:null,...zeroRuns,
    disposition:'STEP_WAITING_H50_PRIMARY_STAGE_B_EVALUATION_INTEGRITY_BLOCKED',rerunAllowed:false});throw error;
}
