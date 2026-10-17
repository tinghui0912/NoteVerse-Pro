import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {WaitingTopologyGate,GESTURE_WIDTH_MS,type Receipt} from '../../../../backend/research/step_waiting_topology_v3/assembly';
import {replayProduct,type AcousticCell,type PhysicalCase} from '../../../../backend/research/step_waiting_topology_v3/product-scoring';
import type {AudioJob} from '../../../../backend/research/step_waiting_topology_v3/audio-entry';
const receipt=(frontier:number,captured:number,events:readonly [number,string][],wallMs=100):Receipt=>({publicationId:`p:${frontier}`,frontier,capturedThrough:captured,wallMs,
 observations:events.map(([sourceEventSample,pitch],i)=>({observationId:`o:${sourceEventSample}:${i}`,pitch,midiPitch:60,confidence:1,
  sourceDomainId:'s',sourceSampleRateHz:48000,sourceEventSample,targetSample:sourceEventSample/3}))});
it('no pre-ready input opens; exact arming watermark is exclusive, H remains50 and half-open',()=>{
 const gate=new WaitingTopologyGate(48000,'s',0,200000,0,0);gate.captureThrough(48000,1);gate.accept(receipt(40000,48000,[[30000,'C4']]));
 expect(gate.actions).toEqual([]);gate.arm(48000,2);gate.captureThrough(80000,3);
 gate.accept(receipt(72000,80000,[[48000,'C4'],[60000,'E4'],[61920,'G#4'],[62400,'B4']]));
 const attempt=gate.actions.find(a=>a.type==='SEAL')!.attempt!;expect(GESTURE_WIDTH_MS).toBe(50);
 expect(attempt.anchor).toBe(60000);expect(attempt.end).toBe(62400);expect(attempt.pitches).toEqual(['E4','G#4']);
 expect(gate.snapshot().eligibleAfter).toBe(80000);
});
it('CAPTURING collects across publications without extension or a second attempt',()=>{
 const gate=new WaitingTopologyGate(48000,'s',0,200000,0,0);gate.arm(0,1);gate.captureThrough(80000,2);
 gate.accept(receipt(61000,80000,[[60000,'E4']]));expect(gate.state).toBe('CAPTURING');
 gate.captureThrough(90000,3);gate.accept(receipt(80000,90000,[[61920,'G#4'],[70000,'B4']]));
 expect(gate.actions.filter(a=>a.type==='OPEN')).toHaveLength(1);expect(gate.actions.find(a=>a.type==='SEAL')!.attempt!.pitches).toEqual(['E4','G#4']);
});
it('ANALYZING and RESET physically retire input; old late publication cannot reopen',()=>{
 const gate=new WaitingTopologyGate(48000,'s',0,200000,48000,48000);gate.arm(0,1);gate.captureThrough(80000,2);
 gate.accept(receipt(70000,80000,[[60000,'C4']]));expect(gate.state).toBe('ANALYZING');
 gate.captureThrough(100000,3);gate.accept(receipt(90000,100000,[[90000,'C4']]));
 gate.captureThrough(128000,4);expect(gate.state).toBe('RESET');
 gate.captureThrough(150000,5);gate.accept(receipt(140000,150000,[[140000,'C4']]));
 gate.captureThrough(176000,6);expect(gate.state).toBe('READY');
 gate.accept({...receipt(140000,176000,[[90000,'C4'],[140000,'C4'],[176000,'C4']]),late:true});
 expect(gate.actions.filter(a=>a.type==='OPEN')).toHaveLength(1);
 gate.captureThrough(190000,7);gate.accept(receipt(190000,190000,[[180000,'C4']]));expect(gate.actions.filter(a=>a.type==='OPEN')).toHaveLength(2);
});
it('wall availability cannot change physical anchor/end or observation ownership',()=>{
 const run=(shift:number)=>{const gate=new WaitingTopologyGate(48000,'s',0,200000,0,0);gate.arm(0,1+shift);gate.captureThrough(80000,2+shift);gate.accept(receipt(70000,80000,[[60000,'C4']],100+shift));return gate.actions.find(a=>a.type==='SEAL')!.attempt!;};
 const a=run(0),b=run(200);expect([a.id,a.anchor,a.end,a.observations]).toEqual([b.id,b.anchor,b.end,b.observations]);expect(a.lockWallMs).not.toBe(b.lockWallMs);
});
it('post-seal scoring invokes the production STEP runtime and rejects subset target',()=>{
 const gate=new WaitingTopologyGate(48000,'s',0,200000,0,0);gate.arm(0,1);gate.captureThrough(80000,2);gate.accept(receipt(70000,80000,[[60000,'E4'],[61920,'G#4']]));
 const cell:AcousticCell={id:'s',rate:48000,actions:gate.actions,sourceOriginSample:0,captureTrace:[[80000,2,'READY']],ready:{sourceSample:0,wallMs:1},warm:{wallMs:.5,sourceFrontier:0},receipts:gate.receipts};
 const physical:PhysicalCase={id:'s',topology:'chord',intendedTime:1.25,physicalPitches:[64,68],truth:[{time:1.25,notes:[{pitch:64,time:1.25},{pitch:68,time:1.29}]}],scoredEnd:3,arm:0,selected:{},source:{recordingId:'unit'}};
 const exact=replayProduct(cell,physical,[64,68]),subset=replayProduct(cell,physical,[64]);
 expect(exact.outcomes[0].verdict).toBe('MATCH');expect(exact.outcomes[0].fullPhysicalSupport).toBe(true);expect(exact.snapshot.step.currentIndex).toBe(1);
 expect(subset.outcomes[0].verdict).toBe('MISMATCH');expect(subset.snapshot.step.currentIndex).toBe(0);
 expect(Object.values(exact.architecture).every(v=>v===0)).toBe(true);
});
it('frozen audio jobs expose numeric control only and Stage A has no truth/product imports',()=>{
 const root=path.resolve(__dirname,'../../../..');
 const jobs=JSON.parse(readFileSync(path.join(root,'backend/data/work/step_waiting_topology_v3/corpus-v4/audio_only/jobs.json'),'utf8')).jobs as AudioJob[];
 expect(jobs).toHaveLength(56);
 for(const job of jobs)for(const key of Object.keys(job))expect(key).not.toMatch(/truth|expected|pitch|topology|verdict|stepId/i);
 for(const file of ['assembly.ts','audio-entry.ts'])expect(readFileSync(path.join(root,'backend/research/step_waiting_topology_v3',file),'utf8')).not.toMatch(/StepPracticeRuntime|StepTarget|expectedPitch|truth\.json|\b(?:MATCH|MISMATCH)\b|targetGeneration/);
 const scorer=readFileSync(path.join(root,'backend/research/step_waiting_topology_v3/score.mjs'),'utf8');
 expect(scorer.indexOf('hash(bytes)!==seal.sha256')).toBeLessThan(scorer.indexOf("path.join(DATA,'truth.json')"));
});
it('every eligible terminal anchor has full real owned coverage for its entire50ms attempt',()=>{
 const jobs=JSON.parse(readFileSync(path.resolve(__dirname,'../../../../backend/data/work/step_waiting_topology_v3/corpus-v4/audio_only/jobs.json'),'utf8')).jobs as AudioJob[];
 for(const j of jobs)expect(j.regionEndSourceSample).toBeGreaterThanOrEqual(j.semanticEndSourceSample+j.rate*GESTURE_WIDTH_MS/1000);
});
it('an old pre-watermark physical gesture cannot corroborate a new decoded MATCH even with identical pitches',()=>{
 const gate=new WaitingTopologyGate(48000,'s',0,200000,0,0);gate.captureThrough(58000,.8);gate.arm(58000,1);
 gate.captureThrough(80000,2);gate.accept(receipt(70000,80000,[[60000,'C4']]));
 const cell:AcousticCell={id:'s',rate:48000,actions:gate.actions,sourceOriginSample:0,captureTrace:[[58000,.8,'UNAVAILABLE'],[80000,2,'READY']],ready:{sourceSample:58000,wallMs:1},warm:{wallMs:.5,sourceFrontier:50000},receipts:gate.receipts};
 const physical:PhysicalCase={id:'s',topology:'held_note',intendedTime:null,physicalPitches:[60],truth:[{time:1.2,notes:[{pitch:60,time:1.2}]}],scoredEnd:3,arm:58000/48000,selected:{},source:{recordingId:'unit'}};
 const result=replayProduct(cell,physical,[60]);expect(result.outcomes[0].verdict).toBe('MATCH');
 expect(result.outcomes[0].physicalGestureEligible).toBe(false);expect(result.outcomes[0].fullPhysicalSupport).toBe(false);expect(result.unsupported).toBe(1);
 expect(result.outcomes[0].physicalEventCapture!.state).toBe('UNAVAILABLE');expect(result.outcomes[0].decodedEventCapture!.state).toBe('READY');
});
