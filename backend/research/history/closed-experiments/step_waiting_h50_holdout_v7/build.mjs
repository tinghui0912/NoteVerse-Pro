import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,DIR,WORK,hash,newJson,esbuild,rejectImports} from './core.mjs';
const builder=await esbuild();await mkdir(path.join(WORK,'stage-a'),{recursive:true});
const graphs=[];
for(const [entry,out,platform] of [[DIR+'/entry.ts','stage-a/entry.js','browser'],
 ['apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts','stage-a/worker.js','browser'],
 [DIR+'/dry-runtime.ts','dry-runtime.mjs','node']]){
 const file=path.join(WORK,out);
 const result=await builder.build({entryPoints:[path.join(ROOT,entry)],outfile:file,bundle:true,metafile:true,format:'esm',platform,target:'es2022',
  define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
  plugins:[{name:'pinned-ort',setup(b){b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}],
  nodePaths:[path.join(ROOT,'apps/customer-web/node_modules')]});
 const inputs=Object.keys(result.metafile.inputs);rejectImports(inputs);
 graphs.push({entry,output:out,inputs,truthBearingBundleInputs:[],sha256:hash(await readFile(file))});
}
await newJson(path.join(WORK,'stage-a/bundle-inputs.json'),{esbuildVersion:builder.version,graphs,truthBearingBundleInputs:[]});
console.log({bundles:graphs.length,truthBearingBundleInputs:[]});
