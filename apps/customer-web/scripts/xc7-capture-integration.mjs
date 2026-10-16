import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {access,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,WORK,freezeId,requireRemoteFreeze,newJson,fileId,load} from './xc7-evidence.mjs';
import {launchCaptureBrowser} from './xc6-capture-probe.mjs';
import {attachDiagnostics} from './xc6-browser-diagnostics.mjs';
import {collectWebGpuAdapter} from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';

async function compile(){
  const work=path.join(WORK,freezeId);await mkdir(work,{recursive:true});
  const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const rows=[];
  for(const [entry,out]of [['scripts/xc7-capture-entry.ts','entry.js'],['src/lib/practice/acoustic-inference/xc4-robust-worker.entry.ts','worker.js']]){
    await esbuild.build({entryPoints:[path.join(APP,entry)],outfile:path.join(work,out),bundle:true,format:'esm',platform:'browser',target:'es2022',
      sourcemap:'inline',logLevel:'silent',nodePaths:[path.join(APP,'node_modules')],plugins:[{name:'pinned-ort-assets',setup(b){
        b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}]});
    rows.push(await fileId(path.join(work,out)));
  }
  await newJson(path.join(work,'bundle_compile.json'),{kind:'ENGINEERING_ENTRY_AND_WORKER_BUNDLES_NOT_FULL_PRODUCTION_BUILD',success:true,rows,at:new Date().toISOString()});
  return work;
}
async function main(){
  const proof=await requireRemoteFreeze(),checks=await load(path.join(WORK,`checks_${freezeId}.json`));
  if(checks.runs.length!==2||checks.runs.some(r=>r.exitCode!==0))throw new Error('XC7_CHECKS_NOT_PASS');
  const work=await compile();
  for(const name of ['result.json','attempt.json']){try{await access(path.join(work,name));throw new Error('XC7_BROWSER_ALREADY_ATTEMPTED');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await newJson(path.join(work,'attempt.json'),{proof,at:new Date().toISOString(),maxModelRuns:2,realDeviceProbe:false});
  const model=path.join(ROOT,'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx');
  const files=new Map([['/entry.js',path.join(work,'entry.js')],['/worker.js',path.join(work,'worker.js')],['/model.onnx',model],
    ['/fir48.f32',path.join(APP,'public/engineering/xc6/fir-1-3.f32')],
    ['/capture.worklet.js',path.join(APP,'src/lib/practice/acoustic-inference/xc7-capture.worklet.js')]]);
  for(const name of ['ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'])files.set('/ort/'+name,path.join(APP,'node_modules/onnxruntime-web/dist',name));
  const requests=[],server=createServer((req,res)=>{
    const url=req.url?.split('?')[0];requests.push({url,at:new Date().toISOString()});
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>XC7 disabled bounded fake capture</title><script type="module" src="/entry.js"></script>');return;}
    if(url==='/favicon.ico'){res.statusCode=204;res.end();return;}
    const file=files.get(url);if(!file){res.statusCode=403;res.end('NO_ROUTE');return;}
    res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(file)?'text/javascript':'application/octet-stream');
    createReadStream(file).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,diagnostics;
  try{
    const executionStartedAt=new Date().toISOString(),launched=await launchCaptureBrowser(true);browser=launched.browser;
    const page=await browser.newPage();diagnostics=await attachDiagnostics(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);const gpu=await collectWebGpuAdapter(page);
    await page.waitForFunction(()=>typeof window.runXc7CaptureIntegration==='function');
    const result=await page.evaluate(()=>window.runXc7CaptureIntegration());
    const logs=await diagnostics.finish();
    if(logs.rows.some(r=>r.method==='Runtime.exceptionThrown'||JSON.stringify(r).includes('window is not defined'))
      ||logs.requests.some(r=>r.status>=400))throw new Error('XC7_BROWSER_DIAGNOSTIC_FAILURE');
    await newJson(path.join(work,'result.json'),{phase:proof.phase,proof,executionStartedAt,browser:launched.identity,gpu,result,diagnostics:logs,requests});
    console.log(JSON.stringify({status:result.status,modelRuns:result.actualSessionRunCount,streamed:result.streamingPublicationCount,
      resources:result.snapshot.resources,outstanding:result.snapshot.outstandingDepth}));
  }catch(error){await newJson(path.join(work,'failure.json'),{proof,error:String(error.stack??error),diagnostics:await diagnostics?.finish(),requests});throw error;}
  finally{await browser?.close();await new Promise(r=>server.close(r));}
}
await main();
