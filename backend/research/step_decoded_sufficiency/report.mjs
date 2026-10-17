import {readFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,WORK,START,FREEZE,git,hash,identity,json} from './protocol.mjs';
const read=async p=>JSON.parse(await readFile(path.join(WORK,p),'utf8'));
const scores=await read('scores.json'),acoustic=await read('acoustic.json'),staticResult=await read('static.json');
const freeze=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
const target=path.join(ROOT,'backend/research/reports/step_decoded_sufficiency_v1');await mkdir(target,{recursive:true});
const files=['inventory.json','truth.json','audio_only/jobs.json','acoustic.json','acoustic-seal.json','product.json','scores.json','static.json'];
for(const file of files)await copyFile(path.join(WORK,file),path.join(target,path.basename(file)));
const staticPass=staticResult.results.every(r=>r.status===0);
const disposition=staticPass?scores.disposition:'STEP_DECODED_ACOUSTIC_ATTEMPT_SAFETY_NOT_ESTABLISHED';
await json(path.join(target,'final.json'),{disposition,startingHead:START,implementationCommit:freeze.implementationCommit,
 freezeCommit:acoustic.freezeCommit,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),
 freezeProof:{freezeCommit:acoustic.freezeCommit,remoteHead:acoustic.remoteHead,remoteVerifiedAt:acoustic.remoteVerifiedAt},
 staticExecutionProof:staticResult.staticExecutionProof,acousticExecutionProof:acoustic.acousticExecutionProof,productExecutionProof:scores.productExecutionProof,
 acousticSealSha256:scores.acousticSealSha256,model:freeze.model,browserVersion:acoustic.browserVersion,
 actualNeuralModelRuns:acoustic.result.actualModelRuns,sourceRateRuns:acoustic.result.results.reduce((counts,c)=>(counts[c.rate]=(counts[c.rate]??0)+c.windows.length,counts),{}),
 sourceAdapterIdentities:Object.fromEntries(acoustic.result.results.map(c=>[c.rate,c.sourceAdapterIdentity])),
 summaries:scores.summaries,dangerousWitnessCount:scores.dangerousWitnesses.length,
 usability:scores.usability,latencyScope:scores.latencyScope,
 rearm:freeze.contract.rearm,midi:freeze.contract.midi,continuousMidi:freeze.contract.continuousMidi,
 verification:staticResult.results.map(r=>({name:r.name,status:r.status,counts:r.counts,messages:r.messages})),
 sourceDiff:git('diff','--name-only',START,'HEAD'),
 protectedAcousticAndContinuousDiff:git('diff',START,'HEAD','--','apps/customer-web/src/lib/practice/acoustic','apps/customer-web/src/lib/practice/continuous',
  'apps/customer-web/src/lib/practice/local-core/continuous-*','apps/customer-web/public/model-assets/practice-acoustic','backend/app'),
 previousFreshStrikeResult:'STEP_FRESH_STRIKE_EVIDENCE_QUALIFICATION_BLOCKED; historical artifacts unchanged',
 productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',
 commercialQualification:'NOT_PERFORMED',realDeviceQualification:'NOT_PERFORMED',newDatasetDownloads:0,
 scientificProtections:{phase9GB:'STATISTICAL_TIE',winner:null,F5:'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',viennaInferenceIncrease:0},
 limitations:['Finite previously AMT/Continuous-exposed SMD engineering corpus, not globally blind or independent scientific generalization.',
  'Counterfactual scenarios, overlapping clips and both source rates repeat opportunities; pooled counts are not independent trials.',
  'No new physical-strike detector, no .30/.05 tuning, no model/FIR/geometry changes.',
  'Replay availability is context-ready time plus measured sequential Worker transaction duration; not hardware or end-to-end UI latency.',
  'Usability has no product SLO gate. No microphone integration, real-device, commercial, TOO_QUIET or universal zero-error claim.'],
 artifacts:await Promise.all(files.map(f=>identity(path.relative(ROOT,path.join(target,path.basename(f))))))});
console.log(JSON.stringify({disposition,modelRuns:acoustic.result.actualModelRuns,dangerousWitnesses:scores.dangerousWitnesses.length,staticPass}));
