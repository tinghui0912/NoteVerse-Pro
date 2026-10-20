import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { DIR, bytes } from './io.mjs';
import { classifyLifecycles } from './lifecycle.mjs';

export const witnessNames=['entryPassed','expectedTerminalCause','normalOrExpectedContextPreState','singleOutstandingBefore','oneStartedWithoutReceipt',
  'onePendingRequestAtTermination','knownWindowIdentity','workerDisposedOnce','sourceDisposedOnce','analysisDisposed','outstandingZeroAfter',
  'noAnalysisFailure','noUnexpectedInfrastructure','noApplicationFailureExceptExpectedContext','noWorkerErrors','noPageErrors','networkClean',
  'staticActiveDisposalProof','noLaterReceipt','noPostTerminalPublication','noPostTerminalEvidence','noLaterRequest','noReconnect'];
export function fixture(A=71,C=A,terminalKind=null) {
  const requests=Array.from({length:A},(_,i)=>({ordinal:i+1,cell:'synthetic',requestId:i+2,order:i+1,afterTermination:false,
    window:{jobIndex:i,regionIndex:0,windowIndex:i,startSample:100+i*9600,endSample:29220+i*9600,ownedStartTarget:16900+i*9600,ownedEndTarget:26500+i*9600}}));
  return {requests,completions:requests.slice(0,C).map(r=>({ordinal:r.ordinal,count:r.ordinal,window:r.window,afterTerminalClose:false})),
    publications:requests.slice(0,C).map(r=>({ordinal:r.ordinal,window:r.window})),rejectedPromises:A-C,sessionLoads:1,workerOwners:1,
    unclassifiedWorkers:0,workerErrors:[],unexpectedResponses:[],hiddenWarmups:0,
    terminal:terminalKind?{kind:terminalKind,order:1000,pendingOrdinals:requests.slice(C).map(r=>r.ordinal),witnesses:Object.fromEntries(witnessNames.map(k=>[k,true]))}:null,
    completedAfterCloseWitness:false};
}
export async function lifecycleTests() {
  const results=[],test=async(name,run)=>{await run();results.push({name,result:'LOCAL_PASS_SYNTHETIC_ONLY'});};
  const fail=(data,pattern)=>{const r=classifyLifecycles(data);assert.equal(r.accepted,false);if(pattern)assert.ok(r.errors.some(e=>e.includes(pattern)),JSON.stringify(r.errors));return r;};
  await test('A all 71 authorized requests complete sequentially with publication',()=>{
    const r=classifyLifecycles(fixture());assert.equal(r.accepted,true);assert.equal(r.terminalTeardownCancellations,0);
    assert.equal(r.unattributedOrHiddenNeuralExecution,0);assert.deepEqual(r.internalSessionRunInvocationInterval,[71,71]);
  });
  await test('B/P 70 receipts and one fully witnessed final cancellation conserve authorization and report [70,71]',()=>{
    const r=classifyLifecycles(fixture(71,70,'normal-terminal-disposal'));assert.equal(r.accepted,true);
    assert.equal(r.terminalTeardownCancellations,1);assert.equal(r.failedOrRejectedRunPromises,1);
    assert.equal(r.unattributedRequestLifecycle,0);assert.equal(r.unattributedOrHiddenNeuralExecution,0);assert.deepEqual(r.internalSessionRunInvocationInterval,[70,71]);
  });
  await test('C two unresolved started requests fail',()=>fail(fixture(71,69,'normal-terminal-disposal'),'MULTIPLE_UNRESOLVED'));
  await test('D missing receipt without every terminal witness fails',()=>{
    fail(fixture(71,70),'UNATTRIBUTED_REQUEST_LIFECYCLE');
    for(const name of witnessNames){const f=fixture(71,70,'normal-terminal-disposal');f.terminal.witnesses[name]=false;fail(f,'UNATTRIBUTED_REQUEST_LIFECYCLE');}
  });
  await test('E ordinary worker error cannot be reclassified as terminal cancellation',()=>{
    const f=fixture(71,70,'normal-terminal-disposal');f.workerErrors=[{error:'ORT_ERROR'}];f.terminal.witnesses.noWorkerErrors=false;fail(f,'WORKER_CRASH');
  });
  await test('F crash or messageerror fails',()=>{for(const error of ['error','messageerror']){const f=fixture();f.workerErrors=[{error}];fail(f,'WORKER_CRASH');}});
  await test('G unknown response/execution fails',()=>{const f=fixture();f.unexpectedResponses=[{id:999}];assert.ok(fail(f,'UNEXPECTED_RESPONSE').unattributedOrHiddenNeuralExecution>0);});
  await test('H sequence 1..69,71 fails',()=>{const f=fixture(71,70);f.completions[69].count=71;assert.ok(fail(f,'COMPLETED_RECEIPT_SEQUENCE').unattributedOrHiddenNeuralExecution>0);});
  await test('I duplicate completed count fails',()=>{const f=fixture();f.completions[70].count=70;fail(f,'COMPLETED_RECEIPT_SEQUENCE');});
  await test('J more completion receipts than authorized requests fails',()=>{
    const f=fixture();f.completions.push({...f.completions[70],ordinal:72,count:72});fail(f,'RECEIPT_WITHOUT_AUTHORIZED');
  });
  await test('K cancellation during ordinary running fails',()=>fail(fixture(71,70,'ordinary-running'),'UNATTRIBUTED_REQUEST_LIFECYCLE'));
  await test('L completed after terminal closure with publication suppressed stays in C, not K',()=>{
    const f=fixture(71,71,'normal-terminal-disposal');f.publications.pop();f.completions[70].afterTerminalClose=true;f.completedAfterCloseWitness=true;
    const r=classifyLifecycles(f);assert.equal(r.accepted,true);assert.equal(r.acknowledgedCompletedSessionRuns,71);
    assert.equal(r.completedAfterTerminalCloseNotPublished,1);assert.equal(r.terminalTeardownCancellations,0);assert.deepEqual(r.internalSessionRunInvocationInterval,[71,71]);
  });
  await test('M cancelled request with publication fails',()=>{const f=fixture(71,70,'normal-terminal-disposal');f.publications.push({ordinal:71,window:f.requests[70].window});fail(f,'PUBLICATION_WITHOUT_COMPLETED');});
  await test('N cancelled request producing EVIDENCE fails',()=>{const f=fixture(71,70,'normal-terminal-disposal');f.terminal.witnesses.noPostTerminalEvidence=false;fail(f,'UNATTRIBUTED_REQUEST_LIFECYCLE');});
  await test('O request budget exceeds 96 fails',()=>fail(fixture(97,97),'REQUEST_BUDGET'));
  await test('context terminal cancellation only with expected context witness',()=>{
    const f=fixture(71,70,'context-terminal-disposal');assert.equal(classifyLifecycles(f).accepted,true);
    f.terminal.witnesses.expectedTerminalCause=false;fail(f,'UNATTRIBUTED_REQUEST_LIFECYCLE');
  });
  await test('infer after disposal, second session and hidden warmup fail',()=>{
    const a=fixture(71,71,'normal-terminal-disposal');a.requests[70].afterTermination=true;fail(a,'INFER_AFTER_TERMINAL');
    const b=fixture();b.sessionLoads=2;fail(b,'SESSION_OWNER');const c=fixture();c.hiddenWarmups=1;fail(c,'HIDDEN_WARMUP');
  });
  await test('observational Worker tap forwards exact objects, responses, return values and termination',async()=>{
    const instances=[];
    class FakeWorker {
      constructor(...args){this.args=args;this.listeners=new Map();this.messages=[];this.terminations=0;instances.push(this);}
      addEventListener(type,listener){const a=this.listeners.get(type)??[];a.push(listener);this.listeners.set(type,a);}
      postMessage(...args){this.messages.push(args);return 'unchanged-post-return';}
      terminate(){this.terminations++;return 'unchanged-terminate-return';}
      answer(data){for(const f of this.listeners.get('message')??[])f({data});}
    }
    let clock=0;const sandbox={Worker:FakeWorker,URL,location:{href:'http://127.0.0.1/'},performance:{now:()=>++clock}};
    runInNewContext((await bytes(DIR+'/worker-lifecycle-tap.mjs')).toString(),sandbox,{timeout:1000});
    const options={type:'module'},worker=new sandbox.Worker('http://127.0.0.1/acoustic-worker.entry.ts',options);
    assert.equal(worker,instances[0]);assert.equal(worker.args[1],options);assert.ok(worker instanceof FakeWorker);
    const payload={type:'INFER',id:2,input:{window:fixture(1).requests[0].window,pcm:new Float32Array(29120)}},transfer=[];
    assert.equal(worker.postMessage(payload,transfer),'unchanged-post-return');assert.equal(worker.messages[0][0],payload);assert.equal(worker.messages[0][1],transfer);
    let observed;worker.addEventListener('message',e=>{observed=e.data;});const result={id:2,result:{actualSessionRunCount:1}};worker.answer(result);assert.equal(observed,result);
    assert.equal(worker.terminate(),'unchanged-terminate-return');assert.equal(worker.terminations,1);
    const events=sandbox.__v33WorkerLifecycle.events;assert.equal(events.filter(e=>e.kind==='REQUEST').length,1);assert.equal(events.find(e=>e.kind==='RESPONSE').actualSessionRunCount,1);
    assert.equal(events.find(e=>e.kind==='TERMINATE').pendingRequestIds.length,0);
  });
  return results;
}
