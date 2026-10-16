import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {atomicJson,fileSha,digest} from './xc1_artifacts.mjs';
import {PHASE,START,REPORTS,WORK,LABEL,AUDIT,load} from './xc8_causal_audit.mjs';
import {XC8_POLICY} from './xc8_direct_claimant_commit_finalizer.mjs';
export {PHASE,START,REPORTS,WORK,LABEL,AUDIT,load,atomicJson,fileSha,digest};
export const git=(...args)=>execFileSync('git',['-c','http.sslBackend=openssl',...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
export const FREEZE=`${REPORTS}/phase9g_xc8_source_protocol_freeze_v1_2026-10-16.json`;
export const CONFIGURATIONS=['LINEAR_A_600_220','BAND_LIMITED_A_600_170'];
export async function sourceRows(){
  const names=(await readdir('backend/research/browser_runtime')).filter(n=>n.startsWith('xc8_')||n==='test_xc8_finalizer.mjs').map(n=>'backend/research/browser_runtime/'+n);
  const old=['xc2_r1_bounded_finalizer.mjs','xc2_r2_direct_conflict_finalizer.mjs','xc2_product_metrics.mjs','xc2_decoders.mjs',
    'xc1_robust_decoder.mjs','xc1_artifacts.mjs','robust_runtime_evidence_analysis.mjs','xc1_browser_semantics.mjs','xc1_browser_runtime_shared.mjs'];
  names.push(...old.map(n=>'backend/research/browser_runtime/'+n),
    'backend/research/protocols/xc8_direct_claimant_commit_bound.md',
    'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts',
    'apps/customer-web/src/lib/practice/research/xc2-five-verdict-projector.ts',
    'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts',
    'apps/customer-web/src/lib/practice/input-capability.ts');
  return Promise.all(names.sort().map(async path=>({path,sha256:await fileSha(path)})));
}
export async function inputRows(){
  const audit=await load(AUDIT),r2=await load(`${REPORTS}/phase9g_xc2_r2_direct_conflict_final_2026-10-16.json`);
  const paths=[...audit.inputs.map(r=>r.path),AUDIT,`${REPORTS}/phase9g_xc2_product_verdict_latency_final_2026-10-16.json`];
  for(const m of r2.artifactManifest){
    const v=await load(m.path);paths.push(v.originalMetricsPath,v.r1MetricsPath,v.r1WitnessPath);
  }
  paths.push(`${REPORTS}/phase9g_xc2_r1_natural_residual_and_paired_latency_2026-10-16.json`);
  paths.push(`${REPORTS}/phase9g_xc2_r2_policy_freeze_2026-10-16.json`,`${REPORTS}/phase9g_xc2_causal_execution_receipts_2026-10-16.json`);
  return Promise.all([...new Set(paths)].sort().map(async path=>({path,sha256:await fileSha(path)})));
}
export async function requireFrozen(requireRemote=false){
  const f=await load(FREEZE),{freezeSha256,...body}=f;
  if(digest(body)!==freezeSha256)throw new Error('XC8_FREEZE_DIGEST');
  for(const row of [...f.sources,...f.inputs])if(await fileSha(row.path)!==row.sha256)throw new Error('XC8_FROZEN_DRIFT:'+row.path);
  if(git('diff','--name-only',START,'--','apps/customer-web'))throw new Error('XC8_PROTECTED_PRODUCT_SOURCE_CHANGED');
  const freezeCommit=git('log','-1','--format=%H','--',FREEZE);
  if(requireRemote){
    const remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s+/)[0];
    if(remote!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit||git('status','--porcelain'))throw new Error('XC8_REQUIRE_EXACT_CLEAN_REMOTE_FREEZE');
    return{freeze:f,proof:{freezeCommit,remoteHead:remote,freezeSha256,remoteVerifiedAt:new Date().toISOString(),allSourceAndInputHashesVerified:true}};
  }
  return {freeze:f,freezeCommit};
}
export async function freeze(){
  if(git('status','--porcelain'))throw new Error('XC8_COMMIT_IMPLEMENTATION_FIRST');
  if((await readdir(WORK).catch(()=>[])).some(n=>n.endsWith('_metrics.json')||n==='replay_summary.json'))throw new Error('XC8_REPLAY_ALREADY_EXISTS');
  const testArgs=['--test','backend/research/browser_runtime/test_xc8_finalizer.mjs'];
  const tests=spawnSync(process.execPath,testArgs,{encoding:'utf8',maxBuffer:4e6});
  if(tests.status!==0)throw new Error(tests.stdout+tests.stderr);
  const audit=await load(AUDIT);
  if(!audit.cells.some(c=>c.reservationResolutionInventory.length))throw new Error('XC8_ALLOWED_HYPOTHESIS_NOT_SUPPORTED');
  const r2Freeze=await load(`${REPORTS}/phase9g_xc2_r2_policy_freeze_2026-10-16.json`);
  for(const row of r2Freeze.inputs)if(await fileSha(row.path)!==row.sha256)throw new Error('XC8_PRIOR_FROZEN_INPUT_CHANGED:'+row.path);
  const priorReceipts=await load(`${REPORTS}/phase9g_xc2_causal_execution_receipts_2026-10-16.json`);
  const sealed=new Map(priorReceipts.receipts.map(r=>[r.path.replaceAll('\\','/'),r.fileSha256]));
  for(const row of audit.inputs.filter(r=>r.path.includes('/raw/')))if(row.sha256!==sealed.get(row.path))throw new Error('XC8_ORIGINAL_ACOUSTIC_SEAL_CHANGED:'+row.path);
  const f={phase:PHASE,startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
    classification:LABEL,policy:XC8_POLICY,sources:await sourceRows(),inputs:await inputRows(),configurations:CONFIGURATIONS,
    splits:['DEVELOPMENT','EVALUATION'],cells:CONFIGURATIONS.flatMap(configuration=>['DEVELOPMENT','EVALUATION'].map(split=>({configuration,split}))),
    mathematicalProofPath:'backend/research/protocols/xc8_direct_claimant_commit_bound.md',
    horizon:{strike:'H(t)=max(u+w: literal same-pitch |u-t|<=2w)<=t+3w',
      group:'G(g)=max(b+w,own strike H,literal local-observation correct-claimant H)<=max(b+3w,a+5w)<=a+1250ms at delta<=20',
      extra:'E(o)<=o+max(delta+4w,6w)<=o+1500ms at delta<=20',
      noRecursion:'Never wait for commit/group of a cohort member of a direct claimant. Its own fixed H uses cohort LOCAL windows only.',
      terminal:'Explicit clamp, unclamped witness preserved; manual NOT_REACHED retained; no invented future acoustic coverage.'},
    preFreezeTests:{command:[process.execPath,...testArgs],exitCode:tests.status,stdout:tests.stdout,stderr:tests.stderr},
    semanticRuntime:{node:process.version,os:process.platform,arch:process.arch,locale:Intl.DateTimeFormat().resolvedOptions().locale},
    replayPlan:'Read existing A publications only; no model, decoding, browser, audio, MIDI file or new dataset access. Existing benchmark JSON and fixed oracle/scoring semantics only.',
    acceptance:{requires:['Strict finite nontransitive bound','Confirmed reservation-release mechanism closes before finality',
      'No double semantic owner','No new critical false accept per cell versus R2','No R2-correct EVALUATION target newly wrong',
      'All terminal reservations and ownership audits clean'],
      ready:'XC8_BOUNDED_FINALIZER_CANDIDATE_READY_FOR_PRODUCT_INTEGRATION_QUALIFICATION',otherwise:'XC8_NO_BOUNDED_FINALIZER_POLICY_READY',
      noTuningAfterReplay:true,noNewPolicySearch:true,knownTargetCaveat:audit.hypothesisSupport},
    unchangedProductGitTree:git('rev-parse',`${START}:apps/customer-web`),newNeuralInferenceCount:0,newDatasetCount:0,
    originalAcousticSealVerified:true,verifiedGroupSpread:r2Freeze.verifiedGroupSpan,
    acousticCoreSha256:'93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',productionMicrophone:false};
  f.freezeSha256=digest(f);await atomicJson(FREEZE,f);
  console.log(JSON.stringify({implementation:f.implementationCommit,freezeSha256:f.freezeSha256,inputCount:f.inputs.length,sourceCount:f.sources.length}));
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){if(process.argv[2]==='freeze')await freeze();else throw new Error('XC8_PROTOCOL_COMMAND');}
