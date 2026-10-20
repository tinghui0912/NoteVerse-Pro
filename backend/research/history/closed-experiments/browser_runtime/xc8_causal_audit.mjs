import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {atomicJson,fileSha} from './xc1_artifacts.mjs';

export const PHASE='PHASE_9G_XC8_BOUNDED_PRODUCT_FINALIZER_MECHANISTIC_QUALIFICATION';
export const START='4f640d6c6ce7ea8ead93f3dc1881be73fd7740ef';
export const REPORTS='backend/research/reports';
export const WORK='backend/data/work/xc8_finalizer';
export const LABEL='POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION';
export const load=async p=>JSON.parse(await readFile(p,'utf8'));
export const AUDIT=`${REPORTS}/phase9g_xc8_causal_inventory_complete_2026-10-16.json`;
const r2path=n=>`${REPORTS}/phase9g_xc2_r2_${n}_2026-10-16.json`;
export async function runAudit(){
  // Full JSON parses, including all assignment disagreements, not excerpts/search snippets.
  const r2=await load(r2path('direct_conflict_final'));
  const interpretation=await load(r2path('regression_interpretation'));
  const disagreements=await load(r2path('assignment_disagreements'));
  const originalReport=await load(`${REPORTS}/phase9g_xc2_product_verdict_latency_final_2026-10-16.json`);
  const inputIds=[];
  async function identity(path){const row={path,sha256:await fileSha(path)};if(!inputIds.some(r=>r.path===path))inputIds.push(row);}
  const readPaths=['backend/research/browser_runtime/xc2_r1_bounded_finalizer.mjs',
    'backend/research/browser_runtime/xc2_r2_direct_conflict_finalizer.mjs',
    'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts',
    ...['direct_conflict_final','regression_interpretation','assignment_disagreements'].map(r2path),
    ...['bounded_runtime_final','evidence_interpretation','natural_residual_and_paired_latency','policy_freeze','bounded_witness_manifest']
      .map(n=>`${REPORTS}/phase9g_xc2_r1_${n}_2026-10-16.json`)];
  for(const p of readPaths){const text=await readFile(p,'utf8');if(p.endsWith('.json'))JSON.parse(text);await identity(p);}
  const cells=[];
  for(const manifest of r2.artifactManifest){
    for(const p of [manifest.path,manifest.auditPath])await identity(p);
    if(await fileSha(manifest.path)!==manifest.sha256||await fileSha(manifest.auditPath)!==manifest.auditSha256)throw new Error('XC8_R2_ARCHIVE_DRIFT');
    const metrics=await load(manifest.path),archive=JSON.parse(gunzipSync(await readFile(manifest.auditPath)));
    const benchmarkPath=`backend/data/work/xc2_robust_product_baseline_v1/${manifest.split.toLowerCase()}_benchmark.json`;
    await identity(benchmarkPath);const benchmark=await load(benchmarkPath);
    const audits=new Map(archive.audits.map(a=>[a.scenarioId,a.snapshot]));
    const targets=metrics.targetCases,inventory=[],observations=new Map();
    const config=originalReport.ort120Main.candidates.find(c=>c.id===manifest.configuration);
    for(const clip of benchmark.clips){
      const rawPath=`backend/data/work/xc2_robust_product_baseline_v1/raw/${manifest.split}_${config.resampler}_${config.ownedMs}_${config.futureMs}_1.20.1/${clip.clipId}.json`;
      await identity(rawPath);const raw=await load(rawPath);
      for(const p of raw.publications.A)for(const o of p.observations)observations.set(o.observationId,{...o,
        pitch:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][o.pitch%12]+(Math.floor(o.pitch/12)-1),
        publicationId:p.publicationId,publicationFrontierMs:p.analyzedThroughPerformanceMs,availabilityTimeMs:p.availabilityTimeMs});
    }
    for(const c of targets.filter(c=>c.original!==c.r2||c.r1!==c.r2)){
      const scenario=benchmark.clips.flatMap(c=>c.scenarios).find(s=>c.targetId.startsWith(s.id+':'));
      if(!scenario)throw new Error('XC8_TARGET_SCENARIO_NOT_FOUND');
      const snapshot=audits.get(scenario.id),targetGroup=scenario.targetGroupIds.find(id=>c.targetId===scenario.id+':'+id);
      const v=snapshot.verdicts.find(v=>v.groupId===targetGroup);
      const reservations=v?.witness.reservedLocalEvidenceNotConsumed??[];
      const resolved=reservations.map(r=>{
        const owner=snapshot.observationConsumption.find(o=>o.observationId===r.observationId)??null;
        const witnesses=r.eligibleUncommittedStrikeIds.map(id=>snapshot.strikeWitnesses.find(s=>s.strikeId===id));
        const changes=snapshot.reservationChanges.filter(x=>x.observationId===r.observationId);
        return{...r,finalSemanticOwner:owner,claimantCommitWitnesses:witnesses,reservationChanges:changes,
          resolution:'MATCHED'===owner?.disposition?'CONSUMED_BY_DIRECT_CORRECT_OWNER':'RELEASED_NOT_MATCHED',
          claimantCommitAfterGroup: witnesses.some(w=>w.availabilityTimeMs>v.finalizationTimeMs)};
      });
      let category='OTHER_ASSIGNMENT_OR_GROUP_OWNERSHIP_CHANGE';
      if(c.truth==='EXTRA'){
        const candidates=c.r2CausalWitness.candidates??[];
        category=candidates.some(o=>o.semanticOwner?.disposition==='WRONG')?'SINGLE_OWNER_COUNTERFACTUAL_EXTRA_WRONG_CONFLICT':
          candidates.some(o=>o.semanticOwner?.disposition==='MATCHED')?'EXTRA_EVIDENCE_LEGALLY_MATCHED':
          candidates.some(o=>o.semanticOwner?.disposition==='EXTRA')?'EXTRA_RECOVERY_FROM_R1_SINGLE_OWNER_PRESERVED':
          candidates.length?'EXTRA_SCORING_AMBIGUITY':'EXTRA_NO_AVAILABLE_ACOUSTIC_EVIDENCE';
      }else if(resolved.some(r=>r.resolution==='RELEASED_NOT_MATCHED'&&r.claimantCommitAfterGroup))category='RESERVATION_RELEASE_AFTER_GROUP_FINALIZATION';
      else if(resolved.length&&resolved.every(r=>r.finalSemanticOwner?.disposition==='MATCHED'))category='DIRECT_CORRECT_OWNER_CONSUMED_EVIDENCE';
      const expected=scenario.expected.map((s,i)=>({...s,time:scenario.beatPositions[i]*60000/scenario.fixedBpm}));
      const localEvidence=(v?.witness.directConflict?.localIncompatibleObservationIds??[]).map(id=>{
        const o=observations.get(id),owner=snapshot.observationConsumption.find(r=>r.observationId===id)??null;
        const ownerVerdict=snapshot.verdicts.find(r=>r.groupId===owner?.owner)??null;
        const ownerStrike=snapshot.strikeWitnesses.find(r=>r.strikeId===owner?.owner)??null;
        const claimants=snapshot.lowLevel.strikes.filter(s=>s.pitch===o.pitch&&Math.abs(s.expectedPerformanceTimeMs-o.performanceTimeMs)<=250);
        return{observation:o,finalSemanticOwner:owner,ownerVerdict,ownerStrike,
          directCorrectClaimants:claimants.map(s=>({strikeId:s.strikeId,groupId:s.groupId,pitch:s.pitch,time:s.expectedPerformanceTimeMs,
            finalVerdict:s.verdict,matchedObservationId:s.matchedObservationId??null,commitWitness:snapshot.strikeWitnesses.find(w=>w.strikeId===s.strikeId)})),
          reservationHistory:snapshot.reservationChanges.filter(r=>r.observationId===id)};
      });
      if(!resolved.length&&localEvidence.some(o=>o.finalSemanticOwner?.disposition==='WRONG'&&o.finalSemanticOwner.owner!==targetGroup))category='COMPETING_WRONG_OWNER_ALLOCATION';
      else if(!resolved.length&&localEvidence.length&&localEvidence.every(o=>o.finalSemanticOwner?.disposition==='MATCHED'))category='DIRECT_CORRECT_OWNER_CONSUMED_EVIDENCE';
      const extraCandidates=c.truth==='EXTRA'?(c.r2CausalWitness.candidates??[]).map(o=>{
        const g=expected.filter(s=>s.groupId===o.semanticOwner?.owner);
        const first=g.length?Math.min(...g.map(s=>s.time)):null;
        return{...o,ownerExpectedStrikes:g,ownerVerdict:snapshot.verdicts.find(v=>v.groupId===o.semanticOwner?.owner)??null,
          temporalAssociationDistanceMs:first===null?null:Math.abs(first-o.performanceTimeMs)};
      }):[];
      inventory.push({...c,scenarioId:scenario.id,targetGroup:targetGroup??null,category,resolvedReservations:resolved,localEvidence,
        r2FinalVerdict:v??null,extraCandidates,groupExpectedStrikes:expected.filter(s=>s.groupId===targetGroup),
        relevantAssignmentDisagreements:disagreements.cells.find(x=>x.configuration===manifest.configuration&&x.split===manifest.split)
          .assignmentDisagreements.filter(x=>x.scenarioId===scenario.id&&x.groupId===targetGroup)});
    }
    const reservationResolutionInventory=[];let reservedGroups=0,consumedByCorrect=0;
    for(const a of archive.audits)for(const v of a.snapshot.verdicts){
      const reserved=v.witness.reservedLocalEvidenceNotConsumed??[];if(reserved.length)reservedGroups++;
      for(const r of reserved){
        const owner=a.snapshot.observationConsumption.find(o=>o.observationId===r.observationId)??null;
        if(owner?.disposition==='MATCHED'){consumedByCorrect++;continue;}
        reservationResolutionInventory.push({scenarioId:a.scenarioId,groupId:v.groupId,groupVerdict:v.verdict,
          observation:observations.get(r.observationId),atGroupFinalization:r,groupFinalizationWitness:v.witness,
          claimantResolutions:r.eligibleUncommittedStrikeIds.map(id=>a.snapshot.strikeWitnesses.find(s=>s.strikeId===id)),
          eventualOwner:owner,reservationChanges:a.snapshot.reservationChanges.filter(x=>x.observationId===r.observationId),
          targetGroup:benchmark.clips.flatMap(c=>c.scenarios).find(s=>s.id===a.scenarioId).targetGroupIds.includes(v.groupId),
          classification:'CONFIRMED_RESERVED_LOCAL_EVIDENCE_RELEASE_AFTER_IRREVERSIBLE_GROUP_CLOSURE'});
      }
    }
    const ownershipViolations=archive.audits.filter(a=>{
      const ids=a.snapshot.observationConsumption.map(o=>o.observationId);
      const consumed=a.snapshot.verdicts.flatMap(v=>v.consumedObservationIds);
      return new Set(ids).size!==ids.length||new Set(consumed).size!==consumed.length;
    }).length;
    cells.push({configuration:manifest.configuration,split:manifest.split,targets:targets.length,inventory,
      categoryCounts:Object.fromEntries([...new Set(inventory.map(x=>x.category))].sort().map(k=>[k,inventory.filter(x=>x.category===k).length])),
      ownershipViolations,archivedScenarioCount:archive.audits.length,reservedGroups,consumedByCorrect,reservationResolutionInventory,
      assignmentDisagreementCount:disagreements.cells.find(x=>x.configuration===manifest.configuration&&x.split===manifest.split).assignmentDisagreements.length});
  }
  const report={phase:PHASE,startingHead:START,classification:LABEL,inputs:inputIds,cells,
    priorR1Conclusion:'BOUNDED_FINALIZATION_HAS_SAFETY_TRADEOFF',priorR2Conclusion:r2.conclusion,
    priorInterpretation:interpretation.interpretation,newNeuralInferenceCount:0,newDatasetCount:0,
    interpretation:'Reservation-release cases are policy candidates. Legally MATCHED evidence cannot be stolen; WRONG-vs-synthetic-EXTRA conflicts cannot be repaired by duplicating an observation.',
    hypothesisSupport:'Background EVALUATION verdicts contain reserved local observations released after group closure. Known target regressions have different causes: competing WRONG allocation or legal MATCHED ownership, not the proposed premature-release mechanism. No claim that this hypothesis repairs all R2 target errors.',
    auditScope:'All target changes against original or R1 in the four existing R2 cells; full historical reports/assignment archives parsed. No new policy replay.'};
  await atomicJson(AUDIT,report);
  console.log(JSON.stringify(cells.map(c=>({configuration:c.configuration,split:c.split,categories:c.categoryCounts,
    releasedBackgroundInstances:c.reservationResolutionInventory.length,ownershipViolations:c.ownershipViolations})),null,2));
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)await runAudit();
