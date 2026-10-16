// One frozen synthetic engineering parity smoke; never a corpus/configuration sweep.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchXc1Browser, collectWebGpuAdapter } from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const work=path.join(root,'backend/data/work/xc5_runtime');
const app=path.join(root,'apps/customer-web');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(work,{recursive:true});
const esbuild=await import(pathToFileURL(path.join(root,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
for(const [entry,out] of [['scripts/xc5-smoke-entry.ts','entry.js'],
  ['src/lib/practice/acoustic-inference/xc4-robust-worker.entry.ts','worker.js']]){
  await esbuild.build({entryPoints:[path.join(app,entry)],outfile:path.join(work,out),bundle:true,
    format:'esm',platform:'browser',target:'es2022',logLevel:'silent',nodePaths:[path.join(app,'node_modules')]});
}
if(process.argv.includes('--build-only')) { console.log('XC5 browser bundles compile PASS; no inference'); process.exit(0); }
const freeze=JSON.parse(await readFile(path.join(root,'backend/research/reports/phase9g_xc5_runtime_source_freeze_2026-10-16.json')));
for(const row of freeze.sources){
  if(hash(await readFile(path.join(root,row.path)))!==row.sha256) throw new Error(`XC5_SOURCE_DRIFT:${row.path}`);
}
const output=path.join(work,'browser_smoke.json');
try{await readFile(output);throw new Error('XC5_SMOKE_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
const probe=path.join(work,'.writable-probe');await writeFile(probe,'');
const {unlink}=await import('node:fs/promises');await unlink(probe);
const model=path.join(root,'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx');
const modelBytes=await readFile(model);
if(modelBytes.length!==98689283||hash(modelBytes)!=='4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3')throw new Error('XC5_MODEL_DRIFT');
const files=new Map([['/entry.js',path.join(work,'entry.js')],['/worker.js',path.join(work,'worker.js')],
  ['/model.onnx',model],['/fir.f32',path.join(app,'public/engineering/xc4/fir-160-441.f32')]]);
const ortRoot=path.join(app,'node_modules/onnxruntime-web/dist');
const server=createServer((req,res)=>{
  const url=req.url?.split('?')[0];
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>XC5 disabled engineering smoke</title><script type="module" src="/entry.js"></script>');return;}
  const file=files.get(url)??(/^\/ort-wasm-[\w.-]+\.(mjs|wasm)$/.test(url)?path.join(ortRoot,url.slice(1)):null);
  if(!file){res.statusCode=403;res.end('AUDIO_ONLY');return;}
  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(file)?'text/javascript':'application/octet-stream');
  createReadStream(file).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  const launched=await launchXc1Browser({channel:'chrome',headed:true});browser=launched.browser;
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const adapter=await collectWebGpuAdapter(page);
  await page.waitForFunction(()=>typeof window.runXc5Smoke==='function');
  const result=await page.evaluate(()=>window.runXc5Smoke());
  result.browser=launched.identity;result.adapter=adapter;result.browserErrors=errors;
  result.phase='PHASE_9G_XC5_XC4_ALIGNED_DISABLED_BROWSER_ACOUSTIC_RUNTIME';
  result.runtimeFreezeCanonicalSha256=freeze.freezeCanonicalSha256;
  result.bundleIdentities=await Promise.all(['entry.js','worker.js'].map(async name=>({name,sha256:hash(await readFile(path.join(work,name)))})));
  const temp=output+'.tmp';await writeFile(temp,JSON.stringify(result,null,2)+'\n');await rename(temp,output);
  console.log(JSON.stringify({status:result.status,windowCount:result.windowCount,actualSessionRunCount:result.actualSessionRunCount,
    observationCount:result.observationCount,eventParity:result.eventParity,browser:result.browser}));
}catch(error){
  await writeFile(path.join(work,'browser_smoke_failure.json'),JSON.stringify({status:'XC5_BROWSER_ENGINEERING_SMOKE_FAILED',
    error:String(error.stack??error),phase:freeze.phase,freeze:freeze.freezeCanonicalSha256},null,2)+'\n',{flag:'wx'});
  throw error;
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
