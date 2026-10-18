import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,FIXTURE,paths,verify,newJson,fileIdentity} from './protocol.mjs';
import {instrumentWorklet} from '../qualification/worklet-diagnostics.mjs';
import {RUNTIME_NODE_MODULES,resolveBrandedBrowserExecutable} from '../../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
const proof=await verify(),work=paths().work,mode=process.argv[2]??'stress';
if(!['stress','cold'].includes(mode))throw Error('INVALID_TRANSPORT_GATE');
const verification=JSON.parse(await readFile(path.join(work,'verification.json'),'utf8'));
if(verification.status!=='PASS'||verification.freezeCommit!==proof.freezeCommit)throw Error('STATIC_GATE_NOT_PASS');
if(mode==='cold'&&JSON.parse(await readFile(path.join(work,'transport-stress.json'),'utf8')).status!=='PASS')throw Error('STRESS_GATE_NOT_PASS');
await mkdir(work,{recursive:true});
const contract=JSON.parse(await readFile(path.join(APP,'scripts/capture-aggregation/contract.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(APP,'scripts/capture-aggregation/transport-entry.ts')],outfile:path.join(work,'transport.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
const workletPath='apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js';
const worklet=instrumentWorklet(await readFile(path.join(ROOT,workletPath),'utf8')),bundle=await readFile(path.join(work,'transport.js'));
const server=createServer((req,res)=>{
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/transport.js"></script>');}
 else if(req.url==='/capture.worklet.js'||req.url==='/transport.js'){res.setHeader('Content-Type','text/javascript');res.end(req.url==='/transport.js'?bundle:worklet);}
 else{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url),{chromium}=require(path.join(RUNTIME_NODE_MODULES,'playwright'));
const cells=contract.rates.flatMap(rate=>mode==='cold'?Array.from({length:contract.coldStartsPerRate},(_,trial)=>({rate,trial,stallMs:null,state:'NOT_STARTED'})):
 [...contract.supportedStallsMs,contract.unsupportedStallMs].map(stallMs=>({rate,stallMs,state:'NOT_STARTED'})));
let failure=null,browserVersion=null;
try{
 for(const cell of cells){
  cell.state='RUNNING';cell.startedAt=new Date().toISOString();
  // Fresh process for every cold-start/stress trial; never retry a failed cell.
  const browser=await chromium.launch({executablePath:resolveBrandedBrowserExecutable('chrome'),headless:false,args:[
   '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(ROOT,FIXTURE)}`]});
  browserVersion=await browser.version();const context=await browser.newContext(),page=await context.newPage();
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.runAggregationTrial==='function');
   const r=cell.result=await page.evaluate(({rate,stallMs})=>window.runAggregationTrial(rate,stallMs),cell);
   const totals=r.diagnostics.totals,first=r.diagnostics.firstAuthoritative;
   const expectedOverflow=cell.stallMs===contract.unsupportedStallMs;
   const failureCorrect=expectedOverflow?r.failure?.endsWith('ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED'):r.failure===null;
   const pass=failureCorrect&&r.ready&&r.actualRate===cell.rate&&first?.sourceStart===0&&Number.isSafeInteger(first.frame)
    &&totals.messages===r.capture.blocks&&totals.samples===r.acceptedSamples&&r.acceptedSamples===r.capture.nextSourceSampleIndex
    &&r.acceptedSamples===r.capture.blocks*2048&&totals.checksumMismatches===0&&totals.ackOrderViolations===0
    &&totals.peakUnacked<=32&&totals.acknowledgements===totals.messages
    &&(expectedOverflow?totals.peakUnacked===32:r.diagnostics.latestWorklet?.state==='ACTIVE')
    &&r.cleanup.contextClosed&&r.cleanup.rootEnded&&r.cleanup.clones===1&&r.cleanup.allAnalysisClonesEnded;
   cell.preActiveStabilizationRestarts=r.diagnostics.latestWorklet?.stabilizationRestarts??0;
   cell.postActiveDiscontinuities=/FRAME_DISCONTINUITY|INPUT_UNAVAILABLE|CHRONOLOGY/.test(r.failure??'')?1:0;
   cell.state=pass?'PASS':'FAILED';cell.completedAt=new Date().toISOString();
   console.log(cell.rate,cell.stallMs??`cold${cell.trial}`,cell.state,r.failure??'ACTIVE',JSON.stringify(totals));
   if(!pass)throw Error('FIRST_TRANSPORT_INVARIANT_VIOLATED:'+JSON.stringify({rate:cell.rate,stallMs:cell.stallMs,trial:cell.trial,failure:r.failure,totals}));
  }finally{await context.close();await browser.close();}
 }
}catch(error){failure=String(error.stack??error);const active=cells.find(c=>c.state==='RUNNING');if(active)active.state='FAILED';process.exitCode=1;}
finally{
 await new Promise(r=>server.close(r));
 await newJson(path.join(work,mode==='cold'?'cold-start.json':'transport-stress.json'),{...proof,transportExecutionProof:proof,mode,
  browserVersion,headed:true,freshBrowserPerCell:true,status:failure?'BLOCKED':'PASS',failure,cells,contract,
  worklet:await fileIdentity(workletPath),actualNeuralRuns:0,diagnosticPcmRetention:false});
}
