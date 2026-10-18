import assert from 'node:assert/strict';
import {ProductAdapter,WaitingTopologyGate,nearest,supported,denominator,claimTruth,GESTURE_WIDTH_MS} from './domain';
import {reconstruct,selectLateWindow} from './geometry';
import {raw,save,OUT,hash,load,V6,payload} from './io';
const results:any[]=[];
async function test(name:string,fn:()=>unknown){await fn();results.push({name,status:'PASS'});}
const observation=(source:number,p='C4',id='o')=>({sourceEventSample:source,pitch:p,midiPitch:60,confidence:0.8,observationId:id,
  sourceDomainId:'synthetic',sourceSampleRateHz:48000 as const,targetSample:source/3});
const receipt=(physical:number,frontier:number,observations:any[])=>({publicationId:'synthetic',wallMs:physical/48,capturedThrough:physical,frontier,observations});
const product=(targets=[[60],[60]],hold=0)=>{const p=new ProductAdapter(48000,'synthetic',0,100000,targets,hold);p.arm(0);return p;};
try{
 await test('strict equality ignored by actual runtime',()=>{const p=product();assert.equal(p.runtime.openAttempt(p.time(0)),null);});
 await test('strict post boundary accepted by actual runtime',()=>{const p=product();assert.ok(p.runtime.openAttempt(p.time(1)));});
 await test('H remains exactly 50',()=>assert.equal(GESTURE_WIDTH_MS,50));
 await test('half open H50 right edge excluded',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[observation(100),observation(2500,'C#4','edge')]));assert.deepEqual(p.outcomes[0].attempt.pitches,['C4']);});
 await test('no extension for later event',()=>{const p=product();p.capture(3000);p.accept(receipt(3000,3000,[observation(100),observation(2600,'D4','later')]));assert.equal(p.outcomes[0].attempt.end,2500);});
 await test('no early target driven close and extra pitch retained',()=>{const p=product();p.capture(300);p.accept(receipt(300,300,[observation(100)]));assert.equal(p.state(),'CAPTURING');assert.equal(p.outcomes.length,0);
   p.capture(2600);p.accept(receipt(2600,2600,[observation(150,'C#4','extra')]));assert.equal(p.outcomes[0].record.verdict,'MISMATCH');assert.deepEqual(p.outcomes[0].attempt.pitches,['C#4','C4']);});
 await test('second attempt while busy rejected and not queued',()=>{const p=product([[60],[60]],48000);p.capture(2600);p.accept(receipt(2600,2600,[observation(100)]));assert.equal(p.state(),'ANALYZING');assert.equal(p.runtime.openAttempt(p.time(3000)),null);
   p.capture(4000);p.accept(receipt(4000,4000,[observation(3500,'C4','busy')]));p.capture(50600);assert.equal(p.outcomes.length,1);assert.equal(p.state(),'READY');});
 await test('late publication retains old event and is rejected',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[observation(100)]));p.capture(5000);p.accept({...receipt(5000,5000,[observation(2500,'C4','retired')]),late:true});assert.equal(p.outcomes.length,1);});
 await test('MISMATCH retains target generation',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[observation(100,'D4')]));assert.equal(p.outcomes[0].record.verdict,'MISMATCH');assert.equal(p.runtime.currentTarget()?.targetGeneration,1);});
 await test('MATCH advances exactly once',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[observation(100)]));assert.equal(p.outcomes[0].record.verdict,'MATCH');assert.equal(p.runtime.currentTarget()?.targetGeneration,2);});
 await test('fresh rearm creates distinct attempt identity',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[observation(100,'D4')]));p.capture(5600);p.accept(receipt(5600,5600,[observation(3000,'C4','fresh')]));assert.notEqual(p.outcomes[0].record.attemptId,p.outcomes[1].record.attemptId);});
 await test('observation reuse across attempts detected',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[observation(100,'D4')]));p.capture(5600);p.accept(receipt(5600,5600,[observation(3000)]));assert.equal(p.ownershipViolations.length,1);});
 await test('one truth gesture cannot double advance',()=>{const owners=new Set<string>();assert.ok(claimTruth(owners,'g'));assert.equal(claimTruth(owners,'g'),false);});
 await test('exact full physical truth equality required',()=>{assert.ok(supported({normalizedPitchSet:[60,64]},[60,64]));assert.equal(supported({normalizedPitchSet:[60,64]},[60]),false);assert.equal(supported({normalizedPitchSet:[60]},[60,64]),false);});
 await test('truth attribution ignores target pitches',()=>{const truth=[{onsetMs:1000,normalizedPitchSet:[60]},{onsetMs:1100,normalizedPitchSet:[62]}];assert.equal(nearest(truth,1010).gesture,truth[0]);});
 await test('truth farther than 100ms rejected',()=>assert.equal(nearest([{onsetMs:1000}],1100.01).gesture,null));
 await test('100ms attribution included exactly',()=>assert.equal(nearest([{onsetMs:1000}],1100).status,'ATTRIBUTED'));
 await test('ambiguous equal distance is not evaluable',()=>assert.equal(nearest([{onsetMs:1000},{onsetMs:1100}],1050).status,'NOT_EVALUABLE_AMBIGUOUS_TRUTH'));
 await test('zero over zero cannot be empirical PASS',()=>assert.equal(denominator(false),0));
 await test('rearm equality has no empirical denominator',()=>assert.equal(denominator(true,true),null));
 await test('no invented RETRY',()=>{const p=product();p.capture(2600);p.accept(receipt(2600,2600,[{...observation(100,'D4'),confidence:0}]));assert.equal(p.outcomes[0].record.verdict,'MISMATCH');assert.equal(p.outcomes[0].record.retryReason,null);});
 await test('content blind unique late selector',()=>{const windows=[{window:{windowIndex:0,ownedStartTarget:0,ownedEndTarget:9600}},{window:{windowIndex:1,ownedStartTarget:9600,ownedEndTarget:19200}}];assert.equal(selectLateWindow(windows,28800,0,48000),1);assert.throws(()=>selectLateWindow(windows,999999,0,48000));});
 for(const rate of [44100,48000])await test(`geometry only capture reconstruction ${rate} independent of sample values`,async()=>{
   const bytes=await raw('apps/customer-web/public/model-assets/practice-acoustic/'+(rate===44100?'fir-160-441.f32':'fir-1-3.f32'));
   const job={jobId:'synthetic',sourceDomainId:'synthetic',sourceRateHz:rate,sourceOriginSample:0,regionStartSourceSample:rate*1.2,frames:rate*2.2,
     expectedModelInputs:[{windowIndex:0,start:2400,end:31520,sha256:'synthetic'}]};
   const a=await reconstruct(job,bytes,0),b=await reconstruct(job,bytes,0.125);assert.deepEqual(a,b);assert.equal(a.windows.length,1);
   assert.ok(a.windows[0].capturedThroughSourceSample>rate*1.97);assert.equal(a.windows[0].window.endSample,31520);
 });
 await test('frozen truth and scenarios exact identities',async()=>{
   assert.equal(hash(await raw(V6+'/audio-bound-cases.json')),'745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e');
   assert.equal(hash(await raw(V6+'/scenario-manifest.json')),'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55');
   const s=await load(V6+'/scenario-manifest.json');assert.equal(s.scenarios.length,20);assert.equal(s.scenarios.find((s:any)=>s.scenarioId==='rearm_equality').physicalMetadataOpportunities,null);
 });
 await test('no acoustic payload opened during synthetic testing',async()=>{await assert.rejects(raw(OUT+'/acoustic-payload-opening.json'));});
 await test('payload gate rejects execution without remote freeze proof',async()=>{await assert.rejects(payload());});
 await save(OUT+'/synthetic-tests.json',{tests:results.length,passed:results.length,failed:0,results,newNeuralRuns:0,acousticPayloadOpened:false});
 console.log(JSON.stringify({tests:results.length,passed:results.length,failed:0,newNeuralRuns:0}));
}catch(error){await save(OUT+'/synthetic-test-failure.json',{results,failure:String(error),newNeuralRuns:0,acousticPayloadOpened:false});throw error;}
