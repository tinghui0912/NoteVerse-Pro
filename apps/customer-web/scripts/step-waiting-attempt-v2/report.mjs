import {readFile,mkdir,copyFile,constants} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,DATA,WORK,FREEZE,START,paths,git,hash,newJson,SUCCESS,BLOCKED} from './protocol.mjs';
const destination=path.join(ROOT,'backend/research/reports/step_waiting_attempt_v2');
await mkdir(destination,{recursive:true});
const read=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
if(process.argv[2]==='receipt'){
 const head=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 if(head!==remote)throw Error('EVIDENCE_NOT_PUSHED');
 const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
 const token=credential.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(!token)throw Error('GITHUB_CREDENTIAL_UNAVAILABLE');
 const query=async endpoint=>{const response=await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`,{
  headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!response.ok)throw Error('GITHUB_HTTP_'+response.status);return response.json();};
 const combined=await query(`commits/${head}/status`),actions=await query(`actions/runs?head_sha=${head}`);
 await newJson(path.join(destination,'github-receipt.json'),{queriedAt:new Date().toISOString(),remoteHead:remote,evidenceCommit:head,
  combinedState:combined.state,statuses:combined.statuses,workflow_runs:actions.workflow_runs,
  interpretation:combined.statuses.length===0&&actions.workflow_runs.length===0?'NOT CI PASS':'Inspect actual GitHub results; local evidence is not CI.'});
 console.log(JSON.stringify({head,combinedState:combined.state,statuses:combined.statuses,workflow_runs:actions.workflow_runs}));
}else{
 const freeze=await read(path.join(ROOT,FREEZE)),work=paths().work,holdout=path.join(work,'../holdout');
 const artifacts=[['verification',path.join(work,'verification.json')],['engineering',path.join(work,'browser.json')],
  ['musical',path.join(WORK,'musical.json')],['musical-parity',path.join(WORK,'parity.json')],
  ['acoustic',path.join(holdout,'acoustic.json')],['acoustic-seal',path.join(holdout,'acoustic-seal.json')],['scores',path.join(holdout,'scores.json')]];
 const evidence={};
 for(const [name,file] of artifacts){const value=await read(file);evidence[name]=value;
  if(value)await copyFile(file,path.join(destination,name+'.json'),constants.COPYFILE_EXCL);}
 for(const f of ['metadata-audit.json','truth.json','audio_only/jobs.json'])await copyFile(path.join(DATA,f),path.join(destination,path.basename(f)),constants.COPYFILE_EXCL);
 const pass=['verification','engineering','musical','musical-parity','scores'].every(k=>evidence[k]?.status==='PASS');
 const remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 const scores=evidence.scores,staticResult=evidence.verification;
 await newJson(path.join(destination,'final.json'),{phase:freeze.phase,startingHead:START,implementationCommit:freeze.implementationCommit,
  freezeCommit:git('log','-1','--format=%H','--',FREEZE),freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),
  remoteHead,reportedAt:new Date().toISOString(),commitChain:git('log','--reverse','--format=%H %s',`${START}..HEAD`).split('\n'),
  disposition:pass?SUCCESS:BLOCKED,
  classifications:{architectureInvariantFailure:scores?.classifications.architectureFailure??'NOT_MEASURED',
   acousticModelQualityFailure:scores?.classifications.acousticQualityFailure??'NOT_MEASURED',
   qualificationHarnessFailure:evidence.engineering?.status==='PARTIAL_EXECUTION_BLOCKED'||staticResult?.status!=='PASS'||scores?.classifications.qualificationCorpusWaitingFailure===true},
  stages:Object.fromEntries(artifacts.map(([k])=>[k,evidence[k]?.status??'NOT_STARTED'])),
  failures:evidence.engineering?.cells.filter(c=>c.state==='FAILED').map(c=>({rate:c.rate,scenario:c.scenario,failureWitness:c.failureWitness,chronologyFailures:c.chronologyFailures,error:c.error}))??[],
  fixedH:50,warmReady:freeze.contract.warmReady,rearm:freeze.contract.rearm,metadataAudit:freeze.metadataAudit,
  stageASeal:evidence['acoustic-seal'],architectureCounters:scores?.architecture??null,empiricalFalseMatchCounters:scores?.empirical??null,
  usability:scores?.usability??'NOT_MEASURED',latency:scores?.latency??'NOT_MEASURED',
  actualNeuralRuns:{engineering:evidence.engineering?.actualModelRuns??0,musical:evidence.musical?.actualModelRuns??0,holdout:evidence.acoustic?.result?.actualModelRuns??0},
  staticVerification:staticResult,protectedProductionDiff:git('diff',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app'),
  capabilities:freeze.capabilities,previousDisposition:'STEP_ACOUSTIC_ATTEMPT_ASSEMBLY_NOT_ESTABLISHED',
  limitations:['Engineering/product qualification only, not globally blind.','No new physical devices, commercial qualification, scientific winner or UX SLO.',
   'Unexecuted safety counters are null, not zero. No holdout replacement or candidate retuning.','One continuous acoustic source region per independent recording session, not per attempt.'],
  nextAction:'STOP; await independent audit; no product integration or capability enablement.'});
 console.log(pass?SUCCESS:BLOCKED);
}
