import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT,OUT,load,bytes,save,hash,now,canonical } from './io.mjs';
import { verify,baseline,PLAN } from './control.mjs';
import { decodeLE,TENSOR_BYTES,PAIR_BYTES } from './wire.mjs';
import { physicalClassification,targetCovered,recompute,verifyRows,groupViews } from '../robust_signed_zero_v22/recompute.mjs';
import { equalEvidence,normalizeSignedZero } from '../robust_signed_zero_v22/numeric.mjs';

const freeze=await verify(),proof=await load(OUT+'/remote-raw-seal-proof.json'),startedAt=now();
assert.equal(proof.captureCommit,proof.remoteHead);assert.ok(proof.remoteVerifiedAt<startedAt);
assert.equal(hash(await bytes(OUT+'/tensor-corpus-manifest.json')),proof.tensorManifestSha256);
assert.equal(hash(await bytes(OUT+'/raw-tensor-seal.json')),proof.rawSealSha256);
await save(OUT+'/stage-b-started.json',{startedAt,proof,executionsAllowed:1,neuralRuns:0});
const jobs=[],rows=[],owners=new Map();let decoderRuns=0,productVerdictRuns=0;
try{
  const manifest=await load(OUT+'/tensor-corpus-manifest.json'),graphs=(await load(OUT+'/bundle-graphs.json')).graphs;
  const decoder=graphs.find(g=>g.phase==='decoder'),domain=graphs.find(g=>g.phase==='domain');
  assert.equal(hash(await bytes(decoder.path)),decoder.sha256);assert.equal(hash(await bytes(domain.path)),domain.sha256);
  const {decodeRobustPiano,sourcePublication}=await import(pathToFileURL(path.join(ROOT,decoder.path)).href);
  for(const blob of manifest.blobs){
    const raw=await bytes(blob.path);assert.equal(hash(raw),blob.sha256);const publications=[],rawDerivedEvents=[];
    jobs.push({jobId:blob.jobId,publications,rawDerivedEvents});
    for(const w of manifest.windows.filter(w=>w.jobId===blob.jobId)){
      const pair=raw.subarray(w.byteOffset,w.byteOffset+PAIR_BYTES);assert.equal(hash(pair),w.pairSha256);decoderRuns++;
      const events=decodeRobustPiano({reg_onset_output:decodeLE(pair.subarray(0,TENSOR_BYTES)),reg_onset_shape:[1,183,88],
        frame_output:decodeLE(pair.subarray(TENSOR_BYTES)),frame_shape:[1,183,88]},w.runtimeWindow.startSample,
      {onsetThreshold:0.30,frameThreshold:0.05});
      const p=sourcePublication(w.sourceDomainId,w.sourceRateHz,w.sourceOriginSample,w.runtimeWindow,
        {events,inferenceMs:0,decodeMs:0,actualSessionRunCount:w.runOrdinal+1},0);
      publications.push({sourceDomainId:p.sourceDomainId,sourceSampleRateHz:p.sourceSampleRateHz,window:p.window,observations:p.observations});
      rawDerivedEvents.push({runOrdinal:w.runOrdinal,window:w.runtimeWindow,events});
    }
  }
  assert.equal(decoderRuns,228);
  await save(OUT+'/candidate-publications.json',{candidate:freeze.contract.candidate,thresholds:{onsetThreshold:0.30,frameThreshold:0.05},
    jobs,decoderRuns,neuralRuns:0,scoreBlindDecodedPublications:true});
  const d=await import(pathToFileURL(path.join(ROOT,domain.path)).href),plan=await load(PLAN);
  assert.equal(d.GESTURE_WIDTH_MS,50);
  for(const fixed of plan.rows){
    const job=jobs.find(j=>j.jobId===fixed.jobId),w=manifest.windows.find(w=>w.jobId===fixed.jobId);
    const gate=new d.WaitingTopologyGate(fixed.rate,'evidence-only',fixed.eligibilityBoundarySample,fixed.semanticEndSample,1,0);
    gate.arm(fixed.eligibilityBoundarySample,0);let assembly=null;
    for(const p of job.publications){
      gate.accept({publicationId:`${p.sourceDomainId}:w${p.window.windowIndex}`,frontier:w.sourceOriginSample+p.window.ownedEndTarget*fixed.rate/16000,
        capturedThrough:fixed.eligibilityBoundarySample,wallMs:0,observations:p.observations});
      const sealed=gate.actions.find(a=>a.type==='SEAL');if(sealed){assembly=sealed.attempt;break;}
    }
    if(!assembly&&gate.actions.some(a=>a.type==='OPEN'))throw Error('H50_COVERAGE_INCOMPLETE');
    const row={...fixed,acousticObserved:[],observations:[],assembly,gateActions:gate.actions,gateReceipts:gate.receipts,
      productRecord:null,submittedEvidence:null,status:assembly?'RECONSTRUCTED_H50_ATTEMPT':'NO_ELIGIBLE_ACOUSTIC_GESTURE',
      physicalTargetSupported:targetCovered(fixed.expected,fixed.physicalTruth),profileId:freeze.contract.candidate};
    if(assembly){
      const candidates=fixed.attributionGestures.map(g=>({gestureId:g.gestureId,distanceMs:Math.abs(g.onsetMs-assembly.anchor*1000/fixed.rate)}))
        .filter(g=>g.distanceMs<=100).sort((a,b)=>a.distanceMs-b.distanceMs);
      assert.ok(candidates.length&&candidates[0].gestureId===fixed.physicalGestureId,'INTENDED_GESTURE_ATTRIBUTION_MISMATCH');
      assert.ok(candidates.length<2||candidates[0].distanceMs!==candidates[1].distanceMs,'AMBIGUOUS_GESTURE_ATTRIBUTION');
      row.attribution=candidates[0];row.observations=assembly.observations;
      row.acousticObserved=Array.from(new Set(assembly.observations.map(o=>o.midiPitch))).sort((a,b)=>a-b);
      for(const observation of assembly.observations){
        const key=fixed.scenarioId+':'+fixed.rate+':'+observation.observationId;
        assert.ok(!owners.has(key)||owners.get(key)===fixed.physicalGestureId,'CROSS_GESTURE_OBSERVATION_REUSE');owners.set(key,fixed.physicalGestureId);
      }
      const h=d.runtime([fixed.expected],`v23:${fixed.rowId}`),project=sample=>plan.epoch.readyMs+(sample-fixed.eligibilityBoundarySample)*1000/fixed.rate;
      assert.ok(project(assembly.end)<plan.epoch.rearmMs,'FIXED_PACED_EPOCH_OVERFLOW');
      h.owner.setInputUnavailable();h.owner.acceptInputAfter(h.time(plan.epoch.readyMs));const ready=h.owner.snapshot();
      assert.equal(ready.version.schemaVersion,6);assert.equal(ready.version.runtimeVersion,'step-source-sensitive-verdict-v6');
      assert.equal(h.owner.verdictPolicy,'MICROPHONE_CONSERVATIVE_TRISTATE');assert.equal(h.owner.openAttempt(h.time(plan.epoch.readyMs)),null);
      h.clock.set(project(assembly.anchor));const identity=h.owner.openAttempt(h.time(h.clock.nowMs()));assert.ok(identity);assert.ok(h.owner.analyzeAttempt(identity));
      const evidence={kind:'EVIDENCE',observedAttackPitches:[...assembly.pitches],confidence:assembly.confidence,captureEndSessionTime:h.time(project(assembly.end))};
      productVerdictRuns++;const completed=h.owner.completeAttempt(identity,evidence);assert.equal(completed.kind,'FINALIZED');
      const postVerdict=h.owner.snapshot();assert.equal(postVerdict.step.attemptState,'POST_VERDICT');assert.equal(postVerdict.step.targetGeneration,ready.step.targetGeneration);
      equalEvidence(completed.record.observedAttackPitches,[...new Set(evidence.observedAttackPitches)].sort(),'EVIDENCE_PITCH_PRESERVATION');
      assert.equal(completed.record.confidence,evidence.confidence);assert.equal(h.owner.openAttempt(h.time(project(assembly.end)+1)),null);
      h.clock.set(plan.epoch.rearmMs);h.owner.rearm(h.time(h.clock.nowMs()));const rearmed=h.owner.snapshot();
      assert.equal(rearmed.step.targetGeneration,ready.step.targetGeneration+(completed.record.verdict==='MATCH'?1:0));
      assert.equal(h.owner.openAttempt(h.time(h.clock.nowMs())),null);
      Object.assign(row,{identity,submittedEvidence:evidence,productRecord:completed.record,domainTrace:{ready,postVerdict,rearmed},verdictOwner:'StepPracticeRuntime.completeAttempt'});
    }
    row.classification=physicalClassification(row.productRecord?.verdict??null,row.physicalTargetSupported);
    row.requiredPitchPresence=fixed.expected.map(p=>({midiPitch:p,present:row.acousticObserved.includes(p)}));rows.push(row);
  }
  assert.equal(rows.length,34);assert.equal(groupViews(rows).length,26);verifyRows(rows,equalEvidence);
  const base=await baseline(),profile={profileId:freeze.contract.candidate,gridStepDistance:0};
  const result=recompute(rows,base.rows,profile),regressions=result.reasons.filter(reason=>freeze.contract.regressionGates.includes(reason));
  const disposition=regressions.length?'ROBUST_V23_600_120_GEOMETRY_INELIGIBLE_PRODUCT_REGRESSION'
    :result.meaningful?'ROBUST_V23_600_120_STEP_GEOMETRY_DEVELOPMENT_CHALLENGER_SUPPORTED'
    :'ROBUST_V23_600_120_NO_MEANINGFUL_STEP_USABILITY_GAIN_BASELINE_600_170_RETAINED';
  const lookup=new Map(base.result.targetViews.map(v=>[v.viewId,v]));
  const productParity=result.targetViews.every(v=>{
    const old=lookup.get(v.viewId);return v.classification===old.classification&&fixedPresence(v)===fixedPresence(old);
  });
  function fixedPresence(v){return canonical(v.expected.map(p=>({pitch:p,present:v.acousticObserved.includes(p)})));}
  const timings=[...manifest.trace.inferenceMs].sort((a,b)=>a-b),percentile=p=>timings[Math.ceil(timings.length*p)-1];
  const recoveredRecordings=Array.from(new Set(result.targetViews.filter(v=>result.newlyRecoveredSafeTargetViewIds.includes(v.viewId)).map(v=>v.recordingId))).sort();
  await verify();
  await save(OUT+'/geometry-results.json',{phase:freeze.contract.phase,classification:freeze.contract.classification,candidate:freeze.contract.candidate,
    baselineIdentity:freeze.contract.baseline,startedAt,completedAt:now(),rawRemoteProof:proof,rawSealPrecedesDecoder:true,
    geometry:{ownedMs:600,pastMs:1100,futureMs:120,inputSamples:29120,inputMs:1820},baselineGeometry:freeze.contract.baselineGeometry,
    thresholdPair:{onset:0.30,frame:0.05},futureContextDeltaMs:-50,baseline:base.result.views,
    rows,result:normalizeSignedZero(result),regressionReasons:regressions,safetyRecallAndBaselineMatchGatesPass:regressions.length===0,
    recoveredTargetViewIds:result.newlyRecoveredSafeTargetViewIds,recoveredDistinctGestures:result.recoveredDistinctPhysicalGestures,
    recoveredRecordingIds:recoveredRecordings,pairedRecoveries:result.pairedRecoveredPhysicalGestures,meaningfulUsabilityImprovement:result.meaningful,
    exactStepProductParity:productParity,optionalParityLabel:productParity?'600_120_STEP_PRODUCT_PARITY_WITH_50MS_LESS_FUTURE_CONTEXT':null,
    parityDefinition:'Every fixed target-view classification and required-pitch presence identical; no acoustic observation/time/confidence parity is claimed',
    stageA:manifest.receipt,stageB:{neuralRuns:0,decoderARuns:decoderRuns,alternativeThresholdDecoderRuns:0,decoderBRuns:0,decoderCRuns:0,
      productRuntimeConstructions:rows.filter(r=>r.productRecord).length,productVerdictRuns,baselineProductRuntimeRuns:0,baselineNeuralRuns:0},
    inferenceEngineeringDiagnostics:{count:timings.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:timings.at(-1),clock:'WORKER_PERFORMANCE_NOW_DURATION'},
    physicalUXLatency:'NOT_MEASURED_NO_50MS_DEVICE_UX_GAIN_CLAIM',ContinuousRuns:0,defaultGeometryChanged:false,productionChanged:false,
    historicalDispositions:{V21:'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED',V22:'ROBUST_V22_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED'},
    capabilities:freeze.contract.capabilities,sharedModelStrategy:freeze.contract.sharedModelStrategy,disposition,
    nextAllowedPhase:'INDEPENDENT_AUDIT_ONLY_NO_AUTOMATIC_CONTINUOUS_EXECUTION_OR_PROMOTION'});
  console.log(JSON.stringify({disposition,classes:result.views.classifications,recovered:result.newlyRecoveredSafeTargetViewIds.length,paired:result.pairedRecoveredPhysicalGestures.length,productParity,decoderRuns,productVerdictRuns}));
}catch(error){
  await save(OUT+'/stage-b-failure.json',{failedAt:now(),error:String(error.stack??error),partialJobs:jobs,partialRows:rows,decoderRuns,productVerdictRuns,
    neuralRuns:0,rerunAllowed:false,disposition:'ROBUST_V23_GEOMETRY_STUDY_INTEGRITY_BLOCKED'});throw error;
}
