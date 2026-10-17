import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,WORK,START,ID,CORPUS,FREEZE,PHASE,SUCCESS,BLOCKED,git,hash,fileIdentity,newJson,verify} from './protocol.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const reports=path.join(ROOT,'backend/research/reports');
if(process.argv[2]==='evidence'){
  const proof=await verify(),plan=await read(path.join(ROOT,FREEZE));
  const verification=await read(path.join(WORK,'verification.json'));
  const engineering=await read(path.join(ROOT,`backend/data/work/continuous_controller/${ID}/browser.json`));
  const musical=await read(path.join(WORK,'musical.json')),scores=await read(path.join(WORK,'scores.json')),truth=await read(path.join(WORK,'truth.json'));
  const protectedFiles=git('ls-files','apps/customer-web/src/lib/practice/local-core','apps/customer-web/src/lib/practice/acoustic-inference/continuous',
    'apps/customer-web/public/model-assets/continuous','apps/customer-web/src/lib/practice/input-capability.ts','apps/customer-web/src/hooks/practice/use-step-local-practice.ts').split('\n');
  const changes=git('diff','--name-only',START,'HEAD','--',...protectedFiles);if(changes)throw new Error('PROTECTED_IMPLEMENTATION_CHANGED:'+changes);
  const priorReports=new Set(git('ls-tree','-r','--name-only',START,'backend/research/reports').split('\n'));
  if(git('diff','--name-only',START,'HEAD').split('\n').some(p=>priorReports.has(p)))throw new Error('HISTORICAL_REPORT_CHANGED');
  const artifacts=[];
  for(const [name,value] of Object.entries({verification,engineering,musical,scores,truth})){
    const file=path.join(reports,`product_completion_${name}_v3_2026-10-17.json`);await newJson(file,value);artifacts.push(await fileIdentity(path.relative(ROOT,file)));
  }
  const confusion={};let violations=0;
  for(const cell of scores.cells)for(const s of cell.scenarios){confusion[s.truth]??={};confusion[s.truth][s.predicted]=(confusion[s.truth][s.predicted]??0)+1;violations+=s.doubleOwnership;}
  const pass=verification.status==='PASS'&&engineering.status==='PASS'&&musical.status==='PASS'&&musical.countComplete&&violations===0;
  await newJson(path.join(reports,'product_completion_final_v3_2026-10-17.json'),{
    phase:PHASE,disposition:pass?SUCCESS:BLOCKED,startingHead:START,implementationCommit:plan.implementationCommit,toolingCommit:plan.toolingCommit,proof,
    musicalExecutionStart:musical.startedAt,engineeringExecutionStart:engineering.executionStartedAt,artifacts,
    corpus:{manifest:CORPUS,pairedCount:truth.clips.length,uniqueTruthQualifiedDurationSeconds:18,sourceRateExposureSeconds:36,
      unscoredStressAudioDurationSeconds:0,syntheticSilenceSecondsPerRate:1.8,sourceRates:[44100,48000],midiOpenedOnlyAfterSeal:true,
      inventoryNotes:truth.clips.map(c=>({id:c.id,fullMidiNoteCount:c.fullMidiNoteCount,excerptNoteCount:c.notes.length,alignmentSanity:c.alignmentSanity}))},
    acousticMetrics:scores.cells.map(c=>({id:c.id,rate:c.rate,metrics:c.metrics,breakdown:c.breakdown,falsePositivePerMinute:c.falsePositivePerMinute,deficiencies:c.deficiencies})),
    product:{confusion,doubleOwnership:violations,scenarios:scores.cells.map(c=>({id:c.id,rate:c.rate,targets:c.scenarios.map(s=>({family:s.family,truth:s.truth,predicted:s.predicted,target:s.targetGroupId,extraTruthId:s.extraTruthId}))})),
      independentPerfectEvidenceRecipeTest:'tests/unit/product-replay-scenarios.test.ts: CORRECT/MISSING/WRONG/INCOMPLETE_CHORD/EXTRA/NOT_REACHED',
      immutableTruth:'Each scenario incrementally publishes sealed observations to one production ContinuousFinalizer, completion before exact-T terminal, no post-hoc rematch or acoustic modification'},
    faultPolicy:{sourceLoss:'Fatal session; no post-loss ingestion, evaluation/recording hidden, no CompletedPerformance store',
      contextLoss:'Fatal session, no new clock or reconstruction',workerFailure:'Healthy session infrastructure remains active; analysis-only UNAVAILABLE',
      cleanup:'Detach infrastructure listeners first; attempt every owned release exactly once; rejection settles FAILED, never COMPLETE',
      diagnosticCeiling:{entries:32,detailCharacters:256,planningBytes:32768,notMeasuredTotalHeap:true},
      tests:verification.results.find(r=>r.name==='vitest')?.testFiles.filter(f=>/continuous-practice-controller|continuous-presentation|product-replay|practice-status|use-local-practice/.test(f.path))},
    ui:{stableLocalizedErrors:true,rawStacksNotExposed:true,controllerMapping:'continuous-presentation.ts',restart:'dispose failed controller; new resources/session; no reuse'},
    engineering:{cells:engineering.cells.map(c=>({rate:c.rate,scenario:c.scenario,state:c.state})),status:engineering.status,
      actualModelRuns:engineering.actualModelRuns,musicalController:musical.controllerResult},
    counters:{realNeuralModelRuns:engineering.actualModelRuns+musical.actualModelRuns,musicalModelRuns:musical.actualModelRuns,engineeringModelRuns:engineering.actualModelRuns,
      modelRunCountComplete:musical.countComplete&&engineering.modelRunCountComplete,newDatasetDownloads:0,realPhysicalMicrophones:0},
    invalidatedTrial:await read(path.join(reports,'product_completion_invalidation_v1_2026-10-17.json')),
    invalidatedTrialV2:await read(path.join(reports,'product_completion_invalidation_v2_2026-10-17.json')),
    phaseTotalModelCount:'Accepted v3 count plus 84 known invalidated v2 runs plus 18 known invalidated v1 engineering runs plus at least one invalidated v1 musical run; exact phase total unavailable because v1 failed-cell counter was not serialized.',
    capabilities:{continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
    hardware:{realDeviceQualification:'DEFERRED',hardwareEnablementGate:'NOT_EXECUTED'},
    protections:{changedProtectedFiles:[],historicalReportsChanged:[],F5:'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',phase9GB:'STATISTICAL_TIE',winner:null,
      ViennaP15P22InferenceIncrease:0,commercialQualification:'NOT_PERFORMED',productLatencySlo:'NOT_YET_FROZEN',noOptimalProfileClaim:true,
      acousticCoreSha256:'93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443'},
    limitations:['Already exposed SMD development data, not fresh scientific evaluation or natural independent fixed-BPM human performance.',
      'Silence is deterministic PCM zero, not a physical quiet room or metronome contamination test.',
      'MIDI velocity is not calibrated microphone dynamics; performer identity is not asserted from filename.',
      'Accelerated backpressured musical replay does not qualify causal publication latency or UX SLO. Existing fake-media suite supplies causal engineering lifecycle only.',
      'Musical controller replay replaces physical capture only; default AudioContext, real Worker/model, fixed fixture score. Primary paired metrics use exact frozen PCM/runtime boundaries separately.',
      'No physical microphone, getUserMedia device compatibility, hardware input latency, hardware stability or commercial enablement claim.']});
  console.log(pass?SUCCESS:BLOCKED);
}else if(process.argv[2]==='github'){
  const head=git('rev-parse','HEAD');const credentials=execFileSync('git',['credential','fill'],{cwd:ROOT,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
  const token=credentials.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(!token)throw new Error('NO_GITHUB_CREDENTIAL');
  const api=async endpoint=>{const r=await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'+endpoint,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!r.ok)throw new Error('GITHUB:'+r.status);return r.json();};
  const combined=await api(`commits/${head}/status`),statuses=await api(`commits/${head}/statuses`),runs=await api(`actions/runs?head_sha=${head}`);
  const remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];if(remote!==head)throw new Error('REMOTE_MOVED');
  await newJson(path.join(reports,'product_completion_github_receipt_v3_2026-10-17.json'),{phase:PHASE,queriedAt:new Date().toISOString(),evidenceCommit:head,actualRemoteHead:remote,
    commits:git('log','--reverse','--format=%H %s',`${START}..HEAD`).split('\n'),combinedState:combined.state,statuses,workflow_runs:runs.workflow_runs,
    interpretation:statuses.length===0&&runs.workflow_runs.length===0?'NOT CI PASS':'ACTUAL_GITHUB_EVIDENCE_ONLY'});
  console.log(JSON.stringify({head,state:combined.state,statuses:statuses.length,workflow_runs:runs.workflow_runs.length}));
}
