import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT,OUT,V26,bytes,load,sha,save,now,remote,exists } from './io.mjs';
import { verify,chromeIdentity } from './control.mjs';
import { INTEGRITY,SUCCESS,classifyFailure } from './classification.mjs';

async function authorizeCampaign(){
  const freeze=await verify(),proof=await load(OUT+'/remote-browser-freeze-proof.json');
  assert.equal(proof.freezeSha256,sha(await bytes(OUT+'/browser-protocol-freeze.json')));assert.equal(remote(false),proof.freezeCommit);
  assert.equal(proof.remoteHead,proof.freezeCommit);assert.ok(proof.remoteVerifiedAt<now());
  assert.equal(await exists(OUT+'/browser-campaign-started.json'),false,'NO_CAMPAIGN_RETRY');
  await save('browser-campaign-started.json',{startedAt:now(),proof,campaignOrdinal:1,cellRetries:0,
    authorization:freeze.contract.authorization,symbol:freeze.contract.symbol});
  return {freeze,proof};
}

const {freeze,proof}=await authorizeCampaign();
const requests=[],diagnostics=[],workers=[],responses=[],cells=freeze.cells.map(c=>({...c,status:'NOT_STARTED'}));
const plan=freeze.campaignContract,assets=new Map();
let browser,server,browserIdentity=null,GPU=null,failure=null,causalFailure=null,activeCell=null;
let chromeLaunches=0,chromeLaunchAttempts=0,browserContexts=0,forbiddenRequests=0,externalRequests=0,browserLaunchAt=null,disposition=INTEGRITY;
const stats=v=>{if(!v.length)return{count:0,p50:null,p95:null,max:null};const a=[...v].sort((a,b)=>a-b);return{count:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
function auditCell(cell){
  const t=cell.result,n=t.counts,last=t.runReceipts.at(-1)?.actualSessionRunCount??0;
  const unresolved=Math.max(0,n.runAttempts-last);
  cell.executionAccounting={AudioContexts:n.context,rootStreams:n.rootStreams,analysisClones:n.analysisClones,productWorkers:n.workerOwners,
    modelLoadAttempts:n.loadAttempts,modelLoadsSucceeded:n.loadSuccesses,modelSessionsObserved:t.modelReceipt?.actualSessionLoadCount??0,
    neuralRunRequests:n.runAttempts,successfulInferenceResponses:n.runSuccesses,failedInferenceResponses:n.runFailures,
    actualSessionRunsWithReceipts:last,decoderRunsWithReceipts:t.runReceipts.length,unacknowledgedModelRequests:unresolved,
    publications:t.publications.length,attempts:t.attempts.length,retirementBoundaries:t.boundaries.length,
    workerDisposals:n.workerDisposeCalls,sourceDisposals:n.sourceDisposals,captureStopTransitions:n.captureStopTransitions,
    infrastructureFailures:t.infrastructure.length,hiddenWarmups:0,unknownExecutions:unresolved+Math.max(0,n.loadAttempts-n.loadSuccesses)};
  cell.engineeringDiagnostics={inferenceMs:stats(t.runReceipts.map(r=>r.inferenceMs)),capture:t.afterInputCleanup?.input?.capture,
    analysis:t.afterInputCleanup?.input?.analysis,assembler:t.afterInputCleanup?.input?.assembler,
    verdicts:Object.fromEntries(['MATCH','RETRY','MISMATCH'].map(v=>[v,t.attempts.filter(a=>a.record.verdict===v).length])),
    noPhysicalUXLatencyClaim:true};
  if(t.status!=='PASS')throw Error(t.error??'IMMUTABLE_BROWSER_ENTRY_FAILED');
  assert.equal(unresolved,0,'UNRESOLVED_NEURAL_EXECUTION_RECEIPT');
  assert.equal(t.modelReceipt.actualSessionLoadCount,1);assert.equal(t.modelReceipt.ortWebVersion,'1.20.1');
  assert.equal(t.modelReceipt.modelSha256,plan.currentDefaults.modelSHA256);assert.equal(t.modelReceipt.executionProvider,'webgpu');
  assert.equal(t.modelReceipt.automaticFallback,false);
  for(const name of ['rootStreams','analysisClones','context','workerOwners','loadAttempts','loadSuccesses','sourceRuntimes','chronologyInstances','assemblerInstances','captureConnections'])assert.equal(n[name],1,'OWNER_COUNT:'+name);
  assert.equal(t.afterInputCleanup.input.analysis.counts.regionsStarted,1);assert.equal(n.workerDisposeCalls,1);assert.equal(n.sourceDisposals,1);
  assert.equal(t.afterInputCleanup.input.analysis.state,'DISPOSED');
  let end=0,origin=null;
  for(const [i,c]of t.chronology.entries()){
    assert.equal(c.sequence,i);assert.equal(c.start,end);assert.equal(c.end-c.start,c.count);assert.equal(c.rate,cell.rate);
    if(origin===null)origin=c.origin;else assert.equal(c.origin,origin);end=c.end;
  }
  cell.captureChronology={gapless:true,fixedOrigin:origin,chunks:t.chronology.length,samples:end,rate:cell.rate};
  for(const b of t.boundaries){assert.equal(b.boundary.capturedThroughSourceSample,b.before.input.capture.capturedThroughSourceSample);
    assert.equal(b.boundary.capturedThroughSourceSample,b.before.input.analysis.nextSourceSampleIndex);
    assert.equal(b.boundary.sessionTime.sampleIndex,b.boundary.capturedThroughSourceSample);assert.equal(b.sameSynchronousCallStack,true);}
  const assigned=new Set();
  for(const [i,a]of t.attempts.entries()){
    assert.equal(a.evidence.kind,'EVIDENCE');assert.equal(a.oracleAssertionAfterRuntime,true);
    assert.equal(a.before.version.schemaVersion,6);assert.equal(a.before.version.runtimeVersion,'step-source-sensitive-verdict-v6');
    const anchor=a.identity.attemptStartSessionTime.sampleIndex,finish=a.evidence.captureEndSessionTime.sampleIndex;
    assert.equal(finish-anchor,cell.rate*.05);assert.ok(anchor>t.boundaries[i].boundary.capturedThroughSourceSample);
    assert.equal(a.identity.targetGeneration,t.boundaries[i].after.domain.step.targetGeneration);
    const bounded=t.publications.flatMap(p=>p.observations).filter(o=>o.sourceEventSample>=anchor&&o.sourceEventSample<finish);
    assert.ok(bounded.length);for(const o of bounded){assert.ok(!assigned.has(o.observationId),'OBSERVATION_TWO_ATTEMPTS');assigned.add(o.observationId);}
    assert.deepStrictEqual([...new Set(bounded.map(o=>o.pitch))].sort(),a.evidence.observedAttackPitches);
    assert.equal(Math.min(...bounded.map(o=>o.confidence)),a.evidence.confidence);
  }
  const teardown=t.teardown.find(x=>x.kind==='INPUT_DISPOSE');assert.ok(teardown);
  assert.ok(teardown.clone.every(x=>x==='ended'));
  if(cell.scenario==='normal'){assert.ok(teardown.root.every(x=>x==='live'));assert.equal(teardown.contextState,'running');}
  cell.independentGates={ordinaryEvidence:true,physicalRetirementOnly:true,observationReuse:0,oneLongLivedGraph:true,
    sameTargetExercise:t.sameTargetAcceptance,capturedThroughGreaterThanProcessed:t.boundaries.some(b=>b.before.input.assembler.processedThroughSourceSample!==null&&b.boundary.capturedThroughSourceSample>b.before.input.assembler.processedThroughSourceSample)};
}

try{
  await chromeIdentity(freeze.immutableCandidate.build.environment);
  for(const a of freeze.immutableCandidate.assets){const b=await bytes(a.path);assert.equal(sha(b),a.sha256);assert.equal(b.length,a.bytes);assets.set(a.route,{bytes:b,path:a.path,sha256:a.sha256});}
  for(const [route,p]of [['/entry.js',V26+'/bundles/entry.js'],['/acoustic-worker.entry.ts',V26+'/bundles/worker.js']]){
    const a=freeze.immutableCandidate.artifacts.find(a=>a.path===p),b=await bytes(p);assert.equal(sha(b),a.sha256);assets.set(route,{bytes:b,path:p,sha256:a.sha256});
  }
  server=createServer((req,res)=>{
    const route=req.url,allowed=req.method==='GET'&&(route==='/'||route==='/favicon.ico'||assets.has(route));
    requests.push({method:req.method,route,allowed,at:now()});
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(!allowed){forbiddenRequests++;res.statusCode=403;res.end('V27_FROZEN_LOCAL_ASSETS_ONLY');return;}
    if(route==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>V27 immutable prepared browser core</title><link rel="icon" href="data:,"><script type="module" src="/entry.js"></script>');return;}
    if(route==='/favicon.ico'){res.statusCode=204;res.end();return;}
    const a=assets.get(route);res.setHeader('Content-Length',String(a.bytes.length));
    res.setHeader('Content-Type',a.path.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(a.path)?'text/javascript':'application/octet-stream');
    responses.push({route,path:a.path,sha256:a.sha256,bytes:a.bytes.length,at:now()});res.end(a.bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const require=createRequire(import.meta.url),playwrightRoot=path.join(ROOT,freeze.playwright.path),{chromium}=require(playwrightRoot);
  assert.equal(require(path.join(playwrightRoot,'package.json')).version,freeze.playwright.version);
  browserLaunchAt=now();assert.ok(proof.remoteVerifiedAt<browserLaunchAt,'REMOTE_PROOF_MUST_PRECEDE_LAUNCH');chromeLaunchAttempts++;
  browser=await chromium.launch({executablePath:freeze.chrome.executable,headless:false,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture='+path.join(ROOT,V26,'browser-input.wav'),'--autoplay-policy=no-user-gesture-required']});chromeLaunches++;
  const cdp=await browser.newBrowserCDPSession();browserIdentity={executable:freeze.chrome.executable,version:await browser.version(),headed:true,
    playwright:freeze.playwright.version,CDPBrowser:await cdp.send('Browser.getVersion'),CDPSystem:await cdp.send('SystemInfo.getInfo')};await cdp.detach();
  assert.equal(browserIdentity.version,freeze.chrome.staticFileVersion,'ACTUAL_CHROME_VERSION_MISMATCH');
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const cell of cells){
    activeCell=cell;cell.status='RUNNING';cell.startedAt=now();let context,page,timer;const rows=[];
    diagnostics.push({cell:cell.id,rows});
    try{
      context=await browser.newContext({permissions:['microphone']});browserContexts++;page=await context.newPage();
      await context.route('**/*',r=>{if(r.request().url().startsWith(base+'/'))return r.continue();externalRequests++;rows.push({type:'external-request-blocked',url:r.request().url()});return r.abort();});
      page.on('worker',w=>{const url=w.url(),p=new URL(url).pathname;workers.push({cell:cell.id,url,at:now(),classification:p==='/acoustic-worker.entry.ts'?'PRODUCT_ACOUSTIC_OWNER':url.includes('/ort/')?'ORT_RUNTIME_SUBORDINATE':'UNCLASSIFIED_RUNTIME_WORKER'});});
      page.on('console',m=>rows.push({type:'console',level:m.type(),text:m.text(),at:now()}));
      page.on('pageerror',e=>rows.push({type:'pageerror',message:e.message,stack:e.stack,at:now()}));
      page.on('requestfailed',r=>rows.push({type:'requestfailed',url:r.url(),error:r.failure(),at:now()}));
      await page.goto(base+'/');await page.waitForFunction(()=>typeof window.runV26==='function');
      cell.GPU=await page.evaluate(async()=>{if(!navigator.gpu)throw Error('WEBGPU_UNAVAILABLE');const a=await navigator.gpu.requestAdapter();if(!a)throw Error('WEBGPU_ADAPTER_UNAVAILABLE');
        const i=a.info??await a.requestAdapterInfo?.();return{info:i?{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description}:null,features:[...a.features],isFallbackAdapter:a.isFallbackAdapter};});
      assert.ok(!cell.GPU.isFallbackAdapter&&!/swiftshader|software|llvmpipe/i.test(JSON.stringify(cell.GPU.info)),'REAL_HARDWARE_WEBGPU_REQUIRED');
      cell.environmentValidated=true;GPU??=cell.GPU;cell.browserEntryInvokedAt=now();
      cell.result=await Promise.race([page.evaluate(c=>window.runV26(c),{id:cell.id,rate:cell.rate,scenario:cell.scenario}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FROZEN_CELL_EXECUTION_TIMEOUT')),plan.deadlines.cellMs);})]);
      auditCell(cell);
      assert.equal(workers.filter(w=>w.cell===cell.id&&w.classification==='PRODUCT_ACOUSTIC_OWNER').length,1,'PRODUCT_WORKER_EVENT_COUNT');
      assert.ok(!workers.some(w=>w.cell===cell.id&&w.classification==='UNCLASSIFIED_RUNTIME_WORKER'),'UNCLASSIFIED_WORKER_TAXONOMY');
      assert.equal(forbiddenRequests+externalRequests,0,'UNFROZEN_NETWORK_REQUEST');
      cell.status='PASS';cell.completedAt=now();console.log(JSON.stringify({cell:cell.id,status:cell.status,accounting:cell.executionAccounting}));
    }catch(error){
      cell.result??=await page?.evaluate(()=>window.v26Trace??null).catch(()=>null);
      if(cell.result&&!cell.executionAccounting){try{auditCell(cell);}catch{/* Preserve original first failure. */}}
      cell.status='FAILED';cell.error=String(error.stack??error);cell.completedAt=now();
      cell.failureClassification=classifyFailure({message:cell.error,trace:cell.result,environmentValid:cell.environmentValidated===true,networkValid:forbiddenRequests+externalRequests===0});
      causalFailure=cell.failureClassification;disposition=causalFailure.disposition;throw error;
    }finally{clearTimeout(timer);await context?.close();}
  }
  disposition=SUCCESS;
}catch(error){failure=String(error.stack??error);causalFailure??={disposition:INTEGRITY,reason:'PRE_CELL_TOOLING_ENVIRONMENT_OR_LAUNCH_FAILURE'};
  disposition=causalFailure.disposition;console.error(JSON.stringify({disposition,cell:activeCell?.id,error:failure,classification:causalFailure.reason}));}
finally{
  await browser?.close().catch(e=>diagnostics.push({browserCloseError:String(e)}));if(server)await new Promise(r=>server.close(r));
  await verify();await save('browser-campaign.json',{phase:freeze.contract.phase,proof,startedAt:(await load(OUT+'/browser-campaign-started.json')).startedAt,
    completedAt:now(),browserLaunchAt,remoteProofPrecededLaunch:browserLaunchAt?proof.remoteVerifiedAt<browserLaunchAt:null,
    browser:browserIdentity,GPU,cells,workers,requests,responses,diagnostics,forbiddenRequests,externalRequests,
    chromeLaunchAttempts,chromeLaunches,browserContexts,campaigns:1,cellRetries:0,bundleRebuilds:0,
    V26NotResumed:true,authorization:freeze.contract.authorization,symbol:freeze.contract.symbol,
    failure,causalFailure,disposition,assetDelivery:'CORE_GRAPH_ONLY_RESEARCH_MODEL_URL_OVERRIDE',
    freshHoldoutAccess:0,physicalDevice:freeze.contract.physicalDevice,recognitionQualified:false,
    productionAssetDeliveryQualified:false,permissionUXQualified:false,productionDiff:[],historicalDiff:[],
    capabilities:freeze.contract.capabilities,nextAllowedPhase:freeze.contract.nextAllowedPhase});
  console.log(disposition);if(failure)process.exitCode=1;
}
