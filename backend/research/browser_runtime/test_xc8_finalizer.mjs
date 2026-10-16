import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectClaimantCommitFinalizer as Ledger,XC8_POLICY} from './xc8_direct_claimant_commit_finalizer.mjs';
import {DirectConflictReservationFinalizer as R2} from './xc2_r2_direct_conflict_finalizer.mjs';

const strike=(id,t,pitch='C4',groupId=id)=>({strikeId:id,groupId,pitch,expectedPerformanceTimeMs:t,renderNoteIds:[]});
const obs=(id,t,pitch='C4')=>({observationId:id,performanceTimeMs:t,pitch,confidence:.8});
const pub=(id,f,observations=[],availability=f+100)=>({publicationId:id,analyzedThroughPerformanceMs:f,availabilityTimeMs:availability,observations});
const verdict=(l,g)=>l.snapshot().verdicts.find(v=>v.groupId===g);
function finish(l,f=4000){return l.completeNaturalScope(f,f+100);}
function audit(l){
  const s=l.snapshot(),owners=s.observationConsumption.map(o=>o.observationId),used=s.verdicts.flatMap(v=>v.consumedObservationIds);
  assert.equal(new Set(owners).size,owners.length);assert.equal(new Set(used).size,used.length);
  for(const v of s.verdicts){assert.ok(v.witness.requiredAnalysisFrontierMs<=v.witness.enablingAnalysisFrontierMs);
    assert.ok(v.witness.unclampedRequiredFrontierMs<=v.performanceTimeMs+(v.verdict==='EXTRA'?1500:1250)+1e-8);}
  return s;
}
test('simple correct',()=>{const l=new Ledger([strike('a',1000)]);l.publish(pub('p',1250,[obs('o',1000)]));assert.equal(verdict(l,'a').verdict,'CORRECT');audit(l);});
test('simple missing',()=>{const l=new Ledger([strike('a',1000)]);l.publish(pub('p',1250));assert.equal(verdict(l,'a').verdict,'MISSING');});
test('simple wrong',()=>{const l=new Ledger([strike('a',1000)]);l.publish(pub('p',1250,[obs('o',1000,'D4')]));assert.equal(verdict(l,'a').verdict,'WRONG');audit(l);});
test('incomplete chord',()=>{const l=new Ledger([strike('a',1000,'C4','g'),strike('b',1010,'E4','g')]);l.publish(pub('p',1260,[obs('o',1000)]));assert.equal(verdict(l,'g').verdict,'INCOMPLETE_CHORD');});
test('extra with no claims',()=>{const l=new Ledger([]);l.publish(pub('p',1000,[obs('o',900)]));assert.equal(l.snapshot().verdicts[0].verdict,'EXTRA');});
test('same pitch repeated strikes keep distinct owners',()=>{const l=new Ledger([strike('a',1000),strike('b',1200)]);l.publish(pub('p',1450,[obs('x',1000),obs('y',1200)]));assert.equal(l.snapshot().observationConsumption.length,2);assert.equal(verdict(l,'a').verdict,'CORRECT');assert.equal(verdict(l,'b').verdict,'CORRECT');audit(l);});
test('two direct competing strikes commit anchors only at their own H',()=>{
  const l=new Ledger([strike('a',1000),strike('b',1400),strike('c',1800)]);
  l.publish(pub('p',1650,[obs('x',1000),obs('y',1400)]));assert.equal(verdict(l,'a').verdict,'CORRECT');assert.equal(verdict(l,'b'),undefined);
  assert.equal(l.snapshot().lowLevel.strikes.find(s=>s.id==='b').verdict,'PENDING');
});
const reservedFixture=()=>[strike('g',1000),strike('claim',1400,'D4'),strike('next',1800,'D4'),strike('second-hop',2200,'D4')];
test('reserved wrong evidence later consumed by direct correct claimant cannot be stolen',()=>{
  const l=new Ledger(reservedFixture());l.publish(pub('a',1700,[obs('reserved',1200,'D4')]));assert.equal(verdict(l,'g'),undefined);
  l.publish(pub('b',2050));assert.equal(verdict(l,'g').verdict,'MISSING');
  assert.deepEqual(l.snapshot().observationConsumption.find(o=>o.observationId==='reserved'),{observationId:'reserved',disposition:'MATCHED',owner:'claim'});audit(l);
});
test('released reservation becomes WRONG after claimant commits a different observation',()=>{
  const expected=reservedFixture(),r2=new R2(expected),l=new Ledger(expected),p=pub('a',1700,[obs('reserved',1200,'D4'),obs('better',1410,'D4')]);
  r2.publish(p);l.publish(p);assert.equal(verdict(r2,'g').verdict,'MISSING');assert.equal(verdict(l,'g'),undefined);
  l.publish(pub('b',2050));assert.equal(verdict(l,'g').verdict,'WRONG');assert.deepEqual(verdict(l,'g').evidenceObservationIds,['reserved']);
  assert.equal(l.snapshot().observationConsumption.find(o=>o.observationId==='better').owner,'claim');audit(l);
});
test('current group waits only for the direct claimant own fixed commit',()=>{
  const l=new Ledger(reservedFixture());l.publish(pub('a',1700,[obs('r',1200,'D4'),obs('b',1410,'D4')]));
  const h=l.groupHorizon(l.groups.get('g'));assert.equal(h.required,2050);assert.deepEqual(h.directCorrectClaimantIds,['claim']);
  l.publish(pub('b',2050));assert.equal(verdict(l,'g').witness.requiredAnalysisFrontierMs,2050);
  assert.equal(l.snapshot().lowLevel.strikes.find(s=>s.id==='next').verdict,'PENDING');
});
test('competitor-of-competitor cannot recursively extend the group',()=>{
  const a=new Ledger(reservedFixture()),b=new Ledger([...reservedFixture(),strike('distant',2600,'D4')]);
  for(const l of[a,b])l.publish(pub('p',1700,[obs('r',1200,'D4'),obs('b',1410,'D4')]));
  assert.equal(a.groupHorizon(a.groups.get('g')).required,b.groupHorizon(b.groups.get('g')).required);
});
test('100-strike overlap chain cannot enlarge first same-pitch or claimant-group horizon',()=>{
  const bounds=[];
  for(const n of[10,100,150]){
    const chain=Array.from({length:n},(_,i)=>strike(`d${String(i).padStart(3,'0')}`,1400+i*200,'D4'));
    const l=new Ledger([strike('g',1000),...chain]);l.publish(pub('p',1700,[obs('r',1200,'D4'),obs('b',1410,'D4')]));
    bounds.push(l.groupHorizon(l.groups.get('g')).required);l.publish(pub('q',2050));
    // At200ms spacing, both observations legitimately match different direct
    // strikes under maximum cardinality; they must NOT be recycled as WRONG.
    assert.equal(verdict(l,'g').verdict,'MISSING');
    assert.equal(l.snapshot().strikeWitnesses.find(s=>s.strikeId==='d000').unclampedRequiredFrontierMs,2050);
  }
  assert.deepEqual(bounds,[2050,2050,2050]);
});
test('one observation cannot become WRONG and EXTRA',()=>{const l=new Ledger([strike('g',1000)]);l.publish(pub('p',1500,[obs('o',1000,'D4')]));finish(l);const s=audit(l);assert.equal(s.observationConsumption.length,1);assert.equal(s.observationConsumption[0].disposition,'WRONG');assert.equal(s.verdicts.filter(v=>v.verdict==='EXTRA').length,0);});
test('two groups cannot consume same WRONG evidence',()=>{const l=new Ledger([strike('a',1000),strike('b',1100)]);l.publish(pub('p',1900,[obs('o',1050,'D4')]));finish(l);assert.equal(audit(l).observationConsumption.length,1);assert.equal(l.snapshot().verdicts.filter(v=>v.verdict==='WRONG').length,1);});
test('finalized verdict immutable and late evidence rejected',()=>{
  const l=new Ledger([strike('g',1000)]);l.publish(pub('a',1250));const saved=JSON.stringify(l.snapshot().verdicts);
  assert.throws(()=>{l.snapshot().verdicts[0].verdict='WRONG';},TypeError);l.publish(pub('b',1500));assert.equal(JSON.stringify(l.snapshot().verdicts),saved);
  assert.throws(()=>l.publish(pub('c',1600,[obs('late',1000)])),/BOUNDED_LATE_EVIDENCE/);assert.equal(JSON.stringify(l.snapshot().verdicts),saved);
});
test('terminal natural completion closes all reservations with explicit clamp',()=>{
  const l=new Ledger(reservedFixture());l.publish(pub('p',1500,[obs('r',1200,'D4'),obs('b',1410,'D4')]));
  const s=l.completeNaturalScope(1500,1600);assert.equal(s.provisionalReservations.length,0);assert.equal(s.pendingObservationIds.length,0);
  assert.ok(s.verdicts.some(v=>v.witness.terminalClamp));assert.ok(s.lowLevel.strikes.every(v=>v.verdict!=='PENDING'));audit(l);
});
test('manual stop preserves NOT_REACHED versus locally closed MISSING',()=>{
  const l=new Ledger([strike('closed',500),strike('future',1400)]);l.publish(pub('p',1000));const s=l.completeManualScope(1000,1100);
  assert.equal(s.lowLevel.strikes.find(v=>v.id==='closed').verdict,'MISSING');assert.equal(s.lowLevel.strikes.find(v=>v.id==='future').verdict,'NOT_REACHED');
  assert.equal(verdict(l,'future'),undefined);assert.equal(s.provisionalReservations.length,0);
});
test('duplicate publications are idempotent; mutations and duplicate observation identities rejected',()=>{
  const l=new Ledger([strike('g',1000)]),p=pub('p',1250,[obs('o',1000)]);const a=l.publish(p);assert.deepEqual(l.publish(p),a);
  assert.throws(()=>l.publish({...p,availabilityTimeMs:1400}),/XC8_PUBLICATION_ID_MUTATION/);
  assert.throws(()=>new Ledger([]).publish(pub('a',1000,[obs('o',800),obs('o',900)])),/BOUNDED_INVALID_OBSERVATION/);
  const n=new Ledger([]);n.publish(pub('a',1000,[obs('o',800)]));assert.throws(()=>n.publish(pub('b',1100,[obs('o',801)])),/BOUNDED_ID_MUTATION/);
});
test('stable deterministic tie',()=>{
  const l=new Ledger([strike('a',1000),strike('b',1100)]);l.publish(pub('p',1400,[obs('y',1050),obs('x',1050)]));
  assert.equal(l.snapshot().lowLevel.strikes.find(s=>s.id==='a').matchedObservationId,'x');
});
test('observation array permutation leaves byte-identical complete output',()=>{
  const run=reverse=>{const l=new Ledger([strike('a',1000),strike('b',1100)]),observations=[obs('y',1050),obs('x',1050),obs('wrong',1000,'D4')];
    l.publish(pub('p',1400,reverse?observations.reverse():observations));return JSON.stringify(finish(l));};
  assert.equal(run(false),run(true));
});
test('inclusive assignment endpoints and exact500ms competitor boundary',()=>{
  for(const time of[750,1250]){const l=new Ledger([strike('a',1000)]);l.publish(pub('p',1250,[obs('o',time)]));assert.equal(verdict(l,'a').verdict,'CORRECT');}
  const a=new Ledger([strike('a',1000),strike('b',1500)]),b=new Ledger([strike('a',1000),strike('b',1500.001)]);
  assert.equal(a.strikes.find(s=>s.id==='a').directRequiredFrontierMs,1750);assert.equal(b.strikes.find(s=>s.id==='a').directRequiredFrontierMs,1250);
});
test('a released observation with no direct claimant has finite EXTRA closure',()=>{
  const l=new Ledger([strike('g',1000)]);l.publish(pub('p',1600,[obs('outside',1500,'D4')]));
  assert.equal(l.snapshot().verdicts.find(v=>v.id==='outside').verdict,'EXTRA');finish(l);audit(l);
});
test('unchanged frozen constants and unsupported group spread fails closed',()=>{
  assert.deepEqual([XC8_POLICY.wMs,XC8_POLICY.strikeBoundMs,XC8_POLICY.groupBoundMs,XC8_POLICY.extraBoundMs],[250,750,1250,1500]);
  assert.throws(()=>new Ledger([strike('a',1000,'C4','g'),strike('b',1030,'E4','g')]),/XC8_GROUP_SPREAD/);
});
test('matched evidence cannot also be WRONG or EXTRA',()=>{
  const l=new Ledger([strike('correct',1000,'D4'),strike('missing',1000,'C4')]);
  l.publish(pub('p',1500,[obs('o',1000,'D4')]));finish(l);
  const s=audit(l);assert.deepEqual(s.observationConsumption,[{observationId:'o',disposition:'MATCHED',owner:'correct'}]);
  assert.equal(verdict(l,'missing').verdict,'MISSING');assert.equal(s.verdicts.filter(v=>v.verdict==='EXTRA').length,0);
});
test('terminal state rejects new publications and terminal identity changes',()=>{
  const l=new Ledger([]);l.publish(pub('p',1000));const before=finish(l,1000);
  assert.deepEqual(finish(l,1000),before);assert.throws(()=>l.publish(pub('new',1200)),/XC8_PUBLICATION_AFTER_TERMINAL/);
  assert.throws(()=>l.completeNaturalScope(1100,1200),/XC8_TERMINAL_IDENTITY_MUTATION/);
});
test('complete chord and exact enabling-publication timestamps',()=>{
  const l=new Ledger([strike('a',1000,'C4','g'),strike('b',1010,'E4','g')]);
  l.publish(pub('p',1260,[obs('a',1000),obs('b',1010,'E4')],1800));
  const v=verdict(l,'g');assert.equal(v.verdict,'CORRECT');assert.equal(v.witness.requiredAnalysisFrontierMs,1260);
  assert.equal(v.finalizationTimeMs,1800);assert.equal(v.finalizationLatencyMs,800);audit(l);
});
test('provisional reservations are eligibility only, never semantic owners',()=>{
  const l=new Ledger(reservedFixture());l.publish(pub('p',1700,[obs('r',1200,'D4'),obs('b',1410,'D4')]));const s=l.snapshot();
  assert.ok(s.provisionalReservations.length>0);
  for(const r of s.provisionalReservations){assert.equal(r.semanticDisposition,null);assert.equal(s.observationConsumption.some(o=>o.observationId===r.observationId),false);}
});
