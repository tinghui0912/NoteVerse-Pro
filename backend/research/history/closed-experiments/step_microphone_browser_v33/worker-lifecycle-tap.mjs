(() => {
  const host = globalThis;
  if (host.__v33WorkerLifecycle) throw new Error('V33_TAP_ALREADY_INSTALLED');
  const NativeWorker = host.Worker, trace = { version:1, events:[], workers:[], observerErrors:[], sequence:0 };
  host.__v33WorkerLifecycle = trace;
  const snap = () => {
    const t = host.v26Trace;
    if (!t) return null;
    const input = t.beforeInputDispose?.input ?? t.beforeInfrastructureLoss?.input ?? null;
    return { cell:t.cell,stage:t.stage,counts:{...t.counts},receiptCount:t.runReceipts.length,publicationCount:t.publications.length,attemptCount:t.attempts.length,
      normalBeforeDispose:t.beforeInputDispose ?? null,contextBeforeLoss:t.beforeInfrastructureLoss ?? null,
      infrastructure:t.infrastructure.map(v=>({code:v.code,state:v.state,atContextTime:v.atContextTime})),
      applicationFailures:t.applicationFailures.map(v=>({...v})),inputFailures:t.failures.map(v=>({message:v.message})),
      beforeInput:input ? {resourceState:input.resourceState,failure:input.failure,analysis:input.analysis} : null };
  };
  const add = (kind, worker, details={}) => {
    const e = { order:++trace.sequence,atMs:host.performance.now(),kind,workerId:worker.id,...details };
    trace.events.push(e); return e;
  };
  host.Worker = new Proxy(NativeWorker, { construct(target,args,newTarget) {
    const real = Reflect.construct(target,args,newTarget), url=String(args[0]), pathname=new URL(url,host.location.href).pathname;
    const owner={id:trace.workers.length+1,url,classification:pathname==='/acoustic-worker.entry.ts'?'PRODUCT_ACOUSTIC_OWNER':pathname.includes('/ort/')?'ORT_RUNTIME_SUBORDINATE':'UNCLASSIFIED_RUNTIME_WORKER',terminated:false};
    trace.workers.push(owner);add('CONSTRUCT',owner,{constructorArgumentURL:url});
    if(owner.classification!=='PRODUCT_ACOUSTIC_OWNER')return real;
    const pending=new Map(), nativePost=real.postMessage, nativeTerminate=real.terminate;
    real.addEventListener('message',event=>{
      const data=event.data, request=pending.get(data?.id);
      add('RESPONSE',owner,{requestId:data?.id??null,requestType:request?.requestType??null,matchedPending:!!request,
        error:data?.error??null,actualSessionRunCount:data?.result?.actualSessionRunCount??null,actualSessionLoadCount:data?.result?.actualSessionLoadCount??null,
        snapshot:snap()});
      if(request)pending.delete(data.id);
    });
    for(const type of ['error','messageerror'])real.addEventListener(type,()=>add('WORKER_ERROR',owner,{errorType:type,snapshot:snap()}));
    real.postMessage=function(...values){
      const data=values[0], record={requestId:data?.id??null,requestType:data?.type??null,window:data?.input?.window?{...data.input.window}:null,
        afterTermination:owner.terminated,snapshot:snap()};
      const entry=add('REQUEST',owner,record);pending.set(record.requestId,entry);
      try{return Reflect.apply(nativePost,real,values);}catch(error){add('POST_THROW',owner,{requestId:record.requestId,error:String(error),snapshot:snap()});throw error;}
    };
    real.terminate=function(...values){
      add('TERMINATE',owner,{pendingRequestIds:[...pending.keys()],pendingRequests:[...pending.values()].map(r=>({requestId:r.requestId,requestType:r.requestType,window:r.window,authorizationOrder:r.order})),snapshot:snap(),alreadyTerminated:owner.terminated});
      owner.terminated=true;return Reflect.apply(nativeTerminate,real,values);
    };
    return real;
  } });
})();
