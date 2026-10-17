import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DecodedGestureAssembler, type DecodedPublication } from '../../../../backend/research/step_decoded_sufficiency/acoustic-gestures';
import { replayScenario } from '../../../../backend/research/step_waiting/product-replay';

const publication = (index: number, frontierMs: number, events: readonly [number, string][]): DecodedPublication => ({
  publicationId: `p:${index}`, frontierMs, availabilityMs: frontierMs + 170,
  observations: events.map(([eventMs, pitch], n) => ({ eventMs, availabilityMs: frontierMs+170, pitch, observationId: `${index}:${n}`, confidence: 1,
    sourceDomainId: 'source', sourceSampleRateHz: 48000, sourceEventSample: eventMs * 48 })) });
it('one publication contributes at most one attempt; no same-publication replay', () => {
  const result = replayScenario('one', { name: 'repeat', targets: [[60], [60], [60]] }, [publication(0, 600, [[100,'C4'],[300,'C4'],[500,'C4']])], 0);
  expect(result.outcomes).toHaveLength(1); expect(result.outcomes[0].verdict).toBe('MATCH');
  expect(result.outcomes[0].rearmWatermarkMs).toBe(770);
  expect(result.outcomes[0].analysisFrontierMs).toBe(600);
});
it('busy publication is discarded and late source evidence cannot open a later attempt', () => {
  const result = replayScenario('busy', { name: 'busy', targets: [[60],[60]], holdPublications: 1, lateReplay: true }, [
    publication(0,600,[[100,'C4']]),publication(1,1200,[[800,'C4']]),publication(2,1800,[]),publication(3,2400,[])],0);
  expect(result.outcomes).toHaveLength(1); expect(result.outcomes[0].verdict).toBe('MATCH');
  expect(result.outcomes[0].verdictMs).toBe(1370); expect(result.outcomes[0].rearmWatermarkMs).toBe(1370);
  expect(result.outcomes[0].captureWitness.capturedThroughSourceSample).toBe(65760);
  expect(result.receipts.filter(r=>r.late).every(r=>r.opened===0)).toBe(true);
});
it('score-blind coherence spans publication boundaries without extending transitively', () => {
  const assembler = new DecodedGestureAssembler();
  expect(assembler.push(publication(0,600,[[590,'C4']]))).toEqual([]);
  const gestures = assembler.push(publication(1,1200,[[610,'E4'],[630,'G4']]));
  expect(gestures.map(g=>g.observations.map(o=>o.pitch))).toEqual([['C4','E4'],['G4']]);
});
it('availability may change lock/verdict but cannot redefine the event identity', () => {
  const p = publication(0,600,[[100,'C4']]);
  const a = replayScenario('a',{name:'single',targets:[[60]]},[p],0);
  const b = replayScenario('b',{name:'single',targets:[[60]]},[{...p,availabilityMs:2000}],0);
  expect(a.outcomes[0].eventMs).toBe(b.outcomes[0].eventMs);
  expect(a.outcomes[0].lockMs).not.toBe(b.outcomes[0].lockMs);
});
it('an old receipt may complete analysis without becoming the origin of a new attempt', () => {
  const result = replayScenario('late-complete',{name:'late',targets:[[60],[60]],holdPublications:1,lateReplay:true},[
    publication(0,600,[[100,'C4']]),publication(1,1200,[]),publication(2,1800,[[1400,'C4']]),publication(3,2400,[])],0);
  expect(result.outcomes).toHaveLength(2);
  expect(result.outcomes.every(o=>!o.lateReceipt)).toBe(true);
  expect(result.receipts.find(r=>r.late)!.opened).toBe(0);
});
it('the domain does not pretend an acoustic echo after its watermark proves a new physical strike', () => {
  const result = replayScenario('echo',{name:'repeat',targets:[[60],[60]]},[
    publication(0,600,[[100,'C4']]),publication(1,1200,[[800,'C4']])],0);
  expect(result.outcomes.map(o=>o.verdict)).toEqual(['MATCH','MATCH']);
  // Independent truth scoring, not hidden domain gating, must adjudicate this.
});
it('Stage A and gesture acquisition cannot read truth or a STEP target; Stage B verifies the seal first', () => {
  const dir = path.resolve(__dirname,'../../../../backend/research/step_decoded_sufficiency');
  for(const file of ['browser-entry.ts','acoustic-gestures.ts']) {
    expect(readFileSync(path.join(dir,file),'utf8')).not.toMatch(/StepPracticeRuntime|StepTarget|expectedPitch|targetGeneration|truth\.json|verdict/);
  }
  const scorer = readFileSync(path.join(dir,'score.mjs'),'utf8');
  expect(scorer.indexOf('hash(acousticBytes)!==seal.sha256')).toBeLessThan(scorer.indexOf("WORK,'truth.json'"));
});
