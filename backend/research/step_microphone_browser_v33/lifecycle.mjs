import assert from 'node:assert/strict';
export const windowKey = w => `${w.regionIndex}:${w.windowIndex}:${w.jobIndex}`;
const equalWindow = (a,b) => JSON.stringify(a) === JSON.stringify(b);

/** Pure prospective ledger. Missing receipts alone never create a terminal-cancellation allowance. */
export function classifyLifecycles(data) {
  const errors=[], records=[], requests=data.requests, completions=data.completions;
  let hidden=0, completed=0, cancelled=0, completedAfterClose=0;
  const bad=(code,execution=false)=>{errors.push(code);if(execution)hidden++;};
  if(requests.length>96)bad('REQUEST_BUDGET_EXCEEDED');
  if(data.sessionLoads!==1)bad('SESSION_OWNER_COUNT',true);
  if(data.workerOwners!==1 || data.unclassifiedWorkers!==0)bad('WORKER_OWNER_TAXONOMY',true);
  if(data.workerErrors.length)bad('WORKER_CRASH_MESSAGEERROR_OR_ERROR_RESPONSE',true);
  if(data.unexpectedResponses.length)bad('UNEXPECTED_RESPONSE_OR_EXECUTION',true);
  if(data.hiddenWarmups!==0)bad('HIDDEN_WARMUP',true);
  const byOrdinal=new Map();
  for(const [i,c]of completions.entries()){
    if(c.count!==i+1)bad('COMPLETED_RECEIPT_SEQUENCE',true);
    if(!Number.isInteger(c.ordinal)||c.ordinal<1||c.ordinal>requests.length)bad('RECEIPT_WITHOUT_AUTHORIZED_REQUEST',true);
    if(byOrdinal.has(c.ordinal))bad('DUPLICATE_REQUEST_COMPLETION',true);else byOrdinal.set(c.ordinal,c);
    if(c.count>requests.length)bad('COMPLETION_EXCEEDS_AUTHORIZATION',true);
  }
  const unresolved=requests.filter(r=>!byOrdinal.has(r.ordinal));
  if(unresolved.length>1)bad('MULTIPLE_UNRESOLVED_STARTED_REQUESTS');
  const terminal=data.terminal;
  const witnessNames=['entryPassed','expectedTerminalCause','normalOrExpectedContextPreState','singleOutstandingBefore','oneStartedWithoutReceipt',
    'onePendingRequestAtTermination','knownWindowIdentity','workerDisposedOnce','sourceDisposedOnce','analysisDisposed','outstandingZeroAfter',
    'noAnalysisFailure','noUnexpectedInfrastructure','noApplicationFailureExceptExpectedContext','noWorkerErrors','noPageErrors','networkClean',
    'staticActiveDisposalProof','noLaterReceipt','noPostTerminalPublication','noPostTerminalEvidence','noLaterRequest','noReconnect'];
  for(const [i,r]of requests.entries()){
    const record={...r,lifecycleClass:'UNATTRIBUTED_REQUEST_LIFECYCLE',publicationStatus:null};
    if(r.ordinal!==i+1 || i&&r.order<=requests[i-1].order)bad('REQUEST_IDENTITY_OR_ORDER');
    if(r.afterTermination || terminal&&r.order>terminal.order)bad('INFER_AFTER_TERMINAL_OWNER',true);
    const c=byOrdinal.get(r.ordinal),pub=data.publications.filter(p=>p.ordinal===r.ordinal);
    if(c){
      if(!equalWindow(c.window,r.window))bad('COMPLETION_WINDOW_IDENTITY');
      if(pub.length===1){record.publicationStatus='PUBLISHED';record.lifecycleClass='ACKNOWLEDGED_COMPLETED_SESSION_RUN';completed++;}
      else if(pub.length===0 && terminal && c.afterTerminalClose && data.completedAfterCloseWitness===true){
        record.publicationStatus='ACKNOWLEDGED_COMPLETED_AFTER_TERMINAL_CLOSE_NOT_PUBLISHED';record.lifecycleClass='ACKNOWLEDGED_COMPLETED_SESSION_RUN';completed++;completedAfterClose++;
      }else bad('COMPLETED_RUN_WITHOUT_VALID_PUBLICATION_OR_TERMINAL_SUPPRESSION');
      record.completedReceipt=c;
    }else{
      const valid=unresolved.length===1&&terminal&&terminal.kind!=='ordinary-running'&&r.order<terminal.order
        &&terminal.pendingOrdinals.length===1&&terminal.pendingOrdinals[0]===r.ordinal
        &&witnessNames.every(name=>terminal.witnesses[name]===true)&&pub.length===0;
      if(valid){record.lifecycleClass='AUTHORIZED_TERMINAL_TEARDOWN_CANCELLATION';record.publicationStatus='NO_PUBLICATION';cancelled++;}
      else bad('UNATTRIBUTED_REQUEST_LIFECYCLE:'+r.ordinal);
      record.terminalWitness=terminal??null;
    }
    records.push(record);
  }
  for(const pub of data.publications)if(!byOrdinal.has(pub.ordinal))bad('PUBLICATION_WITHOUT_COMPLETED_REQUEST',true);
  if(data.rejectedPromises!==cancelled)bad('REJECTED_PROMISE_NOT_ONE_TO_ONE_TERMINAL_CANCELLATION');
  if(cancelled>1)bad('TERMINAL_CANCELLATION_LIMIT');
  const unattributed=records.filter(r=>r.lifecycleClass==='UNATTRIBUTED_REQUEST_LIFECYCLE').length;
  if(requests.length!==completed+cancelled)bad('AUTHORIZED_REQUEST_CONSERVATION');
  return {accepted:errors.length===0,errors,authorizedInferRequests:requests.length,acknowledgedCompletedSessionRuns:completed,
    terminalTeardownCancellations:cancelled,failedOrRejectedRunPromises:data.rejectedPromises,completedAfterTerminalCloseNotPublished:completedAfterClose,
    unattributedRequestLifecycle:unattributed,unattributedOrHiddenNeuralExecution:hidden,
    internalSessionRunInvocationInterval:[completed,completed+cancelled],publishedCompletedRequests:data.publications.length,records,
    intervalMeaning:'Internal session.run invocation count interval, NOT exact GPU kernel count; cancelled work is neither completed nor asserted zero'};
}

export function lifecycleFromRaw(cell,plan,workerEvents) {
  const t=cell.result,tap=cell.workerLifecycle;
  assert.ok(tap&&tap.version===1,'FROZEN_WORKER_TAP_REQUIRED');assert.equal(tap.observerErrors.length,0);
  const owners=tap.workers.filter(w=>w.classification==='PRODUCT_ACOUSTIC_OWNER');
  const events=tap.events.filter(e=>e.workerId===owners[0]?.id), req=events.filter(e=>e.kind==='REQUEST'&&e.requestType==='INFER');
  const terminations=events.filter(e=>e.kind==='TERMINATE'), terminalActions=events.filter(e=>e.kind==='TERMINATE'||e.kind==='REQUEST'&&e.requestType==='DISPOSE');
  const terminalAction=terminalActions[0], termination=terminations[0];
  assert.equal(req.length,t.counts.runAttempts,'REAL_RUN_WRAPPER_TO_WORKER_REQUEST_CONSERVATION');
  assert.equal(terminations.length,1,'NATIVE_PRODUCT_TERMINATION_ONCE');
  assert.equal(termination.snapshot.publicationCount,t.publications.length,'PUBLICATION_AFTER_TERMINAL_DISPOSAL');
  assert.equal(termination.snapshot.attemptCount,t.attempts.length,'EVIDENCE_AFTER_TERMINAL_DISPOSAL');
  assert.equal(t.afterInputCleanup.input.analysis.outstanding,0,'FINAL_SOURCE_OUTSTANDING');
  assert.equal(events.filter(e=>e.kind==='REQUEST'&&e.requestType==='LOAD').length,t.counts.loadAttempts);
  const responses=events.filter(e=>e.kind==='RESPONSE');
  const requestIds=new Set();for(const r of events.filter(e=>e.kind==='REQUEST')){assert.ok(!requestIds.has(r.requestId));requestIds.add(r.requestId);}
  const base=t.beforeInputDispose?.input.analysis.sourceBase??0;
  const requests=req.map((r,i)=>({ordinal:i+1,cell:cell.id,requestId:r.requestId,workerId:r.workerId,order:r.order,authorizedAtMs:r.atMs,
    jobIndex:r.window.jobIndex,regionIndex:r.window.regionIndex,windowIndex:r.window.windowIndex,window:r.window,
    sourceInputInterval:[base+r.window.startSample*cell.rate/16000,base+r.window.endSample*cell.rate/16000],afterTermination:r.afterTermination,
    authorizationProvenance:'One-to-one frozen real.run wrapper counter and transparent native INFER request, backed by static SourceAnalysisRuntime planned-window call path'}));
  assert.ok(requests.every((r,i)=>r.jobIndex===i),'SOURCE_RUNTIME_SEQUENTIAL_JOB_IDENTITY');
  const completions=t.runReceipts.map(r=>{
    const q=requests.find(q=>windowKey(q.window)===windowKey(r.window));assert.ok(q,'COMPLETION_WINDOW_WITHOUT_AUTHORIZATION');
    const wire=responses.filter(e=>e.requestId===q.requestId);assert.equal(wire.length,1,'MATCHING_WORKER_RESPONSE_REQUIRED');
    assert.equal(wire[0].error,null);assert.equal(wire[0].actualSessionRunCount,r.actualSessionRunCount);
    const pub=t.publications.find(p=>windowKey(p.window)===windowKey(r.window));
    return {ordinal:q.ordinal,count:r.actualSessionRunCount,window:r.window,responseOrder:wire[0].order,
      afterTerminalClose:!pub&&!!terminalAction&&r.actualSessionRunCount>terminalAction.snapshot.receiptCount,
      receiptSource:'Real wrapped worker.run promise result AND native Worker response'};
  });
  const publications=t.publications.map(p=>{const q=requests.find(q=>windowKey(q.window)===windowKey(p.window));assert.ok(q);return{ordinal:q.ordinal,window:p.window};});
  const missing=requests.filter(r=>!completions.some(c=>c.ordinal===r.ordinal)), pending=termination.pendingRequests.filter(p=>p.requestType==='INFER');
  const normal=cell.scenario==='normal', before=normal?t.beforeInputDispose:t.beforeInfrastructureLoss, after=t.afterInputCleanup;
  const contextExpected=!normal&&t.infrastructure.some(e=>e.code==='AUDIO_CONTEXT_INTERRUPTED'&&e.state==='suspended')&&t.applicationFailures.length===1;
  const noUnexpectedFailures=normal?t.failures.length===0:t.failures.every(e=>['STEP_MICROPHONE_ABORTED','STEP_MICROPHONE_CONTEXT_INTERRUPTED'].includes(e.message));
  const environment=cell.auditEnvironment??{pageErrors:[{missing:true}],forbiddenRequests:1,externalRequests:1};
  const otherWorkers=workerEvents.filter(w=>w.cell===cell.id&&w.classification==='UNCLASSIFIED_RUNTIME_WORKER');
  const wireErrors=events.filter(e=>e.kind==='WORKER_ERROR'||e.kind==='POST_THROW'||e.kind==='RESPONSE'&&e.error);
  const unexpectedResponses=responses.filter(e=>!e.matchedPending);
  const witness={entryPassed:t.status==='PASS',expectedTerminalCause:normal?!!t.beforeInputDispose&&t.infrastructure.length===0&&t.applicationFailures.length===0:contextExpected,
    normalOrExpectedContextPreState:before?.input.resourceState==='AVAILABLE'&&before.input.failure===null&&before.input.analysis.state==='RUNNING'&&before.input.analysis.failureCode===null,
    singleOutstandingBefore:before?.input.analysis.outstanding===1,
    oneStartedWithoutReceipt:before?.input.analysis.counts.windowsStarted-completions.length===1,
    onePendingRequestAtTermination:pending.length===1&&missing.length===1&&pending[0].requestId===missing[0].requestId,
    knownWindowIdentity:pending.length===1&&missing.length===1&&equalWindow(pending[0].window,missing[0].window),
    workerDisposedOnce:t.counts.workerDisposeCalls===1&&terminations.length===1,sourceDisposedOnce:t.counts.sourceDisposals===1,
    analysisDisposed:after?.input.analysis.state==='DISPOSED',outstandingZeroAfter:after?.input.analysis.outstanding===0,
    noAnalysisFailure:after?.input.analysis.failureCode===null,
    noUnexpectedInfrastructure:normal?t.infrastructure.length===0:contextExpected&&t.infrastructure.every(e=>e.code==='AUDIO_CONTEXT_INTERRUPTED'),
    noApplicationFailureExceptExpectedContext:normal?t.applicationFailures.length===0:contextExpected,
    noWorkerErrors:wireErrors.length===0&&noUnexpectedFailures&&otherWorkers.length===0,
    noPageErrors:environment.pageErrors.length===0,networkClean:environment.forbiddenRequests===0&&environment.externalRequests===0,
    staticActiveDisposalProof:plan.lifecycleStaticProofEstablished===true,
    noLaterReceipt:missing.every(r=>!responses.some(e=>e.requestId===r.requestId)),
    noPostTerminalPublication:!!termination&&termination.snapshot.publicationCount===t.publications.length,
    noPostTerminalEvidence:!!termination&&termination.snapshot.attemptCount===t.attempts.length,
    noLaterRequest:!!terminalAction&&req.every(e=>e.order<terminalAction.order),
    noReconnect:owners.length===1&&t.counts.workerOwners===1&&t.counts.loadAttempts===1&&t.counts.loadSuccesses===1};
  if(normal)assert.equal(after.input.resourceState,'DISPOSED');
  const data={requests,completions,publications,rejectedPromises:t.counts.runFailures,sessionLoads:t.modelReceipt?.actualSessionLoadCount??0,
    workerOwners:owners.length,unclassifiedWorkers:otherWorkers.length,workerErrors:wireErrors,unexpectedResponses,hiddenWarmups:0,
    terminal:terminalAction?{kind:normal?'normal-terminal-disposal':'context-terminal-disposal',order:terminalAction.order,
      pendingOrdinals:pending.map(p=>requests.find(r=>r.requestId===p.requestId)?.ordinal??-1),witnesses:witness,
      nativeTerminationOrder:termination.order,beforeSourceAnalysis:before?.input.analysis??null,afterSourceAnalysis:after?.input.analysis??null,
      staticWitness:'production-lifecycle-proof.json#AcousticModelWorker.dispose/terminate and SourceAnalysisRuntime.dispose/closed'}:null,
    completedAfterCloseWitness:!!terminalAction&&after?.input.analysis.state==='DISPOSED'&&after.input.analysis.outstanding===0
      &&termination.snapshot.publicationCount===t.publications.length&&termination.snapshot.attemptCount===t.attempts.length&&wireErrors.length===0};
  const ledger=classifyLifecycles(data);cell.inferenceLifecycle={...ledger,terminalWitness:data.terminal,rawAccountingInput:data};
  assert.ok(ledger.accepted,'INFERENCE_LIFECYCLE_INTEGRITY:'+ledger.errors.join(','));
  assert.equal(t.counts.runSuccesses,completions.length);assert.equal(t.counts.runAttempts,requests.length);
  assert.equal(t.counts.runFailures,ledger.terminalTeardownCancellations);
  assert.equal(t.counts.loadSuccesses,1);assert.equal(plan.currentDefaults.provider,'webgpu');
  return cell.inferenceLifecycle;
}

export function summarizeRawLifecycle(cell) {
  if(cell.inferenceLifecycle)return cell.inferenceLifecycle;
  const t=cell.result;
  return {authorizedInferRequests:t?.counts.runAttempts??0,acknowledgedCompletedSessionRuns:t?.runReceipts.length??0,
    terminalTeardownCancellations:0,failedOrRejectedRunPromises:t?.counts.runFailures??0,
    unattributedRequestLifecycle:'NOT_YET_CLASSIFIED',unattributedOrHiddenNeuralExecution:'NOT_YET_CLASSIFIED',
    internalSessionRunInvocationInterval:null,publishedCompletedRequests:t?.publications.length??0,accepted:false};
}
export function resourceAccounting(t,lifecycle) {
  return {AudioContexts:t.counts.context,rootStreams:t.counts.rootStreams,analysisClones:t.counts.analysisClones,productWorkers:t.counts.workerOwners,
    modelLoadAttempts:t.counts.loadAttempts,modelLoadsSucceeded:t.counts.loadSuccesses,modelSessionsObserved:t.modelReceipt?.actualSessionLoadCount??0,
    authorizedInferRequests:lifecycle.authorizedInferRequests,acknowledgedCompletedSessionRuns:lifecycle.acknowledgedCompletedSessionRuns,
    terminalTeardownCancellations:lifecycle.terminalTeardownCancellations,failedOrRejectedRunPromises:lifecycle.failedOrRejectedRunPromises,
    completedAfterTerminalCloseNotPublished:lifecycle.completedAfterTerminalCloseNotPublished??0,
    unattributedRequestLifecycle:lifecycle.unattributedRequestLifecycle,unattributedOrHiddenNeuralExecution:lifecycle.unattributedOrHiddenNeuralExecution,
    decoderRunsWithReceipts:t.runReceipts.length,publications:t.publications.length,attempts:t.attempts.length,retirementBoundaries:t.boundaries.length,
    workerDisposals:t.counts.workerDisposeCalls,sourceDisposals:t.counts.sourceDisposals,captureStopTransitions:t.counts.captureStopTransitions,
    infrastructureFailures:t.infrastructure.length,hiddenWarmups:0};
}
