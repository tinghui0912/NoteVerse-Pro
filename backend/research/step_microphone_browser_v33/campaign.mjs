import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT,OUT,V26,bytes,load,rawBytesSha256,save,now,remote,exists } from './io.mjs';
import { verify,chromeIdentity } from './control.mjs';
import { auditCell } from './audit.mjs';
import { INTEGRITY,SUCCESS,classifyFailure } from './classification.mjs';

async function authorizeCampaign(){
  const freeze=await verify(),proof=await load(OUT+'/remote-browser-freeze-proof.json');
  assert.equal(proof.freezeSha256,rawBytesSha256(await bytes(OUT+'/browser-protocol-freeze.json')));assert.equal(remote(false),proof.freezeCommit);
  assert.equal(proof.remoteHead,proof.freezeCommit);assert.ok(proof.remoteVerifiedAt<now());
  assert.equal(await exists(OUT+'/browser-campaign-started.json'),false,'NO_CAMPAIGN_RETRY');
  await save('browser-campaign-started.json',{startedAt:now(),proof,campaignOrdinal:1,cellRetries:0,
    authorization:freeze.contract.phase,symbol:freeze.contract.symbol});
  return {freeze,proof};
}

const {freeze,proof}=await authorizeCampaign();
const requests=[],diagnostics=[],workers=[],responses=[],cells=freeze.cells.map(c=>({...c,status:'NOT_STARTED'}));
const plan=freeze.campaignContract,assets=new Map();
let browser,server,browserIdentity=null,GPU=null,failure=null,causalFailure=null,activeCell=null;
let chromeLaunches=0,chromeLaunchAttempts=0,browserContexts=0,forbiddenRequests=0,externalRequests=0,browserLaunchAt=null,disposition=INTEGRITY;

try{
  await chromeIdentity(freeze.immutableCandidate.browserEnvironment);
  for(const a of freeze.immutableCandidate.assets){const b=await bytes(a.path);assert.equal(rawBytesSha256(b),a.sha256);assert.equal(b.length,a.bytes);assets.set(a.route,{bytes:b,path:a.path,sha256:a.sha256});}
  for(const [route,p]of [['/entry.js',V26+'/bundles/entry.js'],['/acoustic-worker.entry.ts',V26+'/bundles/worker.js']]){
    const a=freeze.immutableCandidate.artifacts.find(a=>a.path===p),b=await bytes(p);assert.equal(rawBytesSha256(b),a.sha256);assets.set(route,{bytes:b,path:p,sha256:a.sha256});
  }
  server=createServer((req,res)=>{
    const route=req.url,allowed=req.method==='GET'&&(route==='/'||route==='/favicon.ico'||assets.has(route));
    requests.push({method:req.method,route,allowed,at:now()});
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(!allowed){forbiddenRequests++;res.statusCode=403;res.end('V33_FROZEN_LOCAL_ASSETS_ONLY');return;}
    if(route==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>V33 immutable prepared browser core</title><link rel="icon" href="data:,"><script type="module" src="/entry.js"></script>');return;}
    if(route==='/favicon.ico'){res.statusCode=204;res.end();return;}
    const a=assets.get(route);res.setHeader('Content-Length',String(a.bytes.length));
    res.setHeader('Content-Type',a.path.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(a.path)?'text/javascript':'application/octet-stream');
    responses.push({route,path:a.path,domain:'EXTERNAL_LOCAL_ASSET',representation:'RAW_BYTES_SHA256',subject:{kind:'FROZEN_HTTP_RESPONSE_BYTES',route,sourcePath:a.path},sha256:a.sha256,bytes:a.bytes.length,at:now()});res.end(a.bytes);
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
      context=await browser.newContext({permissions:['microphone']});browserContexts++;
      await context.addInitScript({path:path.join(ROOT,freeze.workerTap.path)});page=await context.newPage();
      await context.route('**/*',r=>{if(r.request().url().startsWith(base+'/'))return r.continue();externalRequests++;rows.push({type:'external-request-blocked',url:r.request().url()});return r.abort();});
      page.on('worker',w=>{const url=w.url(),p=new URL(url).pathname;workers.push({cell:cell.id,url,at:now(),classification:p==='/acoustic-worker.entry.ts'?'PRODUCT_ACOUSTIC_OWNER':url.includes('/ort/')?'ORT_RUNTIME_SUBORDINATE':'UNCLASSIFIED_RUNTIME_WORKER'});});
      page.on('console',m=>rows.push({type:'console',level:m.type(),text:m.text(),at:now()}));
      page.on('pageerror',e=>rows.push({type:'pageerror',message:e.message,stack:e.stack,at:now()}));
      page.on('requestfailed',r=>rows.push({type:'requestfailed',url:r.url(),error:r.failure(),at:now()}));
      await page.goto(base+'/');await page.waitForFunction(()=>typeof window.runV26==='function');
      cell.GPU=await page.evaluate(async()=>{if(!navigator.gpu)throw Error('WEBGPU_UNAVAILABLE');const a=await navigator.gpu.requestAdapter();if(!a)throw Error('WEBGPU_ADAPTER_UNAVAILABLE');
        const i=a.info??await a.requestAdapterInfo?.();return{info:i?{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description}:null,features:[...a.features],isFallbackAdapter:a.isFallbackAdapter};});
      assert.ok(!cell.GPU.isFallbackAdapter&&!/swiftshader|software|llvmpipe/i.test(JSON.stringify(cell.GPU.info))&&/nvidia|intel|amd/i.test(cell.GPU.info?.vendor??''),'REAL_HARDWARE_WEBGPU_REQUIRED');
      cell.environmentValidated=true;GPU??=cell.GPU;cell.browserEntryInvokedAt=now();
      cell.result=await Promise.race([page.evaluate(c=>window.runV26(c),{id:cell.id,rate:cell.rate,scenario:cell.scenario}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FROZEN_CELL_EXECUTION_TIMEOUT')),plan.deadlines.cellMs);})]);
      cell.workerLifecycle=await page.evaluate(()=>globalThis.__v33WorkerLifecycle);
      cell.auditEnvironment={pageErrors:rows.filter(r=>r.type==='pageerror'),forbiddenRequests,externalRequests};
      auditCell(cell,plan,workers);
      assert.equal(workers.filter(w=>w.cell===cell.id&&w.classification==='PRODUCT_ACOUSTIC_OWNER').length,1,'PRODUCT_WORKER_EVENT_COUNT');
      assert.ok(!workers.some(w=>w.cell===cell.id&&w.classification==='UNCLASSIFIED_RUNTIME_WORKER'),'UNCLASSIFIED_WORKER_TAXONOMY');
      assert.equal(forbiddenRequests+externalRequests,0,'UNFROZEN_NETWORK_REQUEST');
      assert.equal(rows.filter(r=>r.type==='pageerror').length,0,'BROWSER_PAGE_ERROR');
      cell.status='PASS';cell.completedAt=now();console.log(JSON.stringify({cell:cell.id,status:cell.status,accounting:cell.executionAccounting}));
    }catch(error){
      cell.result??=await page?.evaluate(()=>window.v26Trace??null).catch(()=>null);
      cell.workerLifecycle??=await page?.evaluate(()=>globalThis.__v33WorkerLifecycle??null).catch(()=>null);
      cell.auditEnvironment??={pageErrors:rows.filter(r=>r.type==='pageerror'),forbiddenRequests,externalRequests};
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
  await save('browser-campaign.json',{phase:freeze.contract.phase,proof,startedAt:(await load(OUT+'/browser-campaign-started.json')).startedAt,
    completedAt:now(),browserLaunchAt,remoteProofPrecededLaunch:browserLaunchAt?proof.remoteVerifiedAt<browserLaunchAt:null,
    browser:browserIdentity,GPU,cells,workers,requests,responses,diagnostics,forbiddenRequests,externalRequests,
    chromeLaunchAttempts,chromeLaunches,browserContexts,campaigns:1,cellRetries:0,bundleRebuilds:0,
    V26NotResumed:true,V27NotRepaired:true,V28NotRepaired:true,newProspectivePhase:true,authorization:freeze.contract.phase,symbol:freeze.contract.symbol,
    failure,causalFailure,disposition,assetDelivery:'CORE_GRAPH_ONLY_RESEARCH_MODEL_URL_OVERRIDE',
    freshHoldoutAccess:0,physicalDevice:'REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED',recognitionQualified:false,
    productionAssetDeliveryQualified:false,permissionUXQualified:false,productionDiff:[],historicalDiff:[],
    capabilities:freeze.contract.capabilities,stop:'STOP_FOR_INDEPENDENT_AUDIT'});
  console.log(disposition);if(failure)process.exitCode=1;
}
