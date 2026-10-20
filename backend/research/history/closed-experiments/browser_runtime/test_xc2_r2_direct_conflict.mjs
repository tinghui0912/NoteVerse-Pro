import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectConflictReservationFinalizer as Ledger } from './xc2_r2_direct_conflict_finalizer.mjs';
import { BoundedContinuousFinalizationLedger as R1 } from './xc2_r1_bounded_finalizer.mjs';
import { replayR2, extraTargetWitness } from './xc2_r2_replay.mjs';
const s = (id, time, pitch = 'C4', groupId = id) => ({ strikeId: id, groupId, expectedPerformanceTimeMs: time, pitch, renderNoteIds: [] });
const o = (id, time, pitch = 'C4') => ({ observationId: id, performanceTimeMs: time, pitch, confidence: .7 });
const pub = (l, frontier, observations = []) => l.publish({ publicationId: `p${frontier}`, analyzedThroughPerformanceMs: frontier, availabilityTimeMs: frontier + 10, observations });
const verdict = (l, id) => l.snapshot().verdicts.find(v => v.id === id);
function ownershipAudit(l) {
  const r = l.snapshot(), ids = r.verdicts.flatMap(v => v.consumedObservationIds);
  assert.equal(new Set(ids).size, ids.length); assert.equal(new Set(r.observationConsumption.map(v => v.observationId)).size, r.observationConsumption.length);
  for (const p of r.provisionalReservations) { assert.equal(p.semanticDisposition, null); assert.ok(!r.observationConsumption.some(c => c.observationId === p.observationId)); }
}
test('100 strikes at200ms: anchor waits one hop, not the20-second component', () => {
  const l = new Ledger(Array.from({ length: 100 }, (_, i) => s(`s${i}`, 1000 + i * 200)));
  for (let i = 0; i < 100; i++) pub(l, 1000 + i * 200, [o(`o${i}`, 1000 + i * 200)]);
  pub(l, 21100); const v = verdict(l, 's0'); assert.equal(v.witness.requiredAnalysisFrontierMs, 1650); assert.equal(v.finalizationTimeMs, 1810);
  assert.equal(l.snapshot().verdicts.filter(v => v.verdict === 'CORRECT').length, 100); ownershipAudit(l);
});
test('R1 MISSING preemption reproduces; R2 reserves for future correct strike', () => {
  const expected = [s('missing', 1000), s('real', 1300, 'D4')], l = new Ledger(expected), old = new R1(expected);
  pub(l, 1250, [o('played', 1150, 'D4')]); pub(old, 1250, [o('played', 1150, 'D4')]);
  assert.equal(verdict(old, 'missing').verdict, 'WRONG'); assert.equal(verdict(l, 'missing'), undefined);
  assert.equal(l.snapshot().provisionalReservations[0].observationId, 'played'); assert.equal(l.snapshot().observationConsumption.length, 0);
  pub(l, 1550); assert.equal(verdict(l, 'missing').verdict, 'MISSING'); assert.equal(verdict(l, 'real').verdict, 'CORRECT'); ownershipAudit(l);
});
test('incomplete chord with future competitor does not become WRONG', () => {
  const l = new Ledger([s('c', 1000, 'C4', 'chord'), s('e', 1000, 'E4', 'chord'), s('next', 1300, 'D4')]);
  pub(l, 1250, [o('c', 1000), o('d', 1150, 'D4')]); assert.equal(verdict(l, 'chord'), undefined);
  pub(l, 1550); assert.equal(verdict(l, 'chord').verdict, 'INCOMPLETE_CHORD'); ownershipAudit(l);
});
for (const offset of [-250, 250]) test(`observation at exact${offset}ms is legal`, () => { const l = new Ledger([s('a', 1000)]); pub(l, 1250, [o('x', 1000 + offset)]); assert.equal(verdict(l, 'a').verdict, 'CORRECT'); });
test('future strike exactly500ms extends to1750; just beyond500 does not', () => {
  const exact = new Ledger([s('a', 1000), s('b', 1500)]); pub(exact, 1250, [o('x', 1000)]); assert.equal(verdict(exact, 'a'), undefined);
  pub(exact, 1750); assert.equal(verdict(exact, 'a').witness.requiredAnalysisFrontierMs, 1750);
  const beyond = new Ledger([s('a', 1000), s('b', 1500.0001)]); pub(beyond, 1250, [o('x', 1000)]); assert.equal(verdict(beyond, 'a').witness.requiredAnalysisFrontierMs, 1250);
});
test('second-hop competitor never recursively extends anchor; future member remains provisional', () => {
  const l = new Ledger([s('anchor', 1000), s('future', 1500), s('second-hop', 1900)]);
  pub(l, 1750, [o('anchor-note', 1000), o('future-note', 1500)]);
  assert.equal(verdict(l, 'anchor').witness.requiredAnalysisFrontierMs, 1750);
  assert.equal(l.snapshot().lowLevel.strikes.find(s => s.id === 'future').verdict, 'PENDING');
  assert.equal(l.snapshot().cohortSolves[0].oneHopCohortIds.includes('second-hop'), false);
  assert.deepEqual(l.snapshot().cohortSolves[0].committedStrikeIds, ['anchor']);
  assert.ok(l.snapshot().cohortSolves[0].provisionalProposalOnly.some(r => r.strikeId === 'future'));
  assert.ok(!l.snapshot().observationConsumption.some(r => r.observationId === 'future-note')); ownershipAudit(l);
});
test('reversible reservation need not become MATCHED and is never double-consumed', () => {
  const l = new Ledger([s('a', 1000)]); pub(l, 900, [o('early', 900)]); ownershipAudit(l); assert.equal(l.snapshot().observationConsumption.length, 0);
  pub(l, 1250, [o('closer', 1000)]); assert.equal(l.snapshot().lowLevel.strikes[0].matchedObservationId, 'closer'); assert.equal(verdict(l, 'early').verdict, 'EXTRA');
  assert.ok(l.snapshot().reservationChanges.some(r => r.observationId === 'early' && r.previous && !r.next)); ownershipAudit(l);
});
test('stable ID ties do not depend on input order', () => {
  const run = reverse => { const a = [s('b', 1000), s('a', 1000)], b = [o('y', 1000), o('x', 1000)], l = new Ledger(reverse ? a.reverse() : a); pub(l, 1250, reverse ? b.reverse() : b); return l.snapshot().observationConsumption; };
  assert.deepEqual(run(false), run(true));
});
test('late evidence fails closed', () => { const l = new Ledger([s('s', 1000)]); pub(l, 1250); assert.throws(() => pub(l, 1300, [o('late', 1000)]), /LATE_EVIDENCE/); });
test('terminal completion explicitly clamps direct horizon', () => {
  const l = new Ledger([s('s', 1000), s('next', 1400)]); pub(l, 1100, [o('s', 1000)]); l.completeNaturalScope(1100, 1200);
  assert.equal(verdict(l, 's').verdict, 'CORRECT'); assert.equal(verdict(l, 's').witness.requiredAnalysisFrontierMs, 1100); assert.equal(verdict(l, 's').witness.terminalClamp, true); ownershipAudit(l);
});
test('EXTRA waits own direct claimants R2 horizons, not the obsolete R1 520ms bound', () => {
  const l = new Ledger([s('a', 1000), s('b', 1450), s('c', 1950)]);
  pub(l, 1700, [o('a', 1000), o('residual', 1200), o('b', 1450)]); assert.equal(verdict(l, 'residual'), undefined);
  pub(l, 2199, [o('c', 1950)]); assert.equal(verdict(l, 'residual'), undefined);
  pub(l, 2200); const extra = verdict(l, 'residual'); assert.equal(extra.verdict, 'EXTRA'); assert.equal(extra.witness.requiredAnalysisFrontierMs, 2200); assert.equal(extra.finalizationLatencyMs, 1010); ownershipAudit(l);
});
test('EXTRA does not wait unrelated later groups through a transitive chain', () => {
  const l = new Ledger([s('a', 1000), s('b', 1500), s('c', 1900)]);
  pub(l, 1750, [o('a', 1000), o('extra', 1200, 'D4')]); assert.equal(verdict(l, 'extra').verdict, 'EXTRA'); assert.equal(l.snapshot().lowLevel.strikes.find(s => s.id === 'b').verdict, 'PENDING'); ownershipAudit(l);
});
test('20ms chord spread yields the exact1020ms EXTRA bound', () => {
  const l = new Ledger([s('d', 1250, 'D4', 'chord'), s('e', 1270, 'E4', 'chord'), s('future', 1770, 'E4')]);
  pub(l, 1750, [o('extra', 1000, 'C4'), o('d', 1250, 'D4'), o('e', 1270, 'E4')]); assert.equal(verdict(l, 'extra'), undefined);
  pub(l, 2020, [o('future', 1770, 'E4')]); assert.equal(verdict(l, 'extra').witness.requiredAnalysisFrontierMs, 2020);
  assert.equal(verdict(l, 'chord').witness.requiredAnalysisFrontierMs, 2020); ownershipAudit(l);
});
test('WRONG only after every direct correct-match claimant locally closes and releases', () => {
  const l = new Ledger([s('missing', 1000), s('real', 1300, 'D4')]);
  pub(l, 1250, [o('residual', 1150, 'D4')]); assert.equal(verdict(l, 'missing'), undefined);
  pub(l, 1550, [o('real', 1300, 'D4')]); assert.equal(verdict(l, 'missing').verdict, 'WRONG'); assert.deepEqual(verdict(l, 'missing').consumedObservationIds, ['residual']);
  assert.equal(l.snapshot().observationConsumption.find(r => r.observationId === 'real').disposition, 'MATCHED'); ownershipAudit(l);
});
test('pending correct claimant never forces a WRONG group past the one-hop group horizon', () => {
  const l = new Ledger([s('missing', 1000), s('first', 1300, 'D4'), s('second', 1700, 'D4')]);
  pub(l, 1250, [o('reserved', 1150, 'D4')]); pub(l, 1550);
  assert.equal(verdict(l, 'missing').verdict, 'MISSING'); assert.equal(verdict(l, 'missing').witness.requiredAnalysisFrontierMs, 1550);
  assert.equal(l.snapshot().lowLevel.strikes.find(s => s.id === 'first').verdict, 'PENDING'); ownershipAudit(l);
});
test('manual completion and exact enabling-publication timestamp', () => {
  const l = new Ledger([s('future', 5000)]); pub(l, 1000); l.completeManualScope(1000, 1234);
  assert.equal(l.snapshot().lowLevel.strikes[0].verdict, 'NOT_REACHED'); assert.equal(l.snapshot().verdicts.length, 0);
  const m = new Ledger([s('a', 1000)]); pub(m, 1250, [o('a', 1000)]); assert.equal(verdict(m, 'a').finalizationTimeMs, 1260); assert.equal(verdict(m, 'a').witness.enablingPublicationId, 'p1250');
});
test('official replay path executes synthetic reservations and causal audit before freeze', () => {
  const expected = [{ strikeId: 'missing', groupId: 'missing', pitch: 60, timeMs: 1000 }, { strikeId: 'real', groupId: 'real', pitch: 62, timeMs: 1300 }];
  const scenario = { expected, fixedBpm: 120, beatPositions: expected.map(s => s.timeMs / 500) };
  const r = replayR2(scenario, [{ publicationId: 'p1250', analyzedThroughPerformanceMs: 1250, availabilityTimeMs: 1400,
    observations: [{ observationId: 'played', pitch: 62, performanceTimeMs: 1150, confidence: .7 }] },
  { publicationId: 'p1550', analyzedThroughPerformanceMs: 1550, availabilityTimeMs: 1700, observations: [] }]);
  assert.equal(r.verdicts.find(v => v.id === 'missing').verdict, 'MISSING'); assert.equal(r.pendingObservationIds.length, 0);
});
test('detected and absent EXTRA targets retain positive/negative causal evidence without fake latency', () => {
  const publications = [{ publicationId: 'end', analyzedThroughPerformanceMs: 1250, availabilityTimeMs: 1400,
    observations: [{ observationId: 'played', pitch: 60, performanceTimeMs: 1000, confidence: .7 }] }];
  const r = replayR2({ expected: [], beatPositions: [], fixedBpm: 120 }, publications);
  const positive = extraTargetWitness({ pitch: 60, timeMs: 1000 }, publications, r);
  assert.equal(positive.candidates[0].semanticOwner.disposition, 'EXTRA'); assert.ok(positive.candidates[0].extraVerdictWitness);
  assert.equal(extraTargetWitness({ pitch: 61, timeMs: 1000 }, publications, r).candidates.length, 0);
});
