import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, DIR, OUT, V21, V20, START, BRANCH, bytes, json, hash, save, git, committedBytes, now, execution } from './io.mjs';
import { identityJSON } from './numeric.mjs';

export function roster(definitions) {
  const profiles = [];
  for (let oi=0; oi<definitions.onsetGrid.length; oi++) for (let fi=0; fi<definitions.frameGrid.length; fi++) {
    const o=definitions.onsetGrid[oi], f=definitions.frameGrid[fi];
    const od=String(Math.round(o*100)).padStart(3,'0'), fd=String(Math.round(f*100)).padStart(3,'0');
    profiles.push({ profileId:`ROBUST_A_O${od}_F${fd}`,onsetThreshold:o,frameThreshold:f,
      modelSha256:definitions.productionDefaults.modelSha256,decoder:'PRODUCTION_DECODER_A',geometry:{ownedMs:600,pastMs:1050,futureMs:170},
      gridStepDistance:Math.abs(oi-3)+fi,readoutIdentity:`robust-a-o${od}-f${fd}-v21-exposed-development`,
      status:o===0.30&&f===0.05 ? 'CURRENT_CONTROL_NOT_NEW_CANDIDATE' : 'EXPOSED_DEVELOPMENT_ONLY' });
  }
  return profiles;
}

export async function scope() {
  assert.equal(git('branch','--show-current'),BRANCH);
  assert.equal(git('merge-base',START,'HEAD'),START);
  const changed=Array.from(new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean)));
  assert.ok(changed.every(p=>p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'OUT_OF_SCOPE_CHANGE');
  return changed;
}

/** Identity gate deliberately does not parse any Stage-A/B profile payload or study result. */
export async function inventory() {
  await scope();
  const checked=new Map();
  async function exact(p,sha) {
    const b=await bytes(p), digest=hash(b);
    assert.equal(digest,hash(committedBytes(p)),'STARTING_REMOTE_COMMITTED_BYTES:'+p);
    if (sha) assert.equal(digest,sha,'ACCEPTED_IDENTITY:'+p);
    checked.set(p,{path:p,sha256:digest}); return b;
  }
  await exact(V21+'/protocol-freeze.json','6e500619c2de0c682087463514043573bdcecfb319b9861b46176630c6bef56d');
  await exact(V21+'/study-results.json','e3d703d9d941f0e37f0c20a9a4587e22b3eb6dea3bacedb83de1ee32e79eb3a4');
  const aProof=JSON.parse(await exact(V21+'/remote-stage-a-proof.json'));
  const resultProof=JSON.parse(await exact(V21+'/remote-result-proof.json'));
  assert.equal(aProof.outputCorpusSha256,'2443a185276b0ffb45184b7054a3c765701c5b924bd2efb8fcbe6b502ed01a4a');
  assert.equal(hash(identityJSON(aProof.artifacts)),aProof.outputCorpusSha256);
  assert.equal(aProof.artifacts.length,20);
  for(const f of aProof.artifacts) await exact(f.path,f.sha256);
  const stageB=resultProof.resultFileIdentities.filter(f=>f.path.startsWith(V21+'/stage-b/')&&f.path.endsWith('.json'));
  assert.equal(stageB.length,20);
  for(const f of stageB) await exact(f.path,f.sha256);
  assert.equal(resultProof.disposition,'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED');
  const failure=JSON.parse(await exact(V21+'/post-b-test-failure.json'));
  assert.equal(failure.failureClassification,'POST_ANALYSIS_SERIALIZED_RANKING_SIGNED_ZERO_ASSERTION_DEFECT');
  assert.equal(failure.profileAtFailure,'ROBUST_A_O030_F005');
  assert.deepEqual(failure.actualInMemoryComponents,['+0','6','-2','-8','-0']);
  assert.deepEqual(failure.expectedDeserializedComponents,['+0','6','-2','-8','+0']);
  assert.equal(failure.sourceOrPolicyRepairedAfterFailure,false); assert.equal(failure.analysisRerun,false);
  const raw=JSON.parse(await exact(V20+'/tensor-corpus-manifest.json','4bb391905007ecbd594b4ed76d7fa79be0a3c095062da9111c4de63e72129c4b'));
  const rawSeal=JSON.parse(await exact(V20+'/raw-tensor-seal.json','7513253623c799357de01d7a7a183a95ec2738e0fa374b88fe299a09d1899eaf'));
  const rawIdentity=hash(identityJSON(raw.windows.map(w=>({jobId:w.jobId,runOrdinal:w.runOrdinal,runtimeWindow:w.runtimeWindow,
    inputSha256:w.inputSha256,onsetSha256:w.onsetSha256,frameSha256:w.frameSha256,pairSha256:w.pairSha256}))));
  assert.equal(rawIdentity,'73c4aad015e8cc10a78bc54bac9f5d89af2c14a0b50a6ecf190761081dd476a0');
  assert.equal(rawSeal.corpusCanonicalSha256,rawIdentity); assert.equal(raw.corpusCanonicalSha256,rawIdentity);
  for(const p of ['protocol.md','metrics.mjs','profiles.mjs','stage-a.mjs','stage-b.mjs','tests.mjs']) await exact('backend/research/robust_threshold_v21/'+p);
  await exact(V21+'/stage-a-seal.json'); await exact(V21+'/assessment.json');
  const d=await json(DIR+'/definitions.json'), profiles=roster(d);
  const protocol=JSON.parse(await bytes(V21+'/protocol-freeze.json'));
  assert.deepEqual(profiles,protocol.profiles);
  assert.deepEqual(stageB.map(f=>path.posix.basename(f.path,'.json')).sort(),profiles.map(p=>p.profileId).sort());
  return { verifiedAt:now(), startingHead:START, files:Array.from(checked.values()),
    stageAArtifacts:aProof.artifacts,stageBArtifacts:stageB,profiles,control:d.control,
    protocolFreezeSha256:hash(await bytes(V21+'/protocol-freeze.json')),
    rawGeneratedStudyResultsSha256:hash(await bytes(V21+'/study-results.json')),
    stageAOutputCorpusSha256:aProof.outputCorpusSha256,V20CanonicalCorpusSha256:rawIdentity,
    historicalV21Disposition:'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED',
    failureClassification:failure.failureClassification,profilePayloadsParsed:false,studyResultsParsed:false,
    readMode:'RAW_HASH_ONLY_FOR_STAGE_A_STAGE_B_AND_GENERATED_STUDY_RESULTS_BEFORE_FREEZE',execution };
}

export async function verify() {
  await scope(); const freeze=await json(OUT+'/protocol-freeze.json');
  for(const f of freeze.files) assert.equal(hash(await bytes(f.path)),f.sha256,'V22_FROZEN_MUTATION:'+f.path);
  for(const f of (await json(OUT+'/historical-identities.json')).files) assert.equal(hash(await bytes(f.path)),f.sha256,'HISTORY_MUTATION:'+f.path);
  return freeze;
}

export async function remote() {
  const h=git('rev-parse','HEAD');
  assert.equal(git('rev-parse','origin/'+BRANCH),h);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],h);
  assert.equal(git('status','--porcelain'),'','REMOTE_PROOF_REQUIRES_CLEAN_WORKTREE');
  return h;
}

export async function prepare() {
  const evidence=await inventory(); await save(OUT+'/evidence-identities.json',evidence);
  const historical=[];
  for(const p of git('ls-tree','-r','--name-only',START,'--','backend/research').split('\n').filter(Boolean)) historical.push({path:p,sha256:hash(await bytes(p))});
  await save(OUT+'/historical-identities.json',{startingHead:START,files:historical});
  const paths=[...(await readdir(path.join(ROOT,DIR))).map(p=>DIR+'/'+p),OUT+'/evidence-identities.json',
    OUT+'/historical-identities.json',OUT+'/starting-gate.json',OUT+'/preflight-tests.json',OUT+'/local-verification.json'];
  const files=[];
  for(const p of paths) files.push({path:p,sha256:hash(await bytes(p))});
  await save(OUT+'/protocol-freeze.json',{role:'V22_PROSPECTIVE_EVIDENCE_ONLY_SIGNED_ZERO_REEVALUATION_FREEZE',createdAt:now(),
    startingHead:START,definitions:await json(DIR+'/definitions.json'),files,immutableEvidence:evidence.files,
    profiles:evidence.profiles,execution,realEvaluationsAllowed:1,V21_NOT_RESUMED:true,
    V22_IS_NEW_ADDITIVE_EVIDENCE_REEVALUATION:true,StageA:'NOT_EXECUTED',StageB:'NOT_EXECUTED',
    reevaluation:'NOT_STARTED',forbiddenExecutableImports:['V21 modules','decoder','model runtime','StepPracticeRuntime','WaitingTopologyGate'],
    stop:'IDENTITY_OR_SEMANTIC_MISMATCH_PRESERVE_EVIDENCE_AND_STOP_NO_REPAIR'});
  console.log(JSON.stringify({files:files.length,history:historical.length,stageAHashes:evidence.stageAArtifacts.length,
    stageBHashes:evidence.stageBArtifacts.length,freezeSha256:hash(await bytes(OUT+'/protocol-freeze.json'))}));
}

export async function proof() {
  const freeze=await verify(), h=await remote();
  for(const f of freeze.immutableEvidence) assert.equal(hash(await bytes(f.path)),f.sha256);
  await save(OUT+'/remote-freeze-proof.json',{freezeCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    freezeSha256:hash(await bytes(OUT+'/protocol-freeze.json')),reevaluation:'NOT_STARTED',execution});
  console.log(h);
}
