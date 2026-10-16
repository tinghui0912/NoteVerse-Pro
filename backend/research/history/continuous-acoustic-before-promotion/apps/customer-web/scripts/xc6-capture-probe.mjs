import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile,mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT,APP,WORK,newJson,requireRemoteFreeze,hash,load,freezePath,fileId,canonical } from './xc6-evidence.mjs';
import { resolveBrandedBrowserExecutable,RUNTIME_NODE_MODULES } from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
import { attachDiagnostics } from './xc6-browser-diagnostics.mjs';

export async function launchCaptureBrowser(fake){
  const require=createRequire(import.meta.url),{chromium}=require(path.join(RUNTIME_NODE_MODULES,'playwright'));
  const executablePath=resolveBrandedBrowserExecutable('chrome');if(!executablePath)throw new Error('BRANDED_CHROME_UNAVAILABLE');
  const args=fake?['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(WORK,'fake-device.wav')}`]:[];
  const browser=await chromium.launch({executablePath,headless:false,args});
  return{browser,identity:{executablePath,version:await browser.version(),headed:true,args,node:process.version,
    playwright:require(path.join(RUNTIME_NODE_MODULES,'playwright/package.json')).version}};
}
export async function buildProbe(){
  const work=path.join(WORK,'probe');await mkdir(work,{recursive:true});
  const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  await esbuild.build({entryPoints:[path.join(APP,'scripts/xc6-metadata-entry.ts')],outfile:path.join(work,'entry.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
  return work;
}
export async function runProbe(fake){
  const proof=await requireRemoteFreeze('capture_probe'),work=await buildProbe();
  const plan=await load(freezePath('capture_probe'));
  for(const row of plan.assets)if(canonical(await fileId(path.join(ROOT,row.path)))!==canonical(row))throw new Error('XC6_PROBE_ASSET_DRIFT');
  const executionStartedAt=new Date().toISOString();
  const server=createServer((req,res)=>{
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>XC6 disabled metadata probe</title><script type="module" src="/entry.js"></script>');return;}
    if(req.url==='/favicon.ico'){res.statusCode=204;res.end();return;}
    const file=req.url==='/entry.js'?path.join(work,'entry.js'):req.url==='/capture.worklet.js'?path.join(APP,'src/lib/practice/acoustic-inference/xc6-capture.worklet.js'):null;
    if(!file){res.statusCode=403;res.end();return;}res.setHeader('Content-Type','text/javascript');createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    const launched=await launchCaptureBrowser(fake);browser=launched.browser;
    const page=await browser.newPage(),diagnostics=await attachDiagnostics(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.probeCaptureMetadata==='function');
    const result=await page.evaluate(()=>window.probeCaptureMetadata());
    await newJson(path.join(WORK,`metadata_${fake?'fake':'real'}.json`),{proof,executionStartedAt,browser:launched.identity,
      kind:fake?'BROWSER_FAITHFUL_FAKE_MEDIA_METADATA':'REAL_DEVICE_NORMAL_PERMISSION_METADATA',result,
      diagnostics:await diagnostics.finish(),fixture:fake?{sha256:hash(await readFile(path.join(WORK,'fake-device.wav')))}:undefined,
      neuralInferenceCount:0,pcmPersisted:false});console.log(JSON.stringify(result));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
if(process.argv.includes('--build-only'))await buildProbe();
else if(process.argv.includes('--real'))await runProbe(false);
else if(process.argv.includes('--fake'))await runProbe(true);
