import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT,OUT,DIR,bytes,sha,load,save,verify,remote,now,playwrightRoot } from './run.mjs';

const freeze=await verify(),proof=await load(OUT+'/remote-browser-freeze-proof.json'),startedAt=now();
assert.equal(proof.freezeSha256,sha(await bytes(OUT+'/browser-protocol-freeze.json')));assert.equal(remote(false),proof.freezeCommit);
assert.ok(proof.remoteVerifiedAt<startedAt);await save('browser-campaign-started.json',{startedAt,proof,campaignOrdinal:1,retriesAllowed:0});
const plan=freeze.contract,requests=[],diagnostics=[],workers=[],cells=plan.cells.map(c=>({...c,status:'NOT_STARTED'}));
const assets=new Map();
for(const [route,a]of Object.entries(freeze.build.assets)){const b=await bytes(a.path);assert.equal(sha(b),a.sha256);assets.set(route,{bytes:b,path:a.path});}
for(const [route,p]of [['/entry.js',OUT+'/bundles/entry.js'],['/acoustic-worker.entry.ts',OUT+'/bundles/worker.js']])assets.set(route,{bytes:await bytes(p),path:p});
let forbiddenRequests=0;
const server=createServer((req,res)=>{
  const route=req.url,allowed=req.method==='GET'&&(route==='/'||route==='/favicon.ico'||assets.has(route));
  requests.push({method:req.method,route,allowed,at:now()});
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(!allowed){forbiddenRequests++;res.statusCode=403;res.end('FROZEN_BROWSER_GRAPH_ASSETS_ONLY');return;}
  if(route==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>V26 disabled STEP browser core graph</title><link rel="icon" href="data:,"><script type="module" src="/entry.js"></script>');return;}
  if(route==='/favicon.ico'){res.statusCode=204;res.end();return;}
  const a=assets.get(route);res.setHeader('Content-Length',String(a.bytes.length));
  res.setHeader('Content-Type',a.path.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(a.path)?'text/javascript':'application/octet-stream');res.end(a.bytes);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,browserIdentity=null,GPU=null,failure=null,activeCell=null,disposition='STEP_V26_BROWSER_EXECUTION_INTEGRITY_BLOCKED';
const require=createRequire(import.meta.url),{chromium}=require(playwrightRoot);
try{
  browser=await chromium.launch({executablePath:plan.browser.executable,headless:false,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture='+path.join(ROOT,OUT,'browser-input.wav'),'--autoplay-policy=no-user-gesture-required']});
  const cdp=await browser.newBrowserCDPSession();
  browserIdentity={executable:plan.browser.executable,version:await browser.version(),headed:true,
    playwright:require(path.join(playwrightRoot,'package.json')).version,Browser:await cdp.send('Browser.getVersion'),SystemInfo:await cdp.send('SystemInfo.getInfo')};
  await cdp.detach();
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const cell of cells){
    activeCell=cell;cell.status='RUNNING';cell.startedAt=now();
    const context=await browser.newContext({permissions:['microphone']}),page=await context.newPage(),rows=[];
    diagnostics.push({cell:cell.id,rows});
    await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
    page.on('worker',w=>{const url=w.url();workers.push({cell:cell.id,url,classification:new URL(url).pathname==='/acoustic-worker.entry.ts'?'PRODUCT_ACOUSTIC_OWNER'
      :url.includes('/ort/')?'ORT_RUNTIME_SUBORDINATE':'UNCLASSIFIED_RUNTIME_WORKER',at:now()});});
    page.on('console',m=>rows.push({type:'console',level:m.type(),text:m.text(),at:now()}));
    page.on('pageerror',e=>rows.push({type:'pageerror',message:e.message,stack:e.stack,at:now()}));
    page.on('requestfailed',r=>rows.push({type:'requestfailed',url:r.url(),failure:r.failure(),at:now()}));
    let timer;
    try{
      await page.goto(base+'/');await page.waitForFunction(()=>typeof window.runV26==='function');
      cell.GPU=await page.evaluate(async()=>{
        if(!navigator.gpu)throw Error('WEBGPU_UNAVAILABLE');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('WEBGPU_ADAPTER_UNAVAILABLE');
        const i=adapter.info??await adapter.requestAdapterInfo?.();
        return {info:i?{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description}:null,
          features:[...adapter.features],isFallbackAdapter:adapter.isFallbackAdapter};
      });GPU??=cell.GPU;
      assert.ok(!cell.GPU.isFallbackAdapter&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(cell.GPU.info)),'REAL_HARDWARE_WEBGPU_REQUIRED');
      cell.result=await Promise.race([page.evaluate(c=>window.runV26(c),{id:cell.id,rate:cell.rate,scenario:cell.scenario}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FROZEN_CELL_EXECUTION_TIMEOUT')),plan.deadlines.cellMs);})]);
      if(cell.result.status!=='PASS')throw Error(cell.result.error??'PRODUCTION_GRAPH_CELL_FAILED');
      assert.equal(workers.filter(w=>w.cell===cell.id&&w.classification==='PRODUCT_ACOUSTIC_OWNER').length,1);
      assert.ok(!workers.some(w=>w.cell===cell.id&&w.classification==='UNCLASSIFIED_RUNTIME_WORKER'),'UNCLASSIFIED_WORKER_TAXONOMY');
      assert.equal(forbiddenRequests,0,'UNFROZEN_NETWORK_ROUTE');
      cell.status='PASS';cell.completedAt=now();console.log(JSON.stringify({cell:cell.id,status:cell.status,counts:cell.result.finalCounts,attempts:cell.result.attempts.length}));
    }catch(error){
      cell.result??=await page.evaluate(()=>window.v26Trace??null).catch(()=>null);cell.status='FAILED';cell.error=String(error.stack??error);cell.completedAt=now();
      const n=cell.result?.counts;
      disposition=n&&(n.workerOwners>0||n.captureConnections>0)?'STEP_V26_BROWSER_RESOURCE_GRAPH_PRODUCTION_DEFECT_FOUND':'STEP_V26_BROWSER_EXECUTION_INTEGRITY_BLOCKED';
      throw error;
    }finally{clearTimeout(timer);await context.close();}
  }
  disposition='STEP_V26_BROWSER_CORE_GRAPH_ONLY_ASSET_DELIVERY_NOT_QUALIFIED';
}catch(error){failure=String(error.stack??error);console.error(JSON.stringify({disposition,cell:activeCell?.id,failure}));}
finally{
  await browser?.close().catch(e=>diagnostics.push({browserCloseError:String(e)}));await new Promise(r=>server.close(r));
  await verify();await save('browser-campaign.json',{phase:plan.phase,startedAt,completedAt:now(),proof,browser:browserIdentity,GPU,
    cells,workers,diagnostics,requests,forbiddenRequests,failure,disposition,campaigns:1,cellRetries:0,
    productionAssetDeliveryQualified:false,modelUrlOverride:plan.assetDelivery,productionDiff:[],freshHoldoutAccess:0,
    capabilities:plan.capabilities,physicalDevice:'REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED',
    recognitionQualification:false,codeScope:DIR,nextAllowedPhase:'STOP_WAIT_FOR_INDEPENDENT_AUDIT'});
  console.log(disposition);if(failure)process.exitCode=1;
}
