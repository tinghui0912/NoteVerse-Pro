// One-shot mechanical relocation. Semantic changes are separate reviewed patches.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const root=process.cwd(), start='21e9b67b71ab156fd0140290c3a7a857b1ee493d';
if(git('rev-parse','HEAD')!==start)throw new Error('START_CHANGED');
const old='apps/customer-web/src/lib/practice/acoustic-inference/continuous/';
const dest='apps/customer-web/src/lib/practice/acoustic/';
const maps=new Map();
for(const file of fs.readdirSync(old)){
  const group=['model-contract.ts','acoustic-core-identity.json','acoustic-model-manifest.ts','model-inference.ts','model-validation.ts','worker-client.ts','acoustic-worker.entry.ts','inference.test.ts'].includes(file)?'model/':
    ['source-adapter.ts','source-adapter-identities.json','capture.ts','capture.worklet.js','dsp-parity.test.ts'].includes(file)?'source/':
    ['acoustic-runtime.ts','publication.ts','capture-bridge.ts','runtime.test.ts','capture.test.ts'].includes(file)?'continuous/':'runtime/';
  maps.set(old+file,dest+group+file);
}
maps.set('apps/customer-web/src/lib/practice/continuous/continuous-infrastructure.ts',dest+'source/microphone-infrastructure.ts');
maps.set('apps/customer-web/src/lib/api/continuous-model-asset.ts','apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts');
for(const file of fs.readdirSync('apps/customer-web/public/model-assets/continuous'))maps.set('apps/customer-web/public/model-assets/continuous/'+file,'apps/customer-web/public/model-assets/practice-acoustic/'+file);
const archive='backend/research/history/shared-acoustic-before-clean-break/';
const removed=['apps/customer-web/src/lib/practice/acoustic-inference/bytedance-onnx-provider.ts',
  'apps/customer-web/src/lib/model-assets/bytedance-model-loader.ts','apps/customer-web/src/lib/api/model-assets.ts'];
const archivePaths=[...git('ls-files',old).split('\n').filter(Boolean),...removed,
  'backend/app/modules/model_assets/router.py','backend/app/modules/model_assets/service.py','backend/app/modules/model_assets/schemas.py'];
const manifest=[];
for(const p of archivePaths){const b=execFileSync('git',['show',`${start}:${p}`]),target=archive+p;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);manifest.push({originalPath:p,path:target,sourceCommit:start,gitBlob:git('rev-parse',`${start}:${p}`),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
fs.writeFileSync(archive+'manifest.json',JSON.stringify({sourceCommit:start,files:manifest},null,2)+'\n');
const tracked=git('ls-files','apps/customer-web').split('\n').filter(Boolean);
for(const original of tracked){
 if(removed.includes(original))continue;
 if(!/\.(ts|tsx|js|mjs|json|md)$/.test(original))continue;
 const target=maps.get(original)??original;
 let text=fs.readFileSync(original,'utf8');
 // Resolve import targets before moving their owning module.
 text=text.replace(/((?:from\s*|import\s*\(|new URL\()\s*['"])([^'"]+)(['"])/g,(all,a,s,b)=>{
  if(!s.startsWith('.'))return all;
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(original),s));
  const actual=[resolved,resolved+'.ts',resolved+'.js',resolved+'.json'].find(p=>maps.has(p)||fs.existsSync(p));
  if(!actual)return all;
  const moved=maps.get(actual)??actual;
  let relative=path.posix.relative(path.posix.dirname(target),moved);
  if(!path.posix.extname(s))relative=relative.replace(/\.ts$/,'');
  return a+(relative.startsWith('.')?relative:'./'+relative)+b;
 });
 for(const [from,to] of maps)text=text.replaceAll(from,to).replaceAll(from.replace('apps/customer-web/',''),to.replace('apps/customer-web/',''));
 for(const [a,b] of [['ContinuousModelInference','AcousticModelSession'],['ContinuousAcousticWorker','AcousticModelWorker'],['createContinuousAcousticWorker','createAcousticModelWorker'],['ContinuousSourceAdapter','QualifiedSourceAdapter'],['ContinuousAcousticCapture','BrowserAcousticCapture'],['continuousAcousticModelManifest','practiceAcousticModelManifest'],['getContinuousModelAccess','getPracticeAcousticModelAccess'],['assertContinuousModelAccess','assertPracticeAcousticModelAccess'],['ContinuousModelAccess','PracticeAcousticModelAccess'],['watchContinuousInfrastructure','watchMicrophoneInfrastructure'],['noteverse-continuous-pcm','noteverse-practice-pcm'],['continuous-robust-browser-v1/access','practice-acoustic-robust-browser-v1/access'],['continuous-robust-browser','practice-acoustic-robust-browser'],['/model-assets/continuous/','/model-assets/practice-acoustic/']])text=text.replaceAll(a,b);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);
}
for(const [from,to] of maps){if(!/\.(ts|tsx|js|mjs|json|md)$/.test(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}fs.unlinkSync(from);}
for(const p of removed)fs.unlinkSync(p);
console.log(JSON.stringify({moved:[...maps],removed,archiveManifest:archive+'manifest.json'}));
