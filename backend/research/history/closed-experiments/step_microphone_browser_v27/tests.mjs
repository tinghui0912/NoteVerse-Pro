import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT,DIR,V26,V26SRC,bytes,load,sha,scope,save,git,START,exists } from './io.mjs';
import { classifyInputs,consistent,completeManifest,accepted } from './manifest.mjs';
import { classifyFailure,INTEGRITY,PRODUCT,NO_EVIDENCE } from './classification.mjs';
const require=createRequire(import.meta.url),ts=require(path.join(ROOT,'apps/customer-web/node_modules/typescript'));
const tests=[],add=(name,run)=>tests.push({name,run});
add('filesystem inputs hash exact file bytes and preserve original metafile name',async()=>{
  const reads=[],a=await classifyInputs([{path:'bundle',inputs:['fixture.mjs']}],'semantic',async p=>{reads.push(p);return Buffer.from('file');});
  assert.deepStrictEqual(reads,['fixture.mjs']);assert.equal(a.filesystemInputs[0].sha256,sha(Buffer.from('file')));
  assert.equal(a.filesystemInputs[0].metafileInputName,'fixture.mjs');assert.equal(a.occurrences[0].kind,'FILESYSTEM_INPUT');
});
add('exact virtual input has provenance and never attempts filesystem read',async()=>{
  const a=await classifyInputs([{path:'entry',inputs:['<define:process.env>']},{path:'worker',inputs:['<define:process.env>']}],'sem',async()=>{throw Error('FORBIDDEN_VIRTUAL_READ');});
  assert.deepStrictEqual(a.virtualInputs[0].bundles,['entry','worker']);assert.equal(a.virtualInputs[0].kind,'ESBUILD_VIRTUAL_INPUT');
  assert.equal(a.virtualInputs[0].buildSemanticRecordSha256,'sem');assert.equal(a.virtualInputs[0].sha256,undefined);assert.equal(a.filesystemInputs.length,0);
});
add('unknown virtual-looking nodes fail closed rather than being skipped',async()=>{
  for(const input of ['<define:other>','<stdin>','<other','other>'])await assert.rejects(classifyInputs([{path:'b',inputs:[input]}],'sem'),/STEP_V27_UNEXPECTED_ESBUILD_VIRTUAL_INPUT/);
});
add('missing real input fails closed',async()=>{await assert.rejects(classifyInputs([{path:'b',inputs:[DIR+'/ABSENT_REAL_INPUT.ts']}],'sem'),{code:'ENOENT'});});
add('duplicate real or virtual identities cannot disagree silently',async()=>{
  let calls=0;await assert.rejects(classifyInputs([{path:'a',inputs:['same']},{path:'b',inputs:['same']}],'sem',async()=>Buffer.from(String(calls++))),/DUPLICATE_INPUT_IDENTITY_DISAGREEMENT/);
  const m=new Map();consistent(m,'virtual',{kind:'ESBUILD_VIRTUAL_INPUT',provenance:'a'});
  assert.throws(()=>consistent(m,'virtual',{kind:'ESBUILD_VIRTUAL_INPUT',provenance:'b'}),/DUPLICATE_INPUT_IDENTITY_DISAGREEMENT/);
});
add('all immutable V26 bundles/WAV/metadata/contract and seven assets verify exactly',async()=>{
  const m=await completeManifest();assert.equal(m.artifacts.length,5);assert.equal(m.assets.length,7);
  for(const a of m.artifacts)assert.equal(a.sha256,accepted[a.path]);
  assert.deepStrictEqual(m.virtualInputs.map(v=>v.identifier),['<define:process.env>']);
  assert.equal(m.occurrences.length,m.build.bundles.reduce((n,b)=>n+b.inputs.length,0));
  assert.equal(m.filesystemInputs.length+m.virtualInputs.length,new Set(m.occurrences.map(o=>o.metafileInputName)).size);
  assert.equal(m.semantics.record.esbuild.version,'0.25.12');assert.equal(m.semantics.record.platform,'browser');
});
add('filesystem manifest covers all real inputs, including exact entrypoint source identities',async()=>{
  const m=await completeManifest();for(const o of m.occurrences)if(o.kind==='FILESYSTEM_INPUT'){
    const f=m.filesystemInputs.find(f=>f.metafileInputName===o.metafileInputName);assert.ok(f);assert.equal(sha(await bytes(f.path)),f.sha256);
  }
  for(const b of m.build.bundles)assert.ok(m.filesystemInputs.some(f=>f.path===b.entry));
  assert.equal(m.semantics.record.tsconfig.sha256,sha(await bytes('apps/customer-web/tsconfig.json')));
});
add('freeze executable graph reaches only Node builtins and V27 pure evidence modules, never browser/model/decoder execution',async()=>{
  const seen=new Set(),queue=[DIR+'/control.mjs',DIR+'/manifest.mjs'];
  while(queue.length){const p=queue.pop();if(seen.has(p))continue;seen.add(p);
    const source=(await bytes(p)).toString(),ast=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true);
    const visit=node=>{
      assert.ok(!ts.isImportCall?.(node));
      if(ts.isCallExpression(node))assert.ok(!/\.launch|createWorker|session\.run|decodeRobust|createRequire/.test(node.expression.getText(ast)),'EXECUTABLE_RESOURCE_REACHABILITY');
      ts.forEachChild(node,visit);
    };visit(ast);
    for(const n of ast.statements)if(ts.isImportDeclaration(n)){
      const spec=n.moduleSpecifier.text;if(spec.startsWith('node:'))continue;
      assert.ok(spec.startsWith('./'));const next=path.posix.normalize(path.posix.join(path.posix.dirname(p),spec));
      assert.ok([DIR+'/io.mjs',DIR+'/manifest.mjs'].includes(next));queue.push(next);
    }
  }
});
add('campaign has exactly one launch site after remote authorization and does not execute/import V26 campaign wrapper',async()=>{
  const source=(await bytes(DIR+'/campaign.mjs')).toString(),ast=ts.createSourceFile('campaign.mjs',source,ts.ScriptTarget.Latest,true),launches=[];
  const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='chromium.launch')launches.push(n.pos);ts.forEachChild(n,visit);};visit(ast);
  assert.equal(launches.length,1);assert.ok(launches[0]>source.indexOf('await authorizeCampaign()'));
  assert.ok(source.includes('runV26'));assert.ok(!source.includes("from '../step_microphone_browser_v26"));
  assert.ok(!source.includes('esbuild'));assert.ok(!source.includes('build('));
});
add('causal failure classification rejects resource-created proxy and keeps environment/root-stimulus/evidence cases distinct',()=>{
  assert.equal(classifyFailure({message:'GPU software',trace:{counts:{workerOwners:1}},environmentValid:false}).disposition,INTEGRITY);
  assert.equal(classifyFailure({message:'timeout',trace:{counts:{workerOwners:1}},environmentValid:true}).disposition,INTEGRITY);
  assert.equal(classifyFailure({message:'APPLICATION_ROOT_WATCHER_DID_NOT_OBSERVE_STOPPED_ROOT',environmentValid:true}).disposition,INTEGRITY);
  assert.equal(classifyFailure({message:'REAL_EVIDENCE_CONSUMPTION_NOT_EXERCISED',environmentValid:true}).disposition,NO_EVIDENCE);
  assert.equal(classifyFailure({message:'OLD_SOURCE_ATTEMPT_OPEN',environmentValid:true,trace:{initial:{input:{resourceState:'AVAILABLE'}},
    modelReceipt:{actualSessionLoadCount:1,executionProvider:'webgpu'},publications:[{}]}}).disposition,PRODUCT);
});
add('starting HEAD/scope, V26 history and current capability remain unchanged',async()=>{
  scope();assert.equal(git('rev-parse','HEAD'),START);assert.equal(git('rev-parse','origin/codex/customer-web-delivery-boundary'),START);
  const historical=await load(V26+'/historical-identities.json');for(const f of historical.files)assert.equal(sha(await bytes(f.path)),f.sha256);
  assert.equal((await load(V26+'/assessment.json')).disposition,'STEP_V26_BROWSER_EXECUTION_INTEGRITY_BLOCKED');
  assert.equal((await load(V26+'/pre-browser-freeze-failure.json')).failureClassification,'PREFREEZE_TOOLING_ESBUILD_VIRTUAL_INPUT_TREATED_AS_FILESYSTEM_PATH');
  assert.equal(await exists(V26+'/browser-campaign-started.json'),false);assert.equal(await exists(V26+'/browser-protocol-freeze.json'),false);
  const capability=(await bytes('apps/customer-web/src/lib/practice/input-capability.ts')).toString();
  assert.ok(capability.includes('ATTEMPT_ANALYZER_NOT_VALIDATED')&&capability.includes('MODEL_NOT_VALIDATED'));
  assert.equal(sha(await bytes(V26SRC+'/contract.json')),accepted[V26SRC+'/contract.json']);
});
const results=[];
try{
  for(const t of tests){await t.run();results.push({name:t.name,result:'LOCAL_PASS'});}
  await save('tooling-tests.json',{result:'LOCAL_PASS',passed:results.length,failed:0,tests:results,browserLaunches:0,
    newModelSessions:0,neuralRuns:0,virtualFilesystemReads:0,bundlesRebuilt:0});console.log(JSON.stringify({passed:results.length,result:'LOCAL_PASS'}));
}catch(error){await save('preflight-failure.json',{disposition:'STEP_V27_BROWSER_EXECUTION_INTEGRITY_BLOCKED',failedTest:tests[results.length]?.name,
  error:String(error.stack??error),results,rerunAllowed:false,browserLaunches:0,neuralRuns:0});throw error;}
