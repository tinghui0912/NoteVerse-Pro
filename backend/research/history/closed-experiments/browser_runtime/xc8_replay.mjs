import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {DirectClaimantCommitFinalizer} from './xc8_direct_claimant_commit_finalizer.mjs';
import {evaluateProductVariant,compactProduct,pitchName,CLASSES,latencySummary} from './xc2_product_metrics.mjs';
import {PHASE,WORK,REPORTS,LABEL,load,atomicJson,fileSha,digest,requireFrozen} from './xc8_protocol.mjs';
import {validateArtifactDigest} from './xc1_artifacts.mjs';

function expectedFor(scenario){return scenario.expected.map((s,i)=>({strikeId:s.strikeId,groupId:s.groupId,pitch:pitchName(s.pitch),
  expectedPerformanceTimeMs:scenario.beatPositions[i]*60000/scenario.fixedBpm,renderNoteIds:[]}));}
export function replayCandidate(scenario,publications){
  const expected=expectedFor(scenario),ledger=new DirectClaimantCommitFinalizer(expected);
  for(const p of publications)ledger.publish({...p,observations:p.observations.map(o=>({...o,pitch:pitchName(o.pitch)}))});
  const last=publications.at(-1),snapshot=ledger.completeNaturalScope(last.analyzedThroughPerformanceMs,last.availabilityTimeMs);
  const owners=snapshot.observationConsumption,consumed=snapshot.verdicts.flatMap(v=>v.consumedObservationIds);
  const ids=publications.flatMap(p=>p.observations).map(o=>o.observationId);
  const violations={observationDoubleOwnership:owners.length-new Set(owners.map(o=>o.observationId)).size,
    semanticOwnershipViolation:consumed.length-new Set(consumed).size,transitiveHorizonViolation:0,
    unresolvedDirectClaimantsAtGroupFinalization:0,wrongPreemptsCorrect:0,
    pendingTerminalStrikes:snapshot.lowLevel.strikes.filter(s=>s.verdict==='PENDING').length,
    pendingTerminalReservations:snapshot.provisionalReservations.length,pendingTerminalObservations:snapshot.pendingObservationIds.length};
  if(owners.length!==new Set(ids).size)violations.semanticOwnershipViolation++;
  const obs=new Map(publications.flatMap(p=>p.observations).map(o=>[o.observationId,o]));
  const byStrike=new Map(snapshot.strikeWitnesses.map(s=>[s.strikeId,s]));
  for(const s of snapshot.strikeWitnesses){
    if(s.unclampedRequiredFrontierMs>s.targetTimeMs+750+1e-8)violations.transitiveHorizonViolation++;
  }
  for(const v of snapshot.verdicts){
    if(v.witness.unclampedRequiredFrontierMs>v.performanceTimeMs+(v.verdict==='EXTRA'?1500:1250)+1e-8)violations.transitiveHorizonViolation++;
    const first=publications.find(p=>p.analyzedThroughPerformanceMs>=v.witness.requiredAnalysisFrontierMs);
    if(!first||first.availabilityTimeMs!==v.finalizationTimeMs||v.witness.requiredAnalysisFrontierMs>v.witness.enablingAnalysisFrontierMs)throw new Error('XC8_ENABLING_PUBLICATION_WITNESS');
    if(v.groupId&&v.verdict!=='CORRECT'){
      const own=expected.filter(s=>s.groupId===v.groupId),a=Math.min(...own.map(s=>s.expectedPerformanceTimeMs)),pitches=new Set(own.map(s=>s.pitch));
      const local=[...obs.values()].filter(o=>!pitches.has(pitchName(o.pitch))&&Math.abs(o.performanceTimeMs-a)<=250);
      for(const o of local)for(const s of expected.filter(s=>s.pitch===pitchName(o.pitch)&&Math.abs(s.expectedPerformanceTimeMs-o.performanceTimeMs)<=250)){
        if(byStrike.get(s.strikeId).availabilityTimeMs>v.finalizationTimeMs)violations.unresolvedDirectClaimantsAtGroupFinalization++;
      }
    }
  }
  for(const owner of owners.filter(o=>o.disposition==='WRONG')){
    const o=obs.get(owner.observationId),g=snapshot.verdicts.find(v=>v.groupId===owner.owner);
    for(const s of expected.filter(s=>s.pitch===pitchName(o.pitch)&&Math.abs(s.expectedPerformanceTimeMs-o.performanceTimeMs)<=250)){
      const w=byStrike.get(s.strikeId);if(w.availabilityTimeMs>g.finalizationTimeMs||w.matchedObservationId===o.observationId)violations.wrongPreemptsCorrect++;
    }
  }
  if(Object.values(violations).some(v=>v!==0))throw new Error('XC8_AUDIT_FAILED:'+JSON.stringify(violations));
  return{snapshot,violations};
}
function confusion(rows,key){
  const predictions=[...CLASSES,'NOT_DETECTED','NOT_REACHED'];
  return Object.fromEntries(CLASSES.map(truth=>[truth,Object.fromEntries(predictions.map(p=>[p,rows.filter(r=>r.truth===truth&&r[key]===p).length]))]));
}
const sig=s=>`${s.verdict}:${s.matchedObservationId??''}`;
function ownerMap(strikes,verdicts){
  const owners=new Map(strikes.filter(s=>s.verdict==='MATCHED').map(s=>[s.matchedObservationId,{observationId:s.matchedObservationId,disposition:'MATCHED',owner:s.strikeId}]));
  const seen=new Set();
  for(const v of verdicts)for(const id of v.consumedObservationIds){
    if(seen.has(id))throw new Error('XC8_HISTORICAL_DOUBLE_OWNER');seen.add(id);
    if(owners.has(id)){
      if(strikes.find(s=>s.strikeId===owners.get(id).owner)?.groupId!==v.groupId)throw new Error('XC8_HISTORICAL_OWNER_RECONSTRUCTION');
      continue;
    }
    owners.set(id,{observationId:id,disposition:v.verdict==='EXTRA'?'EXTRA':'WRONG',owner:v.groupId??v.id});
  }
  return owners;
}
function ownerDiff(reference,candidate){return [...new Set([...reference.keys(),...candidate.keys()])].sort().flatMap(id=>
  digest(reference.get(id)??null)===digest(candidate.get(id)??null)?[]:[{observationId:id,reference:reference.get(id)??null,candidate:candidate.get(id)??null}]);}
export async function run(){
  const {freeze,proof}=await requireFrozen(true),executionStartTimestamp=new Date().toISOString();
  await atomicJson(`${WORK}/execution_start.json`,{phase:PHASE,proof,executionStartTimestamp});
  const prior=await load(`${REPORTS}/phase9g_xc2_r2_direct_conflict_final_2026-10-16.json`);
  const configReport=await load(`${REPORTS}/phase9g_xc2_product_verdict_latency_final_2026-10-16.json`),summary=[];
  for(const {configuration,split}of freeze.cells){
    const c=configReport.ort120Main.candidates.find(c=>c.id===configuration),manifest=prior.artifactManifest.find(m=>m.configuration===configuration&&m.split===split);
    const metrics=await load(manifest.path),original=await load(metrics.originalMetricsPath),truth=await load(`backend/data/work/xc2_robust_product_baseline_v1/${split.toLowerCase()}_benchmark.json`);
    const r2Archive=JSON.parse(gunzipSync(await readFile(manifest.auditPath))),r2ByScenario=new Map(r2Archive.audits.map(a=>[a.scenarioId,a.snapshot]));
    const r1Archive=JSON.parse(gunzipSync(await readFile(metrics.r1WitnessPath))),r1ByScenario=new Map();
    for(const v of r1Archive){if(!r1ByScenario.has(v.scenarioId))r1ByScenario.set(v.scenarioId,[]);r1ByScenario.get(v.scenarioId).push(v);}
    const origByScenario=new Map(original.audit.map(a=>[a.scenarioId,a])),raws=[];
    for(const clip of truth.clips){
      const p=`backend/data/work/xc2_robust_product_baseline_v1/raw/${split}_${c.resampler}_${c.ownedMs}_${c.futureMs}_1.20.1/${clip.clipId}.json`;
      const r=await load(p);validateArtifactDigest(r);raws.push(r);
    }
    const audits=[],targetWitnesses=new Map(),semanticChanges=[],assignmentChanges=[],ownershipChanges=[],mechanismCases=[];
    const candidate=evaluateProductVariant(raws,truth,'A',configuration,{replay:(scenario,publications)=>{
      const {snapshot,violations}=replayCandidate(scenario,publications),old=r2ByScenario.get(scenario.id),originalAudit=origByScenario.get(scenario.id);
      const candidateOwners=new Map(snapshot.observationConsumption.map(o=>[o.observationId,o]));
      const r1Strikes=originalAudit.lowLevel.strikes.map(s=>{
        const d=r2Archive.assignmentDifferences.find(d=>d.scenarioId===scenario.id&&d.strikeId===s.strikeId);
        return d?{...s,...d.r1}:s;
      });
      const originalOwners=ownerMap(originalAudit.lowLevel.strikes,originalAudit.verdicts),r1Owners=ownerMap(r1Strikes,r1ByScenario.get(scenario.id));
      const r2Owners=new Map(old.observationConsumption.map(o=>[o.observationId,o]));
      const maps={original:new Map(originalAudit.lowLevel.strikes.map(s=>[s.strikeId,s])),r1:new Map(r1Strikes.map(s=>[s.strikeId,s])),r2:new Map(old.lowLevel.strikes.map(s=>[s.strikeId,s]))};
      for(const s of snapshot.lowLevel.strikes)if(Object.values(maps).some(m=>sig(m.get(s.strikeId))!==sig(s)))assignmentChanges.push({scenarioId:scenario.id,strikeId:s.strikeId,
        original:maps.original.get(s.strikeId),r1:maps.r1.get(s.strikeId),r2:maps.r2.get(s.strikeId),candidate:s});
      for(const [policy,owners]of Object.entries({original:originalOwners,r1:r1Owners,r2:r2Owners}))for(const d of ownerDiff(owners,candidateOwners)){
        ownershipChanges.push({scenarioId:scenario.id,referencePolicy:policy,...d,
          candidateVerdictWitness:snapshot.verdicts.find(v=>v.groupId===d.candidate?.owner||v.id===d.candidate?.owner)?.witness??null});
      }
      for(const v of snapshot.verdicts.filter(v=>v.groupId)){
        const oldV=old.verdicts.find(w=>w.groupId===v.groupId);
        if(oldV.verdict!==v.verdict)semanticChanges.push({scenarioId:scenario.id,groupId:v.groupId,r2:oldV,candidate:v});
        for(const r of oldV.witness.reservedLocalEvidenceNotConsumed??[]){
          const finalOwner=r2Owners.get(r.observationId);
          if(finalOwner?.disposition!=='MATCHED')mechanismCases.push({scenarioId:scenario.id,groupId:v.groupId,observationId:r.observationId,
            r2FinalizedAt:oldV.finalizationTimeMs,r2Verdict:oldV.verdict,r2FinalOwner:finalOwner,candidateVerdict:v,
            candidateFinalOwner:candidateOwners.get(r.observationId),candidateWaitedUntilClaimantsResolved:(v.witness.reservedLocalEvidenceNotConsumed??[]).length===0});
        }
      }
      for(const groupId of scenario.targetGroupIds)targetWitnesses.set(`${scenario.id}:${groupId}`,snapshot.verdicts.find(v=>v.groupId===groupId));
      for(const extra of scenario.targetExtra){
        const obs=publications.flatMap(p=>p.observations).filter(o=>o.pitch===extra.pitch&&Math.abs(o.performanceTimeMs-extra.timeMs)<=50);
        targetWitnesses.set(`${scenario.id}:${extra.id}`,{kind:'COUNTERFACTUAL_EXTRA_TARGET_AUDIT_NOT_SECOND_OWNER',target:extra,
          candidates:obs.map(o=>({observation:o,semanticOwner:candidateOwners.get(o.observationId)}))});
      }
      audits.push({scenarioId:scenario.id,snapshot,violations});return snapshot;
    }});
    const byTarget=new Map(candidate.targetRows.map(r=>[r.id,r]));
    const rows=metrics.targetCases.map(r=>{
      const n=byTarget.get(r.targetId);if(!n||r.truth!==n.truth)throw new Error('XC8_FIXED_ORACLE_TARGET_CHANGED');
      return{...r,candidate:n.predicted,candidateLatencyMs:n.latencyMs,candidateWitness:targetWitnesses.get(r.targetId),
        recoveredVsR2:r.r2!==r.truth&&n.predicted===r.truth,newRegressionVsR2:r.r2===r.truth&&n.predicted!==r.truth};
    });
    const references={original:metrics.original,r1:metrics.r1ImmutableReference,r2:metrics.r2,candidate:compactProduct(candidate)};
    const safety=Object.fromEntries(Object.entries(references).map(([p,m])=>[p,{wrongFalseCorrect:m.counts.wrongFalseCorrect,
      missingFalseMatched:m.counts.missingFalseMatched,incompleteFalseComplete:m.counts.incompleteFalseComplete}]));
    const auditTotals=Object.fromEntries(Object.keys(audits[0].violations).map(k=>[k,audits.reduce((n,a)=>n+a.violations[k],0)]));
    const protectedIncrease=Object.keys(safety.r2).some(k=>safety.candidate[k]>safety.r2[k]);
    const auditPath=`${WORK}/${split}_${configuration}_audit.json.gz`;
    await writeFile(auditPath,gzipSync(Buffer.from(JSON.stringify({audits,semanticChanges,ownershipChanges,assignmentChanges,mechanismCases}))),{flag:'wx'});
    const report={phase:PHASE,classification:LABEL,configuration,split,freezeSha256:freeze.freezeSha256,
      policyMetrics:references,confusionMatrices:Object.fromEntries(Object.keys(references).map(p=>[p,confusion(rows,p)])),
      classConditionalDenominators:Object.fromEntries(CLASSES.map(k=>[k,rows.filter(r=>r.truth===k).length])),
      fixedTruthRows:rows,newRegressions:rows.filter(r=>r.newRegressionVsR2),recoveredRegressions:rows.filter(r=>r.recoveredVsR2),
      fixedTruthTransitions:Object.fromEntries(['original','r1','r2'].map(p=>[p,rows.filter(r=>r[p]!==r.candidate)])),
      logicalTargetLatencyIncludingWrongClass:Object.fromEntries(Object.keys(references).map(p=>[p,Object.fromEntries(CLASSES.map(k=>[k,
        latencySummary(rows.filter(r=>r.truth===k).map(r=>p==='candidate'?r.candidateLatencyMs:r[p+'LatencyMs']).filter(Number.isFinite))]))])),
      safetyCounters:safety,auditTotals,criticalIncreaseVsR2:protectedIncrease,
      assignmentChangeCounts:Object.fromEntries(['original','r1','r2'].map(p=>[p,assignmentChanges.filter(s=>sig(s[p])!==sig(s.candidate)).length])),
      ownershipChangeCounts:Object.fromEntries(['original','r1','r2'].map(p=>[p,ownershipChanges.filter(s=>s.referencePolicy===p).length])),
      allR2GroupVerdictChanges:semanticChanges,mechanismCases,
      horizon:{strikeMaxMs:Math.max(...audits.flatMap(a=>a.snapshot.strikeWitnesses.map(s=>s.unclampedRequiredFrontierMs-s.targetTimeMs))),
        groupMaxMs:Math.max(...audits.flatMap(a=>a.snapshot.verdicts.filter(v=>v.groupId).map(v=>v.witness.unclampedRequiredFrontierMs-v.performanceTimeMs))),
        extraMaxMs:Math.max(0,...audits.flatMap(a=>a.snapshot.verdicts.filter(v=>v.verdict==='EXTRA').map(v=>v.witness.unclampedRequiredFrontierMs-v.performanceTimeMs)))},
      auditPath,auditSha256:await fileSha(auditPath),neuralInferenceCount:0,midiFileReads:0,
      historicalRuntimeFields:'Copied historical receipts only; no runtime measurement or acoustic redecoding.',
      latencyInterpretation:'PolicyMetrics contains each original full class-conditional latency summary and count. The extra fixed-truth latency view copies R2 historical per-target R1 timestamps, which can be null where original EXTRA was not detected; it reports only finite recorded samples, not imputed values. Candidate uses identical frozen acoustic availability clocks.',
      acceptanceCell:{auditsClean:Object.values(auditTotals).every(n=>n===0),criticalIncrease:protectedIncrease,
        newEvaluationRegressions:split==='EVALUATION'?rows.filter(r=>r.newRegressionVsR2).length:0}};
    const path=`${WORK}/${split}_${configuration}_metrics.json`;await atomicJson(path,report);
    summary.push({configuration,split,path,sha256:await fileSha(path),auditPath,auditSha256:report.auditSha256,acceptance:report.acceptanceCell});
    console.log(JSON.stringify({configuration,split,agreements:Object.fromEntries(Object.entries(references).map(([p,m])=>[p,`${m.counts.agree}/${m.counts.targets}`])),
      newRegressions:report.newRegressions.length,recovered:report.recoveredRegressions.length,horizon:report.horizon,safety,auditTotals}));
  }
  await atomicJson(`${WORK}/replay_summary.json`,{phase:PHASE,classification:LABEL,proof,executionStartTimestamp,cells:summary,newNeuralInferenceCount:0,newDatasetCount:0});
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)await run();
