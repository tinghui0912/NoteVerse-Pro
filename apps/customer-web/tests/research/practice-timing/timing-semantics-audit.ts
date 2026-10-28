import { runSyntheticBenchmark } from './policy-benchmark';
import type { SyntheticReport } from './research-report';
import { productionPolicy } from './production-policy';
import { candidatePolicies, candidateDefinition, characterizeCandidate, type AuditOutcome } from './candidate-policies';
import { adversarialScenarios, fromBaseline, tempoScalingScenarios } from './timing-audit-workloads';
import { matcherProof } from './matcher-proof';

function compareBaseline(baseline:SyntheticReport) {
  const rows=candidatePolicies.map(p=>({policyId:p.id,caseCount:baseline.caseCount,casesWithAssignmentDifference:0,
    targetStateDifferences:0,observationOwnerDifferences:0,ownershipClaimantCountDifferences:0,frontierDifferences:0}));
  for(const c of baseline.cases) {
    const s=fromBaseline(c),current=characterizeCandidate(s,candidatePolicies[0]);
    const originalOwners=new Map(c.observations.map(o=>[o.observationId,o.assignedStrikeId]));
    const originalMatched=new Set(c.observations.flatMap(o=>o.assignedStrikeId?[o.assignedStrikeId]:[]));
    for(const [i,p] of candidatePolicies.entries()) {
      const outcome=i===0?current:characterizeCandidate(s,p),row=rows[i];let changed=false;
      for(const t of outcome.targets)if((t.state==='MATCHED')!==originalMatched.has(t.id)){row.targetStateDifferences++;changed=true;}
      for(const o of outcome.events){
        if(o.assignedTargetId!==originalOwners.get(o.id)){row.observationOwnerDifferences++;changed=true;}
        if(o.ownershipClaimants!==c.observations.find(x=>x.observationId===o.id)!.claimantCount)row.ownershipClaimantCountDifferences++;
      }
      for(const t of outcome.targets)if(t.requiredFrontierMs!==current.targets.find(x=>x.id===t.id)!.requiredFrontierMs)row.frontierDifferences++;
      if(changed)row.casesWithAssignmentDifference++;
    }
  }
  return rows;
}
function auditScenarios() {
  return adversarialScenarios().map(s=>({id:s.id,geometry:s,targetOnsetsMs:s.targets.map(t=>t.expectedPerformanceTimeMs),
    eventTimesMs:s.events.map(o=>o.timeMs),terminalMs:s.terminalMs,outcomes:candidatePolicies.map(p=>characterizeCandidate(s,p))}));
}
function auditTempoScaling() {
  return tempoScalingScenarios().map(s=>({scenarioId:s.id,geometry:s,bpm:Number(s.id.split('/')[1]),offsetBeats:Number(s.id.split('/')[2]),
    outcomes:candidatePolicies.map(p=>characterizeCandidate(s,p))}));
}
export function runTimingSemanticsAudit(generatedAt=new Date().toISOString()) {
  const baseline=runSyntheticBenchmark(generatedAt);
  return {schemaVersion:1 as const,benchmarkKind:'CONTINUOUS_TIMING_SEMANTICS_AUDIT' as const,generatedAt,
    productionPolicyIdentity:productionPolicy.productionPolicyIdentity,assignmentWindowMs:productionPolicy.assignmentWindowMs,
    baselineCaseCount:baseline.caseCount,candidateDefinitions:candidatePolicies.map(candidateDefinition),candidateIds:candidatePolicies.map(p=>p.id),comparison:compareBaseline(baseline),
    adversarial:auditScenarios(),tempoScaling:auditTempoScaling(),proof:matcherProof(),
    limitations:['Synthetic differences are policy behavior, not learner accuracy.',
      'No score-aligned external corpus, device latency or learner tolerance qualification was performed.',
      'Current finalizer frontiers are its direct-cohort commit contract, not a theorem about arbitrary batch-global assignment.',
      'Overlapping variable-radius candidates use conservative full connected-component coverage; unique candidates use interval right edges.']};
}
export type TimingSemanticsAudit=ReturnType<typeof runTimingSemanticsAudit>;
/** Independent research artifact only: current version/kind/keys, finite JSON numbers, known policies. No migration. */
export function assertTimingSemanticsAudit(value:unknown):asserts value is TimingSemanticsAudit {
  const x=value as TimingSemanticsAudit;
  const keys=['schemaVersion','benchmarkKind','generatedAt','productionPolicyIdentity','assignmentWindowMs','baselineCaseCount',
    'candidateDefinitions','candidateIds','comparison','adversarial','tempoScaling','proof','limitations'];
  if(!x||typeof x!=='object'||Object.keys(x).sort().join()!==keys.sort().join()||x.schemaVersion!==1
    ||x.benchmarkKind!=='CONTINUOUS_TIMING_SEMANTICS_AUDIT'||!Number.isFinite(Date.parse(x.generatedAt))
    ||x.productionPolicyIdentity!==productionPolicy.productionPolicyIdentity||x.assignmentWindowMs!==productionPolicy.assignmentWindowMs
    ||!Number.isSafeInteger(x.baselineCaseCount)||x.baselineCaseCount<0
    ||JSON.stringify(x.candidateIds)!==JSON.stringify(candidatePolicies.map(p=>p.id))
    ||JSON.stringify(x.candidateDefinitions)!==JSON.stringify(candidatePolicies.map(candidateDefinition))
    ||!Array.isArray(x.comparison)||x.comparison.length!==candidatePolicies.length||!Array.isArray(x.adversarial)
    ||!Array.isArray(x.tempoScaling)||!Array.isArray(x.limitations)||!x.proof)throw Error('TIMING_AUDIT_REPORT_INVALID');
  const visit=(v:unknown):void=>{
    if(typeof v==='number'&&!Number.isFinite(v)||v===undefined)throw Error('TIMING_AUDIT_REPORT_INVALID');
    if(v&&typeof v==='object')for(const child of Object.values(v))visit(child);
  };visit(x);
  for(const row of x.comparison)if(!candidatePolicies.some(p=>p.id===row.policyId)||Object.entries(row).some(([key,v])=>key!=='policyId'&&(!Number.isSafeInteger(v)||Number(v)<0)))throw Error('TIMING_AUDIT_REPORT_INVALID');
}
export function outcomeSignature(outcome:AuditOutcome) {
  return {states:outcome.targets.map(t=>t.state),owners:outcome.events.map(o=>o.assignedTargetId),claimants:outcome.events.map(o=>o.ownershipClaimants)};
}
