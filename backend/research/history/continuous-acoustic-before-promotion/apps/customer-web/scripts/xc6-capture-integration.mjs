import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,WORK,load,newJson,requireRemoteFreeze,fileId,canonical,freezePath,hash} from './xc6-evidence.mjs';
import {launchCaptureBrowser} from './xc6-capture-probe.mjs';
import {attachDiagnostics} from './xc6-browser-diagnostics.mjs';
import {collectWebGpuAdapter} from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';

export async function compileCapture(){
  const work=path.join(WORK,'integration');await mkdir(work,{recursive:true});
  const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  for(const[entry,out]of[['scripts/xc6-capture-entry.ts','entry.js'],['src/lib/practice/acoustic-inference/xc4-robust-worker.entry.ts','worker.js']]){
    await esbuild.build({entryPoints:[path.join(APP,entry)],outfile:path.join(work,out),bundle:true,format:'esm',platform:'browser',target:'es2022',sourcemap:'inline',logLevel:'silent',nodePaths:[path.join(APP,'node_modules')],
      plugins:[{name:'pinned-unbundled-ort-asset-bootstrap',setup(build){build.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}]});
  }
  return work;
}
export async function runCapture(){
  const proof=await requireRemoteFreeze('capture_integration'),plan=await load(freezePath('capture_integration'));
  for(const row of plan.assets)if(canonical(await fileId(path.join(ROOT,row.path)))!==canonical(row))throw new Error('XC6_CAPTURE_ASSET_DRIFT:'+row.path);
  const work=await compileCapture(),output=path.join(work,'result.json');
  try{await access(output);throw new Error('XC6_INTEGRATION_ALREADY_EXECUTED');}catch(e){if(e.code!=='ENOENT')throw e;}
  await newJson(path.join(work,'remote_freeze_proof.json'),proof);
  const model=path.join(ROOT,'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx');
  const bytes=await readFile(model);if(bytes.length!==98689283||hash(bytes)!=='4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3')throw new Error('MODEL_DRIFT');
  const files=new Map([['/entry.js',path.join(work,'entry.js')],['/worker.js',path.join(work,'worker.js')],['/model.onnx',model],
    ['/capture.worklet.js',path.join(APP,'src/lib/practice/acoustic-inference/xc6-capture.worklet.js')],
    ['/fir48.f32',path.join(APP,'public/engineering/xc6/fir-1-3.f32')],['/dsp-reference.json',path.join(WORK,'dsp48_reference.json')]]);
  const reference=await load(path.join(WORK,'dsp48_reference.json'));
  for(const f of reference.fixtures)for(const key of['input','reference'])files.set('/dsp/'+f[key],path.join(WORK,f[key]));
  for(const name of['ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'])files.set('/ort/'+name,path.join(APP,'node_modules/onnxruntime-web/dist',name));
  const serverRequests=[],server=createServer((req,res)=>{
    const url=req.url?.split('?')[0];serverRequests.push({url,timestamp:new Date().toISOString()});
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>XC6 disabled fake-media integration</title><script type="module" src="/entry.js"></script>');return;}
    if(url==='/favicon.ico'){res.statusCode=204;res.end();return;}
    const file=files.get(url);if(!file){res.statusCode=403;res.end('NO_ROUTE');return;}
    res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(file)?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');
    createReadStream(file).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,diagnostics;
  try{
    const executionStartedAt=new Date().toISOString(),launched=await launchCaptureBrowser(true);browser=launched.browser;
    const page=await browser.newPage();diagnostics=await attachDiagnostics(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);const gpu=await collectWebGpuAdapter(page);
    await page.waitForFunction(()=>typeof window.runXc6CaptureIntegration==='function');
    const result=await page.evaluate(()=>window.runXc6CaptureIntegration());
    const logs=await diagnostics.finish();
    if(logs.rows.some(r=>JSON.stringify(r).includes('window is not defined'))||logs.requests.some(r=>r.status>=400))throw new Error('XC6_KNOWN_HARNESS_DIAGNOSTIC_NOT_RESOLVED');
    await newJson(output,{proof,executionStartedAt,browser:launched.identity,gpu,result,diagnostics:logs,serverRequests});
    console.log(JSON.stringify({status:result.status,rate:result.actualCaptureRateHz,actualSessionRunCount:result.actualSessionRunCount,
      blocks:result.result.captureMetadata.blocks,gaps:result.result.captureMetadata.gapCount,windows:result.result.publications.length,outstanding:result.result.outstandingDepth}));
  }catch(error){await newJson(path.join(work,'failure.json'),{proof,error:String(error.stack??error),diagnostics:await diagnostics?.finish(),serverRequests});throw error;}
  finally{await browser?.close();await new Promise(r=>server.close(r));}
}
if(process.argv.includes('--compile'))await compileCapture();else await runCapture();
