import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT,OUT,bytes,load,save,hash,now,zero } from './io.mjs';
import { verify,inputs } from './audit.mjs';

export async function replay(){
  const freeze=await verify(),proof=await load(OUT+'/remote-migration-freeze-proof.json'),startedAt=now();
  assert.equal(proof.freezeCommit,proof.remoteHead);assert.equal(proof.freezeSha256,hash(await bytes(OUT+'/migration-protocol-freeze.json')));
  assert.ok(proof.remoteVerifiedAt<startedAt);await save(OUT+'/replay-started.json',{startedAt,proof,executionsAllowed:1,zero});
  const rows=[],cells=[],envelopes=[],mismatches=[];
  const same=(a,b,label)=>{try{assert.deepStrictEqual(a,b);}catch(error){mismatches.push({label,actual:a,expected:b});throw Object.assign(error,{assemblyParity:true});}};
  try{
    const acoustic=await load(inputs.acoustic),v15=await load(inputs.v15),v18=await load(inputs.v18),scenarios=(await load(inputs.scenarios)).scenarios;
    const windows=(await load(inputs.windows)).windows,preservation=(await load(inputs.preservation)).results;
    const bundle=freeze.bundles.find(b=>b.name==='domain');assert.equal(hash(await bytes(bundle.path)),bundle.sha256);
    const d=await import(pathToFileURL(path.join(ROOT,bundle.path)).href);
    for(const cell of v18.cells){
      const oldRows=v18.rows.filter(r=>r.scenarioId===cell.scenarioId&&r.rate===cell.rate);
      const legacy=v15.cells.find(c=>c.scenarioId===cell.scenarioId&&c.sourceRateHz===cell.rate),job=acoustic.trace.results.find(j=>j.jobId===legacy.jobId);
      const meta=windows.filter(w=>w.jobId===legacy.jobId),source=preservation.find(j=>j.jobId===legacy.jobId);
      assert.equal(meta[0].sourceOriginSample,source.sourceOriginSample);assert.equal(meta[0].sourceRateHz,cell.rate);
      assert.equal(job.publications.length,meta.length);
      const publications=job.publications.map((p,index)=>{
        same(p.window,meta[index].runtimeWindow,'FROZEN_WINDOW_COORDINATES');
        assert.equal(p.sourceDomainId,meta[index].sourceDomainId);assert.equal(p.sourceSampleRateHz,meta[index].sourceRateHz);
        const ownedThroughSourceSample=meta[index].sourceOriginSample+p.window.ownedEndTarget*cell.rate/16000;
        return {...p,ownedThroughSourceSample};
      });
      const scenario=scenarios.find(s=>s.scenarioId===cell.scenarioId),domainId=`v24:${cell.scenarioId}:${cell.rate}`;
      const h=d.runtime(scenario.targetPitchSets,domainId),cellRows=[],owners=new Set();
      h.owner.setInputUnavailable();h.owner.acceptInputAfter(h.time(oldRows[0].domainTrace.ready.step.inputEligibleAfter.ms));
      for(const old of oldRows){
        const original=legacy.traces.find(t=>t.ordinal===old.ordinal),ready=h.owner.snapshot();assert.ok(h.owner.canAcceptAttempt);
        assert.equal(ready.version.schemaVersion,6);assert.equal(ready.version.runtimeVersion,'step-source-sensitive-verdict-v6');
        let pending=null;
        const assembler=new d.StepAcousticAttemptAssembler({sourceDomainId:job.publications[0].sourceDomainId,sourceSampleRateHz:cell.rate,
          localSessionId:domainId,sourceAnchorSample:original.originalEligibilityBoundarySample,
          sessionAnchorTime:h.time(original.syntheticReadyEpochMs),sink:{
            open:time=>{h.clock.set(time.ms);return h.owner.openAttempt(time);},
            complete:(identity,evidence)=>{assert.equal(pending,null);pending={identity,evidence};}
          }});
        assembler.acceptInputAfter(original.originalEligibilityBoundarySample);
        let sealed=null,lastPublicationIndex=-1;
        for(const [index,p]of publications.entries()){
          sealed=assembler.accept(p);lastPublicationIndex=index;if(sealed)break;
        }
        if(!sealed||!pending)throw Error('FROZEN_ATTEMPT_NO_SEALED_PRODUCTION_GESTURE');
        const expected={sourceDomainId:publications[0].sourceDomainId,sourceSampleRateHz:cell.rate,anchorSourceSample:original.assembly.anchor,
          endSourceSample:original.assembly.end,observations:original.assembly.observations,pitches:original.assembly.pitches,confidence:original.assembly.confidence};
        const actual={sourceDomainId:sealed.sourceDomainId,sourceSampleRateHz:sealed.sourceSampleRateHz,anchorSourceSample:sealed.anchorSourceSample,
          endSourceSample:sealed.endSourceSample,observations:sealed.observations,pitches:sealed.evidence.observedAttackPitches,confidence:sealed.evidence.confidence};
        same(actual,expected,old.rowId+':COMPLETE_H50_ASSEMBLY');
        same(sealed.observations,old.observations,old.rowId+':V18_OBSERVATIONS');
        for(const o of sealed.observations){assert.ok(!owners.has(o.observationId),'CROSS_ATTEMPT_OBSERVATION_REUSE');owners.add(o.observationId);}
        assert.equal(pending.evidence.kind,'EVIDENCE');assert.ok(h.owner.analyzeAttempt(pending.identity));
        const completion=h.owner.completeAttempt(pending.identity,pending.evidence);assert.equal(completion.kind,'FINALIZED');
        const record=completion.record,postVerdict=h.owner.snapshot();
        if(record.verdict!==old.productRecord.verdict||record.retryReason!==old.productRecord.retryReason)throw Object.assign(Error('PER_ROW_RUNTIME_PARITY:'+old.rowId),{assemblyParity:true});
        same(record.observedAttackPitches,old.productRecord.observedAttackPitches,old.rowId+':RUNTIME_PITCH_RECORD');
        same(record.confidence,old.productRecord.confidence,old.rowId+':RUNTIME_CONFIDENCE_RECORD');
        assert.equal(record.captureEndSessionTime.sampleIndex,sealed.endSourceSample);
        assert.equal(pending.identity.attemptStartSessionTime.sampleIndex,sealed.anchorSourceSample);
        assert.equal(postVerdict.step.attemptState,'POST_VERDICT');assert.equal(postVerdict.step.targetGeneration,ready.step.targetGeneration);
        assert.equal(h.owner.openAttempt(h.time(record.captureEndSessionTime.ms+1)),null);
        h.clock.set(old.domainTrace.rearmed.step.inputEligibleAfter.ms);h.owner.rearm(h.time(h.clock.nowMs()));const rearmed=h.owner.snapshot();
        same(rearmed.step.targetGeneration,old.domainTrace.rearmed.step.targetGeneration,old.rowId+':REARM_TARGET_GENERATION');
        assert.equal(h.owner.openAttempt(h.time(h.clock.nowMs())),null);
        const support=old.expected.every(p=>old.physicalTruth.includes(p));
        const classification=record.verdict==='MATCH'?(support?'SAFE_MATCH':'DANGEROUS_FALSE_MATCH')
          :record.verdict==='RETRY'?(support?'SUPPORTED_RETRY':'UNSUPPORTED_RETRY'):(support?'FALSE_REJECT':'TRUE_REJECT');
        same(classification,old.classification==='SUPPORTED_MISMATCH'?'FALSE_REJECT':old.classification,old.rowId+':PHYSICAL_CLASSIFICATION');
        const row={rowId:old.rowId,scenarioId:old.scenarioId,ordinal:old.ordinal,rate:cell.rate,jobId:legacy.jobId,
          expected:old.expected,physicalTruth:old.physicalTruth,physicalGestureId:old.physicalGestureId,physicalTargetSupported:support,
          assembly:actual,assemblyParity:true,lastPublicationIndex,historicalLastPublicationIndex:original.lastPublicationIndex,
          identity:pending.identity,submittedEvidence:pending.evidence,record,classification,domainTrace:{ready,postVerdict,rearmed},
          assemblerSnapshot:assembler.snapshot(),mapping:{sourceAnchor:original.originalEligibilityBoundarySample,sessionAnchorMs:original.syntheticReadyEpochMs,
            kind:'PRACTICE_TIMEBASE_SAMPLE_MAPPING_PACED_REPLAY_NOT_MICROPHONE_LATENCY',originalSyntheticOpenMs:original.identity.attemptStartSessionTime.ms,
            actualOpenMs:pending.identity.attemptStartSessionTime.ms},verdictOwner:'StepPracticeRuntime.completeAttempt',externalP2:false};
        rows.push(row);cellRows.push(row);
      }
      envelopes.push({scenarioId:cell.scenarioId,rate:cell.rate,jobId:legacy.jobId,sourceOriginSample:meta[0].sourceOriginSample,
        formula:'sourceOriginSample + window.ownedEndTarget * sourceRateHz / 16000',
        publications:publications.map(p=>({window:p.window,sourceDomainId:p.sourceDomainId,ownedThroughSourceSample:p.ownedThroughSourceSample,
          observationIds:p.observations.map(o=>o.observationId)}))});
      cells.push({scenarioId:cell.scenarioId,rate:cell.rate,verdicts:cellRows.map(r=>r.record.verdict),finalSnapshot:h.owner.snapshot()});
    }
    const verdicts=Object.fromEntries(['MATCH','RETRY','MISMATCH'].map(k=>[k,rows.filter(r=>r.record.verdict===k).length]));
    const classifications=Object.fromEntries(Object.keys(freeze.contract.physicalClassificationParity).map(k=>[k,rows.filter(r=>r.classification===k).length]));
    same(verdicts,freeze.contract.verdictParity,'AGGREGATE_RUNTIME_PARITY');same(classifications,freeze.contract.physicalClassificationParity,'AGGREGATE_PHYSICAL_PARITY');
    assert.equal(rows.length,34);assert.equal(cells.length,22);await verify();
    await save(OUT+'/source-frontier-envelopes.json',{formula:freeze.contract.frontierEnvelope,envelopes,observationsRegenerated:false,zero});
    await save(OUT+'/migration-replay-results.json',{phase:freeze.contract.phase,startedAt,completedAt:now(),proof,assembliesChecked:rows.length,
      completeAssemblyParity:true,semanticAssemblyDifferences:mismatches,verdicts,classifications,cells,rows,zero,
      evidenceOnlySubmissions:rows.length,externalP2Executions:0,newSourceSampleFieldsPreserved:true,
      byRate:[44100,48000].map(rate=>({rate,verdicts:Object.fromEntries(['MATCH','RETRY','MISMATCH'].map(k=>[k,rows.filter(r=>r.rate===rate&&r.record.verdict===k).length]))})),
      sourceFrontier:'EXCLUSIVE_PROCESSED_OWNED_END_NOT_PHYSICAL_CAPTURE_RETIREMENT',rearm:freeze.contract.rearm,cooldown:freeze.contract.cooldown,
      capabilities:freeze.contract.capabilities,disposition:'STEP_V24_PRODUCTION_H50_ASSEMBLER_ESTABLISHED_BASELINE_EVIDENCE_PARITY',
      qualification:'NOT_PERFORMED',browserMicrophoneEnabled:false,nextAllowedPhase:'STOP_WAIT_FOR_INDEPENDENT_AUDIT'});
    console.log(JSON.stringify({rows:rows.length,verdicts,classifications,assemblyDifferences:mismatches.length,zero}));
  }catch(error){
    await save(OUT+'/replay-failure.json',{failedAt:now(),failure:String(error.stack??error),partialRows:rows,partialCells:cells,mismatches,zero,
      disposition:error.assemblyParity?'STEP_V24_H50_PRODUCTION_MIGRATION_PARITY_FAILURE':'STEP_V24_H50_MIGRATION_EVIDENCE_INTEGRITY_BLOCKED',rerunAllowed:false});throw error;
  }
}
