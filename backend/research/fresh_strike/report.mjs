import {readFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,WORK,START,FREEZE,git,hash,json,identity} from './protocol.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const scores=await read(path.join(WORK,'development/scores.json'));
if(scores.selectedCandidate)throw Error('DEVELOPMENT_SELECTED_CANDIDATE_REQUIRES_SEPARATE_QUALIFICATION_FREEZE');
const staticResult=await read(path.join(WORK,'static.json'));
const freeze=await read(path.join(ROOT,FREEZE));
const browser=await read(path.join(WORK,'development/browser.json'));
const truth=await read(path.join(WORK,'development/truth.json'));
const reportRoot=path.join(ROOT,'backend/research/reports/fresh_strike_v2');
await mkdir(reportRoot,{recursive:true});
const copies=[['local_dataset_audit.json','dataset-audit.json'],['development/truth.json','development-manifest.json'],
 ['development/audio_only/jobs.json','audio-jobs.json'],['development/browser.json','browser.json'],
 ['development/browser-seal.json','browser-seal.json'],['development/baseline.json','baseline.json'],
 ['development/candidate-stream-seal.json','candidate-stream-seal.json'],['development/scores.json','scores.json'],['static.json','static.json']];
for(const [from,to] of copies)await copyFile(path.join(WORK,from),path.join(reportRoot,to));
const files=await Promise.all(copies.map(([,to])=>identity(path.relative(ROOT,path.join(reportRoot,to)))));
const failures=[];
for(const name of ['rise','support'])for(const [rate,m] of Object.entries(scores.metrics[name])){
  if(m.recall<.9)failures.push({name,rate,gate:'overall recall >= .90',matched:m.matched,total:m.truthGestures,actual:m.recall});
  if(m.duplicates)failures.push({name,rate,gate:'duplicate tokens = 0',actual:m.duplicates});
  if(m.negativeGuards.all_note_on_free.falseTokens)failures.push({name,rate,gate:'negative false tokens = 0',actual:m.negativeGuards.all_note_on_free.falseTokens});
  for(const family of ['same_note_retrigger','chord'])if(m.families[family].recall===null||m.families[family].recall<.9)failures.push({name,rate,gate:family+' recall >= .90',...m.families[family]});
}
const lint=staticResult.results.find(r=>r.name==='eslint');
await json(path.join(reportRoot,'final.json'),{
 disposition:'STEP_FRESH_STRIKE_EVIDENCE_QUALIFICATION_BLOCKED',
 question:'Can NoteVerse reliably identify a new score-blind physical strike under retrigger/sustain without gating Robust?',
 answer:'NOT_ESTABLISHED; neither prospectively budgeted raw candidate passed the development safety/recall screen',
 startingHead:START,implementationCommit:freeze.implementationCommit,
 freezeCommit:browser.freezeCommit,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),freezeScope:freeze.scope,
 freezeProof:{freezeCommit:browser.freezeCommit,remoteHead:browser.remoteHead,remoteVerifiedAt:browser.remoteVerifiedAt},
 developmentExecutionProof:browser.developmentExecutionProof,staticExecutionProof:staticResult.staticExecutionProof,
 qualificationExecutionProof:null,qualificationStatus:'NOT_EXECUTED_NO_CANDIDATE_SELECTED',
 qualificationCorpus:null,sourceDisjointQualificationProof:null,
 reservedQualificationFamily:{dataset:'SMD v2',role:'NOT_OPENED_FOR_SELECTED_CANDIDATE_INFERENCE',
   audit:'50 paired recordings; 45 with CC64; previously AMT/Continuous exposed, never globally blind',
   limitation:'bounded historical trigger audit found MAESTRO sources, not proof of universal non-exposure; a future qualification needs its own manifest/freeze'},
 development:{sources:truth.sources.map(s=>({id:s.recordingId,audioSha256:s.audioSha256,midiSha256:s.midiSha256})),
   cases:truth.cases.length,scoredSecondsPerRate:truth.scoredSecondsPerSourceRate,
   role:'historical MAESTRO DEVELOPMENT ONLY; overlapping case opportunities not independent trials',
   candidateDefinitions:JSON.parse(JSON.stringify((await import('./detectors.mjs')).DEFINITIONS)),
   historicalBaseline:freeze.files.find(f=>f.path==='backend/scripts/evaluate_causal_physical_strike_trigger.py'),
   budget:freeze.budget,attemptedCandidates:['decoded','historical','rise','support'],selectedCandidate:null,failures,
   metrics:scores.metrics,sourceRateParity:scores.sourceRateParity,
   candidateStreamSealSha256:scores.candidateStreamSealSha256},
 model:freeze.model,browser:{version:browser.browserVersion,gpu:browser.result.gpu,provider:browser.result.provider,ort:browser.result.ort,automaticFallback:browser.result.automaticFallback},
 actualNeuralRuns:{acceptedDevelopment:browser.result.actualSessionRunCount,invalidatedDevelopmentV1:130,qualification:0,total:browser.result.actualSessionRunCount+130},
 dspOnlyAccounting:{sourceAdapterTransactions:browser.result.results.length,historicalDetectorTransactions:browser.result.results.length,
   sourceRates:[44100,48000],qualification:0,unitSyntheticFixtures:'5 Node tests; 4 Docker Python tests, reported separately'},
 sourceAdapterIdentities:Object.fromEntries(browser.result.results.map(c=>[c.rate,c.sourceAdapterIdentity])),
 protectedProductSourceDiff:git('diff',START,'HEAD','--','apps/customer-web','backend/app'),
 verification:staticResult.results.map(r=>({name:r.name,status:r.status,counts:r.counts,messages:r.messages})),
 lintMessages:lint.messages,
 productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',
 science:{phase9GB:'STATISTICAL_TIE',winner:null,F5:'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',viennaInferenceIncrease:0},
 newExternalDatasetDownloads:0,secondActiveProductInferencePath:false,robustGatedByDetector:false,
 limitations:['No candidate selected or product integration authorized. No fresh/blind qualification claim.',
   'Development source and sparse guards cannot establish independent reliability; no confidence/generalization claim.',
   'Strong acoustic sustain and all required family coverage are not established by MIDI-only tags.',
   'No real device, hardware latency, product correctness or TOO_QUIET claim.',
   'No fusion, threshold grid, candidate revision, fallback or retuning after results.'],artifacts:files});
console.log(JSON.stringify({disposition:'STEP_FRESH_STRIKE_EVIDENCE_QUALIFICATION_BLOCKED',failures,files:files.length}));
