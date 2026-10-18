import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const esbuild=require(path.join(root,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js'));
const dir='backend/research/step_waiting_h50_holdout_v9',out='backend/data/work/step_waiting_h50_holdout_v9';
await mkdir(path.join(root,out),{recursive:true});
const graphs=[];
for(const entry of ['prepare','tests','evaluate']){
  const result=await esbuild.build({absWorkingDir:root,entryPoints:[`${dir}/${entry}.ts`],outfile:`${out}/${entry}.mjs`,bundle:true,
    platform:'node',format:'esm',metafile:true,logLevel:'silent',nodePaths:[path.join(root,'apps/customer-web/node_modules')]});
  const inputs=Object.keys(result.metafile.inputs);
  if(inputs.some(p=>/onnxruntime|model-inference|model-worker|acoustic-worker|source-analysis-runtime|playwright|soundfile|decoder\.ts/i.test(p)))throw Error('FORBIDDEN_NEURAL_AUDIO_EXECUTION_IMPORT');
  graphs.push({entry,inputs});
}
await writeFile(path.join(root,out,'bundle-graphs.json'),JSON.stringify(graphs,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({bundles:graphs.length,forbiddenNeuralInputs:0}));
