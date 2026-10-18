import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,FIXTURE,paths,verify,newJson,fileIdentity,STAGE} from './protocol.mjs';
import {instrumentWorklet} from '../qualification/worklet-diagnostics.mjs';
import {RUNTIME_NODE_MODULES,resolveBrandedBrowserExecutable} from '../../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
const proof=await verify(),work=paths().work;
await mkdir(work,{recursive:true});
const contract=JSON.parse(await readFile(path.join(APP,'scripts/capture-transport/contract.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(APP,'scripts/capture-transport/stress-entry.ts')],outfile:path.join(work,'stress.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
const workletPath='apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js';
const worklet=instrumentWorklet(await readFile(path.join(ROOT,workletPath),'utf8'));
const bundle=await readFile(path.join(work,'stress.js'));
const server=createServer((req,res)=>{
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/stress.js"></script>');}
 else if(req.url==='/capture.worklet.js'||req.url==='/stress.js'){res.setHeader('Content-Type','text/javascript');res.end(req.url==='/stress.js'?bundle:worklet);}
 else{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url),{chromium}=require(path.join(RUNTIME_NODE_MODULES,'playwright'));
let browser;const cells=[];
try{
 browser=await chromium.launch({executablePath:resolveBrandedBrowserExecutable('chrome'),headless:false,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(ROOT,FIXTURE)}`]});
 for(const rate of contract.diagnosticMatrix.rates)for(const stallMs of contract.diagnosticMatrix.mainThreadStallsMs){
  const context=await browser.newContext(),page=await context.newPage();
  try{await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.runTransportStress==='function');
   const result=await page.evaluate(({rate,stallMs})=>window.runTransportStress(rate,stallMs),{rate,stallMs});cells.push(result);
   console.log(rate,stallMs,result.failure??'PASS',JSON.stringify(result.diagnostics.totals));
  }finally{await context.close();}
 }
}finally{
 const browserVersion=browser?await browser.version():null;await browser?.close();await new Promise(r=>server.close(r));
 const supported=contract.supportedAcceptanceStallsMs??[];
 const pass=cells.length===8&&cells.filter(c=>supported.includes(c.stallMs)).every(c=>!c.failure&&c.actualRate===c.rate&&c.diagnostics.totals.ackOrderViolations===0);
 await newJson(path.join(work,'transport-stress.json'),{...proof,transportExecutionProof:proof,stage:STAGE,browserVersion,headed:true,
  status:STAGE==='diagnostic'?'DIAGNOSTIC_COMPLETE':pass?'PASS':'BLOCKED',cells,worklet:await fileIdentity(workletPath),actualNeuralRuns:0,
  supportedAcceptanceStallsMs:supported,diagnosticPcmRetention:false});
 if(STAGE==='acceptance'&&!pass)process.exitCode=1;
}
