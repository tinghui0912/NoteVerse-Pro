import {beforeAll,expect,it} from 'vitest';
import {runTimingSemanticsAudit,assertTimingSemanticsAudit,type TimingSemanticsAudit} from './timing-semantics-audit';
let report:TimingSemanticsAudit;
// Workload budget for a finite research matrix, not a performance assertion or product threshold.
beforeAll(()=>{report=runTimingSemanticsAudit('2026-10-28T00:00:00.000Z');},60000);
it('reproduces the unchanged 10,003-case production baseline exactly before comparing candidates',()=>{
  expect(report.baselineCaseCount).toBe(10003);expect(report.candidateIds).toHaveLength(10);
  expect(report.comparison[0]).toEqual({policyId:'CURRENT_FIXED_MS',caseCount:10003,casesWithAssignmentDifference:0,
    targetStateDifferences:0,observationOwnerDifferences:0,ownershipClaimantCountDifferences:0,frontierDifferences:0});
  expect(report.comparison.slice(1).every(row=>row.casesWithAssignmentDifference>0)).toBe(true);
  expect(report.adversarial).toHaveLength(25);expect(report.tempoScaling).toHaveLength(32);
  expect(()=>assertTimingSemanticsAudit(JSON.parse(JSON.stringify(report)))).not.toThrow();
});
it('records eligibility, ownership and frontier rules instead of silently choosing a winner',()=>{
  for(const p of report.candidateDefinitions){expect(p.eligibility).toBeTruthy();expect(p.ownership).toBeTruthy();expect(p.decisionFrontier).toBeTruthy();expect(p.freeParameters).toBeInstanceOf(Array);}
  expect(report).not.toHaveProperty('recommendedProductionPolicy');
});
it.each(['version','kind','unknown','policy','number','negative-count','candidate'] as const)('research artifact rejects corrupt %s without repair',field=>{
  const x=JSON.parse(JSON.stringify(report));
  if(field==='version')x.schemaVersion=2;else if(field==='kind')x.benchmarkKind='RESULT';else if(field==='unknown')x.extra=true;
  else if(field==='policy')x.productionPolicyIdentity='other';else if(field==='number')x.adversarial[0].outcomes[0].targets[0].latencyMs=NaN;
  else if(field==='negative-count')x.comparison[0].caseCount=-1;else x.candidateIds[0]='other';
  const before=structuredClone(x);expect(()=>assertTimingSemanticsAudit(x)).toThrow('TIMING_AUDIT_REPORT_INVALID');expect(x).toEqual(before);
});
