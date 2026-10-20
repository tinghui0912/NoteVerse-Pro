import assert from 'node:assert/strict';
import { readdir,readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { ROOT,DIR,OUT,START,BRANCH,V26SRC,bytes,load,sha,save,git,now,scope,remote,exists } from './io.mjs';
import { completeManifest } from './manifest.mjs';

export async function verify(){
  scope();const freeze=await load(OUT+'/browser-protocol-freeze.json');
  for(const f of [...freeze.files,...(await load(OUT+'/historical-identities.json')).files])assert.equal(sha(await bytes(f.path)),f.sha256,'FROZEN_MUTATION:'+f.path);
  return freeze;
}
export async function chromeIdentity(environment){
  const executable=environment.chromeExecutable,b=await readFile(executable);
  assert.equal(sha(b),environment.chromeExecutableSha256,'CHROME_EXECUTABLE_IDENTITY_MISMATCH');
  const version=execFileSync('powershell',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable}').VersionInfo.ProductVersion`],{encoding:'utf8'}).trim();
  assert.equal(version,'155.0.8059.80','CHROME_STATIC_VERSION_MISMATCH');
  return {executable,sha256:sha(b),staticFileVersion:version,discovery:'FileVersionInfo and SHA only; Chrome NOT launched'};
}
async function freeze(){
  scope();assert.equal(git('rev-parse','HEAD'),START);assert.equal(git('rev-parse','origin/'+BRANCH),START);
  assert.ok(!await exists(OUT+'/preflight-failure.json'),'NO_FREEZE_AFTER_FAILED_TEST');
  const tests=await load(OUT+'/tooling-tests.json'),local=await load(OUT+'/local-verification.json'),product=await load(OUT+'/product-regressions.json');
  assert.equal(tests.result,'LOCAL_PASS');assert.equal(local.result,'LOCAL_PASS');assert.equal(product.success,true);
  assert.equal(product.numFailedTests,0);assert.equal(product.numPendingTests,0);
  const manifest=await completeManifest(),chrome=await chromeIdentity(manifest.build.environment);
  const history=[];for(const p of git('ls-tree','-r','--name-only',START,'--','backend/research').split('\n').filter(Boolean))history.push({path:p,sha256:sha(await bytes(p))});
  await save('historical-identities.json',{startingHead:START,files:history});
  const v26sources=git('ls-tree','-r','--name-only',START,'--',V26SRC).split('\n').filter(Boolean);
  const own=(await readdir(path.join(ROOT,DIR))).map(p=>DIR+'/'+p);
  const paths=[...new Set([...own,...manifest.artifacts.map(a=>a.path),...manifest.assets.map(a=>a.path),
    ...manifest.filesystemInputs.map(a=>a.path),...manifest.semantics.record.esbuild.packageIdentities.map(p=>p.path),
    manifest.semantics.record.tsconfig.path,...v26sources,...git('ls-tree','-r','--name-only',START,'--',
      'apps/customer-web/src/lib/practice','apps/customer-web/src/hooks/practice').split('\n').filter(Boolean),
    ...['starting-gate.json','tooling-tests.json','local-verification.json','product-regressions.json','historical-identities.json'].map(p=>OUT+'/'+p)])].sort();
  const files=[];for(const p of paths)files.push({path:p,sha256:sha(await bytes(p))});
  const oldContract=await load(V26SRC+'/contract.json');
  await save('browser-protocol-freeze.json',{phase:'STEP_MICROPHONE_BROWSER_RESOURCE_GRAPH_V27',createdAt:now(),startingHead:START,
    contract:await load(DIR+'/contract.json'),campaignContract:oldContract,cells:oldContract.cells,
    immutableCandidate:manifest,virtualInputRecordMeaning:'ESBUILD_VIRTUAL_INPUT has semantic provenance, never a filesystem SHA',
    exactV26BuildAndExecutionSources:files.filter(p=>v26sources.includes(p.path)),files,chrome,
    playwright:{path:'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright',version:'1.48.2'},
    os:{platform:os.platform(),release:os.release(),version:os.version(),arch:os.arch()},historyFiles:history.length,
    bundleRebuilds:0,productionDiff:[],historicalDiff:[],browserLaunches:0,modelSessionLoads:0,neuralRuns:0,decoderRuns:0,
    executionAuthorization:'NEW_V27_REMOTE_PROOF_REQUIRED',V26NotResumed:true,
    V26DraftTitle:'017a7620 title is NOT a successful V26 freeze; history not rewritten',capabilities:oldContract.capabilities});
  console.log(JSON.stringify({freezeSha256:sha(await bytes(OUT+'/browser-protocol-freeze.json')),historyFiles:history.length,
    filesystemInputs:manifest.filesystemInputs.length,virtualInputs:manifest.virtualInputs,files:files.length}));
}
async function proof(){
  await verify();const h=remote();await save('remote-browser-freeze-proof.json',{freezeCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    freezeSha256:sha(await bytes(OUT+'/browser-protocol-freeze.json')),browserLaunches:0,
    authorization:'V27_FIRST_AUTHORIZED_EXECUTION_OF_IMMUTABLE_V26_PREPARED_BROWSER_ARTIFACTS'});console.log(h);
}
const github=h=>JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",h],{cwd:ROOT,encoding:'utf8'}));
async function receipt(){
  const f=await verify(),h=remote(),files=scope(),identities=[];
  for(const p of files){const b=await bytes(p);assert.equal(sha(execFileSync('git',['show',h+':'+p],{cwd:ROOT,maxBuffer:64*1024*1024})),sha(b));identities.push({path:p,sha256:sha(b)});}
  const checks=github(h);await save('remote-result-proof.json',{resultCommit:h,remoteHead:h,startingRemoteHead:START,remoteVerifiedAt:now(),
    completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),exactChangedFiles:files,identities,
    historicalRawFilesVerified:f.historyFiles,V3ThroughV26Diff:[],productionDiff:[],github:checks,cleanWorktree:true,
    disposition:(await load(OUT+'/assessment.json')).disposition,receiptCommitNote:'Final additive receipt HEAD independently verified after commit; no self-reference'});
  console.log(JSON.stringify({head:h,github:checks}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];if(mode==='freeze')await freeze();else if(mode==='proof')await proof();else if(mode==='receipt')await receipt();
  else if(mode==='verify'){await verify();console.log('V3_V26_AND_PRODUCTION_RAW_BYTES_EXACT_NO_BUNDLE_REBUILD');}
  else throw Error('freeze/proof/receipt/verify only; browser campaign is a separate authorized entrypoint');
}
