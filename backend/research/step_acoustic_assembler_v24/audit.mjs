import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ROOT,DIR,OUT,START,BRANCH,bytes,load,save,hash,git,now,zero } from './io.mjs';

export const production=[
  'apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts',
  'apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.test.ts',
  'apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts',
  'apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.test.ts',
  'apps/customer-web/src/lib/practice/step/step-architecture.test.ts'
];
export const inputs={
  acoustic:'backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic.json',
  acousticSeal:'backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic-seal.json',
  v15:'backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json',
  v18:'backend/research/reports/step_runtime_verdict_v18/runtime-replay-results.json',
  scenarios:'backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json',
  preservation:'backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json',
  windows:'backend/research/reports/robust_raw_tensor_v20/tensor-corpus-manifest.json'
};
const accepted={
  [inputs.acoustic]:'61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1',
  [inputs.acousticSeal]:'5ffdb33b8f34791249f40e8c7b6c778b6d93a5f362b305b77120269ceb933f85',
  [inputs.v15]:'290c41185e488bfb6d08fd50b193d175ba5941ed37171ba2db73e969339e8b8a',
  [inputs.v18]:'66d07cabefd9592677f124af256149ad24057b569778de1b3c88653cadf9a0be',
  [inputs.scenarios]:'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55',
  [inputs.preservation]:'27d80f956f207366f3739d8277f559f98b7ba85f4f51df7a75b7dd57da2e2c51',
  [inputs.windows]:'4bb391905007ecbd594b4ed76d7fa79be0a3c095062da9111c4de63e72129c4b'
};
export async function scope(){
  assert.equal(git('branch','--show-current'),BRANCH);assert.equal(git('merge-base',START,'HEAD'),START);
  const paths=Array.from(new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean)));
  assert.ok(paths.every(p=>production.includes(p)||p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'OUT_OF_SCOPE_CHANGE');
  for(const [p,sha]of Object.entries(accepted))assert.equal(hash(await bytes(p)),sha,'INPUT_IDENTITY:'+p);
  return paths;
}
export async function bundles(){
  const builder=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href),result=[];
  for(const name of ['assembler','domain']){
    const p=OUT+'/bundles/'+name+'.mjs',built=await builder.build({absWorkingDir:ROOT,entryPoints:[DIR+'/'+name+'.ts'],outfile:path.join(ROOT,p),
      bundle:true,platform:'node',format:'esm',metafile:true,logLevel:'silent'});
    const graph=Object.keys(built.metafile.inputs);
    for(const file of graph){
      assert.ok(!/research\/step_waiting|decoder|model-inference|source-analysis-runtime|onnxruntime|finalizer|continuous/.test(file),'FORBIDDEN_EXECUTABLE:'+file);
      if(name==='assembler')assert.ok([DIR+'/assembler.ts',production[2],'apps/customer-web/src/lib/practice/local-core/timebase.ts'].includes(file),'ASSEMBLER_NOT_BLIND:'+file);
      else assert.ok(file===DIR+'/domain.ts'||file===production[2]||file.startsWith('apps/customer-web/src/lib/practice/local-core/'),'REPLAY_EXECUTABLE_SCOPE:'+file);
    }
    result.push({name,path:p,sha256:hash(await bytes(p)),graph});
  }
  return result;
}
export async function verify(){
  await scope();const freeze=await load(OUT+'/migration-protocol-freeze.json');
  for(const f of [...freeze.files,...(await load(OUT+'/historical-identities.json')).files])assert.equal(hash(await bytes(f.path)),f.sha256,'FROZEN_MUTATION:'+f.path);
  return freeze;
}
export async function remote(){
  const h=git('rev-parse','HEAD');assert.equal(git('rev-parse','origin/'+BRANCH),h);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],h);assert.equal(git('status','--porcelain'),'');return h;
}
export async function prepare(){
  await scope();const b=await bundles();
  const product=await load(OUT+'/product-vitest-final.json'),local=await load(OUT+'/local-verification.json'),preflight=await load(OUT+'/preflight-tests.json');
  assert.equal(product.numFailedTests,0);assert.equal(product.numPendingTests,0);assert.equal(product.success,true);
  assert.equal(local.status,'LOCAL_PASS');assert.equal(preflight.result,'LOCAL_PASS');
  const history=[];for(const p of git('ls-tree','-r','--name-only',START,'--','backend/research').split('\n').filter(Boolean))history.push({path:p,sha256:hash(await bytes(p))});
  await save(OUT+'/historical-identities.json',{startingHead:START,files:history});
  const paths=[...(await readdir(path.join(ROOT,DIR))).map(p=>DIR+'/'+p),...production,...Object.values(inputs),...b.flatMap(g=>[g.path,...g.graph]),
    'apps/customer-web/src/lib/practice/step/step-practice-controller.ts','apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts',
    'apps/customer-web/src/lib/practice/step/step-retirement-policy.ts','apps/customer-web/src/hooks/practice/use-step-local-practice.ts',
    'apps/customer-web/src/lib/practice/input-capability.ts','apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json',
    'apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts','apps/customer-web/src/lib/practice/acoustic/continuous/publication.ts',
    'apps/customer-web/src/lib/practice/local-core/continuous-finalizer.ts',
    ...['historical-identities.json','starting-gate.json','preflight-tests.json','local-verification.json','product-vitest.json','product-vitest-final.json'].map(p=>OUT+'/'+p)];
  const files=[];for(const p of Array.from(new Set(paths)).sort())files.push({path:p,sha256:hash(await bytes(p))});
  await save(OUT+'/migration-protocol-freeze.json',{role:'V24_PROSPECTIVE_PRODUCTION_H50_MIGRATION_REPLAY_FREEZE',createdAt:now(),startingHead:START,
    contract:await load(DIR+'/contract.json'),files,bundles:b,productionChangeAllowlist:production,evidenceArtifacts:Object.values(inputs),
    replayExecutionsAllowed:1,replay:'NOT_STARTED',zero});
  console.log(JSON.stringify({files:files.length,historicalFiles:history.length,freezeSha256:hash(await bytes(OUT+'/migration-protocol-freeze.json'))}));
}
export async function proof(){
  await verify();const h=await remote();await save(OUT+'/remote-migration-freeze-proof.json',{freezeCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    freezeSha256:hash(await bytes(OUT+'/migration-protocol-freeze.json')),replay:'NOT_STARTED',zero});console.log(h);
}
