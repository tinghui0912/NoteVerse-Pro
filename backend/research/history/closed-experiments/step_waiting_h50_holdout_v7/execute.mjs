import {readFile,copyFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,DIR,OUT,WORK,load,newJson,hash} from './core.mjs';
const records=[];let phase='static',failure=null,disposition='STEP_WAITING_H50_STAGE_A_ACOUSTIC_OUTPUT_SEALED_TRUTH_NOT_OPENED';
const run=(file,args=[])=>{const item={file,args,startedAt:new Date().toISOString()};records.push(item);
 try{item.stdout=execFileSync(process.execPath,[path.join(ROOT,DIR,file),...args],{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024});item.exit=0;console.log(item.stdout);}
 catch(error){item.exit=error.status;item.stdout=error.stdout?.toString();item.stderr=error.stderr?.toString();throw error;}
 finally{item.completedAt=new Date().toISOString();}};
const maybe=async file=>{try{return await load(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
try{
 run('tests.mjs',['post']);phase='Continuous';
 for(const part of ['engineering','musical','parity'])run('continuous.mjs',[part]);
 phase='StageA';run('stage-a-runner.mjs');
}catch(error){failure=String(error.stack??error);disposition=phase==='Continuous'?'STEP_WAITING_H50_BLOCKED_BY_FRESH_CONTINUOUS_REGRESSION':'STEP_WAITING_H50_STAGE_A_ACOUSTIC_EXECUTION_BLOCKED';}
const proof=await maybe(path.join(ROOT,OUT,'execution-remote-proof.json'));
const e=await maybe(path.join(WORK,'continuous-engineering/browser.json')),m=await maybe(path.join(WORK,'continuous-musical/musical.json'));
for(const [from,to] of [['continuous-engineering/browser.json','continuous-engineering.json'],['continuous-musical/musical.json','continuous-musical.json'],['continuous-musical/acoustic_seal.json','continuous-acoustic-seal.json']]){
 try{await copyFile(path.join(WORK,from),path.join(ROOT,OUT,to),constants.COPYFILE_EXCL);}catch(error){if(error.code!=='ENOENT')throw error;}
}
let a=await maybe(path.join(ROOT,OUT,'stage-a/acoustic.json'));
if(phase==='StageA'&&!a){
 a={...proof,status:'BLOCKED_AUDIO_OUTPUT_SEALED',failure,actualModelRuns:0,modelRunCountComplete:false,
  jobsExpected:18,jobsCompleted:0,windowsExpected:228,windowsCompleted:0,workerConstructions:'UNKNOWN_BEFORE_EVIDENCE',modelSessionLoads:'UNKNOWN_BEFORE_EVIDENCE',
  requests:[],diagnostics:records.at(-1),truthOpened:false,midiOpened:false,scenarioOpened:false,targetOpened:false,productVerdictComputed:false};
 await newJson(path.join(ROOT,OUT,'stage-a/acoustic.json'),a);
 await newJson(path.join(ROOT,OUT,'stage-a/acoustic-seal.json'),{...proof,status:'BLOCKED_AUDIO_OUTPUT_SEALED',
  acousticFile:OUT+'/stage-a/acoustic.json',acousticSha256:hash(await readFile(path.join(ROOT,OUT,'stage-a/acoustic.json'))),
  truthOpened:false,truthNotServed:true,midiOpened:false,scenarioOpened:false,targetOpened:false,productVerdictComputed:false,actualModelRuns:0,modelRunCountComplete:false});
}
if(a?.modelInputMismatches)disposition='STEP_WAITING_H50_STAGE_A_FROZEN_MODEL_INPUT_MISMATCH';
if(/TRUTH_ISOLATION/.test(JSON.stringify(a?.failure??failure)))disposition='STEP_WAITING_H50_STAGE_A_TRUTH_ISOLATION_VIOLATION';
const gate=await maybe(path.join(ROOT,OUT,'continuous-gate.json'));
const summary={phase:'PRACTICE_STEP_H50_PRIMARY_QUALIFICATION_CONTINUOUS_PREREQUISITE_AND_BLIND_STAGE_A',...proof,
 startingRemoteHead:'44c464e6d26631d777941eff52f1bef55fad2a3f',primaryFreezeCommit:'570114cbe1f11983d6b07956078b4a655275b976',
 primaryFreezeSha256:'4a0264d06939fab1c12f1199be1903bc089cbe9fa0f0bf06f1456c4faf298b57',primaryFreezeIntegrity:await load(OUT+'/primary-integrity.json'),
 productionDiff:'',v3Diff:'',v4Diff:'',v5Diff:'',v6Diff:'',staticVerification:await maybe(path.join(ROOT,OUT,'tests-post.json')),
 Continuous:gate??{engineeringCells:e?.cells?.length??0,engineeringPass:e?.cells?.filter(c=>c.state==='PASS').length??0,
  engineeringActualModelRuns:e?.actualModelRuns??0,musicalCells:m?.results?.length??0,musicalPass:m?.results?.length??0,
  musicalActualModelRuns:m?.results?.reduce((n,r)=>n+r.actualModelRuns,0)??0,productionControllerPass:m?.controllerResult?.status??'NOT_STARTED',
  productionControllerActualModelRuns:m?.controllerResult?.actualModelRuns??0,totalActualModelRuns:(e?.actualModelRuns??0)+(m?.actualModelRuns??0),
  modelRunCountComplete:(e?.modelRunCountComplete??false)&&(m?.countComplete??(phase==='Continuous'&&!m)),semanticDiffs:'NOT_MEASURED',
  engineeringFailure:e?.failure??null,musicalFailure:m?.failure??null},
 StageA:a?Object.fromEntries(['status','opaqueJobManifestSha256','jobsExpected','jobsCompleted','windowsExpected','windowsCompleted','actualModelRuns','modelRunCountComplete',
 'workerConstructions','modelSessionLoads','browser','GPU','ORT','modelIdentity','modelInputMismatches','requests','forbiddenRequests','bundles','truthBearingBundleInputs',
 'truthOpened','midiOpened','scenarioOpened','targetOpened','productVerdictComputed','failure'].map(k=>[k,a[k]??null])):{status:'NOT_STARTED',actualModelRuns:0},
 acousticOutputFile:a?OUT+'/stage-a/acoustic.json':'NOT_CREATED',acousticOutputSha256:a?hash(await readFile(path.join(ROOT,OUT,'stage-a/acoustic.json'))):'NOT_CREATED',
 acousticSealFile:a?OUT+'/stage-a/acoustic-seal.json':'NOT_CREATED',acousticSealSha256:a?hash(await readFile(path.join(ROOT,OUT,'stage-a/acoustic-seal.json'))):'NOT_CREATED',
 StageB:'NOT_STARTED',safetyCounters:'NOT_MEASURED',usabilityMetrics:'NOT_MEASURED',productLatencyMetrics:'NOT_MEASURED',commercialQualification:'NOT_PERFORMED',
 capabilities:{Continuous:'MODEL_NOT_VALIDATED',STEP:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
 scientificDisposition:'STATISTICAL_TIE / NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',RobustRole:'browser/product engineering default',
 failure,disposition,records,nextAllowedPhase:failure?'Independent audit of sealed failure; no rerun or Stage B':'Independent audit of remote acoustic seal; only then separately authorize frozen Stage B; no integration'};
await newJson(path.join(ROOT,OUT,'assessment.json'),summary);console.log({disposition,ContinuousRuns:summary.Continuous.totalActualModelRuns,StageARuns:a?.actualModelRuns??0});
if(failure)process.exitCode=1;
