import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const DIR='backend/research/step_microphone_resource_v25',OUT='backend/research/reports/step_microphone_resource_v25';
const START='df82baaf95fa75ae6369058745b94785b7d5cef5',BRANCH='codex/customer-web-delivery-boundary';
const production=['step-acoustic-capture-bridge.ts','step-microphone-platform.ts','step-microphone-input.ts',
  'step-microphone-input.integration.test.ts','step-microphone-architecture.test.ts'].map(p=>'apps/customer-web/src/lib/practice/step/'+p);
const zero={realNeuralInferenceRuns:0,realModelSessionLoads:0,realWorkerModelRuns:0,decoderARunsAgainstRealTensors:0,
  decoderBRuns:0,decoderCRuns:0,PCMFileDecodeRuns:0,freshHoldoutAccess:0,V20TensorReprocessing:0,
  V21V22ThresholdStudy:0,V23GeometryStudy:0,ContinuousAcousticReplay:0,hiddenWarmups:0,unknownExecutions:0};
const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const bytes=p=>readFile(path.join(ROOT,p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const load=async p=>JSON.parse(await bytes(p));
const save=async(name,value)=>{await mkdir(path.join(ROOT,OUT),{recursive:true});await writeFile(path.join(ROOT,OUT,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
const now=()=>new Date().toISOString();
const optional=async p=>load(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
function scope(){
  assert.equal(git('branch','--show-current'),BRANCH);assert.equal(git('merge-base',START,'HEAD'),START);
  const files=[...new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(files.every(p=>production.includes(p)||p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'OUT_OF_SCOPE');return files;
}
async function verify(){
  scope();const f=await load(OUT+'/resource-protocol-freeze.json');
  for(const item of [...f.files,...(await load(OUT+'/historical-identities.json')).files])assert.equal(sha(await bytes(item.path)),item.sha256,'FROZEN_IDENTITY:'+item.path);
  return f;
}
function remote(clean=true){
  const h=git('rev-parse','HEAD');assert.equal(git('rev-parse','origin/'+BRANCH),h);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],h);
  if(clean)assert.equal(git('status','--porcelain'),'');return h;
}
function github(head){return JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",head],{cwd:ROOT,encoding:'utf8'}));}
const testArgs=['node_modules/vitest/vitest.mjs','run','src/lib/practice/local-core','src/lib/practice/step','src/lib/practice/midi',
  'src/hooks/practice/use-local-practice.test.tsx','src/components/practice','src/lib/practice/input-capability.test.ts',
  'src/lib/practice/practice-architecture-boundaries.test.ts','tests/architecture/practice-no-legacy-realtime.test.ts',
  'src/lib/practice/acoustic/runtime/source-publication.test.ts','src/lib/practice/acoustic/runtime/source-analysis-runtime.test.ts',
  'src/lib/practice/acoustic/continuous','src/lib/practice/continuous','--reporter=json',
  '--outputFile=../../'+OUT+'/product-and-persistent-tests.json'];

async function prepare(){
  scope();assert.equal(git('rev-parse','HEAD'),START);assert.equal(git('rev-parse','origin/'+BRANCH),START);
  const v24='backend/research/reports/step_acoustic_assembler_v24';
  assert.equal(sha(await bytes(v24+'/migration-protocol-freeze.json')),'b538bd370e3ab30a5e65613ef6858c57564826e0e954241fd58c22da61fca74a');
  assert.equal((await load(v24+'/assessment.json')).disposition,'STEP_V24_PRODUCTION_H50_ASSEMBLER_ESTABLISHED_BASELINE_EVIDENCE_PARITY');
  const history=[];
  for(const p of git('ls-tree','-r','--name-only',START,'--','backend/research').split('\n').filter(Boolean))history.push({path:p,sha256:sha(await bytes(p))});
  await save('historical-identities.json',{startingHead:START,files:history});
  const own=(await readdir(path.join(ROOT,DIR))).map(p=>DIR+'/'+p);
  const unchanged=git('ls-tree','-r','--name-only',START,'--','apps/customer-web/src/lib/practice','apps/customer-web/src/hooks/practice',
    'apps/customer-web/public/model-assets/practice-acoustic').split('\n').filter(Boolean);
  const paths=[...new Set([...own,...production,...unchanged,OUT+'/historical-identities.json',OUT+'/starting-gate.json',OUT+'/pre-execution-verification.json'])].sort();
  const files=[];for(const p of paths)files.push({path:p,sha256:sha(await bytes(p))});
  await save('resource-protocol-freeze.json',{phase:'STEP_MICROPHONE_RESOURCE_OWNER_V25',createdAt:now(),startingHead:START,
    contract:await load(DIR+'/contract.json'),files,productionScope:production,realExecutionCounters:zero,
    testDouble:'V25_DETERMINISTIC_INFERENCE_PORT_SYNTHETIC_PCM_NOT_ACOUSTIC_EVIDENCE',
    command:{cwd:'apps/customer-web',nodeArgs:testArgs,environment:{V25_INTEGRATION_EVIDENCE_PATH:OUT+'/persistent-resource-traces.json'}},
    persistentIntegrationExecutionsAllowed:1,execution:'NOT_STARTED',historyFiles:history.length,
    V24Rerun:false,realBrowserQualification:false,stopAfterResult:true});
  console.log(JSON.stringify({freezeSha256:sha(await bytes(OUT+'/resource-protocol-freeze.json')),historyFiles:history.length,frozenFiles:files.length}));
}
async function proof(){
  await verify();const h=remote();await save('remote-resource-freeze-proof.json',{freezeCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    freezeSha256:sha(await bytes(OUT+'/resource-protocol-freeze.json')),persistentIntegration:'NOT_STARTED',zero});console.log(h);
}
async function integrate(){
  const f=await verify(),p=await load(OUT+'/remote-resource-freeze-proof.json');
  assert.equal(p.freezeSha256,sha(await bytes(OUT+'/resource-protocol-freeze.json')));assert.equal(remote(false),p.freezeCommit);
  assert.ok(p.remoteVerifiedAt<now());await save('persistent-integration-started.json',{startedAt:now(),proof:p,executionOrdinal:1,zero});
  try{
    execFileSync(process.execPath,f.command.nodeArgs,{cwd:path.join(ROOT,f.command.cwd),encoding:'utf8',maxBuffer:64*1024*1024,
      timeout:180000,env:{...process.env,V25_INTEGRATION_EVIDENCE_PATH:path.join(ROOT,OUT,'persistent-resource-traces.json')}});
    const result=await load(OUT+'/product-and-persistent-tests.json');
    assert.equal(result.success,true);assert.equal(result.numFailedTests,0);assert.equal(result.numPendingTests,0);
    const integration=result.testResults.find(r=>r.name.replaceAll('\\','/').endsWith('/step-microphone-input.integration.test.ts'));
    assert.equal(integration.assertionResults.length,38);assert.ok(integration.assertionResults.every(r=>r.status==='passed'));
    const traces=await load(OUT+'/persistent-resource-traces.json');assert.equal(traces.persistentInstances.length,36);
    for(const t of traces.persistentInstances){
      assert.equal(t.fakeWorkerConstructions,1);assert.equal(t.fakeModelLoads,1);assert.equal(t.fakeWorkerDisposals,1);
      assert.equal(t.captureConnections,1);assert.equal(t.borrowedRootStops,0);assert.equal(t.analysisCloneStops,1);
      assert.equal(t.finalInput.analysis.counts.regionsStarted,1);assert.equal(t.finalInput.analysis.state,'DISPOSED');
      assert.equal(t.initialBoundary.capturedThroughSourceSample,t.initialBoundary.sessionTime.sampleIndex);
    }
    await verify();await save('integration-result.json',{completedAt:now(),result:'LOCAL_PASS',persistentTests:38,persistentFixtures:36,
      productTestsPassed:result.numPassedTests,productTestsFailed:result.numFailedTests,
      rates:[44100,48000],testDouble:traces.testDouble,realExecutionCounters:zero,
      V24ReplayRuns:0,noPostResultSemanticEdits:true,disposition:f.contract.success});
    console.log(JSON.stringify({passed:result.numPassedTests,persistentTests:38,fixtures:36,zero,disposition:f.contract.success}));
  }catch(error){
    await save('integration-failure.json',{failedAt:now(),message:String(error.stack??error),stdout:String(error.stdout??'').slice(-12000),
      stderr:String(error.stderr??'').slice(-12000),disposition:f.contract.integrationFailure,rerunAllowed:false,zero});
    console.error('FROZEN_INTEGRATION_FAILED_DO_NOT_PATCH_OR_RERUN');process.exitCode=1;
  }
}
async function report(){
  await verify();const f=await load(OUT+'/resource-protocol-freeze.json'),pass=await optional(OUT+'/integration-result.json'),failure=await optional(OUT+'/integration-failure.json');
  const disposition=failure?.disposition??pass?.disposition??f.contract.integrityFailure;
  const answers={exactStartingHeadVerified:true,V24Immutable:true,realNeuralModelDecoderExecution:false,
    productionStepMicrophoneResourceOwners:1,targetAndScoreBlind:true,sharedWorkerRuntimeCapturePrimitives:true,
    persistentAssemblerCountPerInput:1,sourceChronologyCountPerInput:1,longLivedAnalysisRegionsPerInput:1,
    capturedThroughFromAcceptedCaptureChunks:true,processedFrontierNeverUsedForRetirement:true,
    AudioContextOwnsClock:true,mappingFixedNotFitted:true,strictEventGreaterThanWatermark:true,equalityRejected:true,
    blockedObservationCanQueue:false,observationCanOwnTwoAttempts:false,repeatRequiresNewSourceEvidence:true,
    H50:'[T,T+50ms)',runtimeV6SoleVerdictAndProgressionOwner:true,cooldownSelected:false,qualityClassifierInvented:false,
    failureTerminalAndCleansResources:true,disposalIdempotent:true,controllerMicrophoneUnavailable:true,
    capabilitiesClosed:true,ContinuousUnchanged:true,defaults030005And6001050170Unchanged:true,schemaStill6:true,
    localTestingNotCI:true,githubCI:'See actual remote result receipt; final receipt HEAD independently queried',realBrowserQualification:'NOT_YET_EXECUTED'};
  await save('assessment.json',{phase:f.contract.phase,createdAt:now(),startingRemoteHead:START,freezeProof:await load(OUT+'/remote-resource-freeze-proof.json'),
    disposition,answers,pass,failure,productionScope:production,exactChangedFilesAtAssessment:scope(),
    V3ThroughV24Diff:[],historicalRawFilesVerified:f.historyFiles,realExecutionCounters:zero,
    currentDefaults:f.contract.currentDefaults,baselineClassification:f.contract.baselineClassification,
    capabilities:f.contract.capabilities,rearm:f.contract.rearm,cooldown:f.contract.cooldown,
    qualification:false,realChromeDeviceMeasurements:false,V24AcousticReplayRuns:0,nextAllowedPhase:f.contract.nextAllowedPhase});
  const text=`# V25 STEP Microphone Resource Owner\n\n${disposition}\n\n`+
    `The production StepMicrophoneInput uses shared BrowserAcousticCapture, SourceAnalysisRuntime and the existing Robust Worker/asset/FIR path, but remains unreachable from normal STEP startup. Runtime v6 and all V24 H50 semantics are unchanged.\n\n`+
    `One persistent chronology, mapping, assembler/identity registry and long-lived region belong to each input. Physical capturedThroughSourceSample comes only from accepted chunks. ownedThroughSourceSample is analyzed coverage for H50 only and is never a retirement watermark. AudioContext origin and a fixed PracticeTimebase preserve source sample identity; no arrival-time rewrite, transport, fit, compensation or cooldown.\n\n`+
    `Owner-issued immutable boundaries cannot be fabricated, reused, moved backward or silently committed after capture has advanced. The future application must commit runtime acceptInputAfter/rearm and input arm synchronously in that order. If arm fails after runtime commit, fail the application closed without target rollback. This orchestration is documented only, not installed in the controller.\n\n`+
    `Failure stops capture, invalidates ownership and notifies once. Analysis/Worker disposal waits for setup and publication delivery to unwind, never ends a region reentrantly. Capture owns its clone, not the root stream; AudioContext remains borrowed. No reconnect or fallback.\n\n`+
    (pass?`Local verification: ${pass.productTestsPassed} product tests passed including ${pass.persistentTests} frozen persistent tests / ${pass.persistentFixtures} end-to-end fixtures at 44.1/48k. Typecheck/lint and pre-execution regressions are recorded separately.\n\n`:`Frozen integration failed; see integration-failure.json and partial test/trace evidence. No patch or rerun is authorized.\n\n`)+
    `All real neural/model/Worker-model/decoder/PCM-file/V20-tensor/fresh-holdout/Continuous-acoustic executions are zero. Integration uses synthetic PCM and deterministic fake inference ports with actual source/runtime/assembler/domain classes. Adversarial publication injections are test doubles, not recorded acoustic output. No V24 34-row replay was rerun.\n\n`+
    `V3-V24 history and all pre-existing production files remain byte-identical. Defaults remain shared Robust 16k/29120/1820ms, decoder A .30/.05, 600/1050/170, ORT 1.20.1 WebGPU/no fallback; not a global optimum. MIDI and Continuous are unchanged.\n\n`+
    `STEP_ANALYSIS_UNAVAILABLE / ATTEMPT_ANALYZER_NOT_VALIDATED and MODEL_NOT_VALIDATED remain. productionMicrophone=false; D4=false. FIXED_MICROPHONE_COOLDOWN_NOT_ESTABLISHED.\n\n`+
    `Local tests are not GitHub CI. See remote-result-proof.json for actual status/workflow evidence. STOP for independent audit. STEP_MICROPHONE_BROWSER_QUALIFICATION_NOT_YET_EXECUTED; no browser/device/latency/UX/model qualification or capability promotion is claimed.\n`;
  await writeFile(path.join(ROOT,OUT,'assessment.md'),text,{flag:'wx'});console.log(disposition);
}
async function receipt(){
  const f=await verify(),h=remote(),files=scope(),identities=[];
  for(const p of files){const b=await bytes(p),committed=execFileSync('git',['show',h+':'+p],{cwd:ROOT,maxBuffer:64*1024*1024});
    assert.equal(sha(b),sha(committed));identities.push({path:p,sha256:sha(b)});}
  const checks=github(h);await save('remote-result-proof.json',{resultCommit:h,startingRemoteHead:START,endingRemoteHeadAtResultSeal:h,
    remoteVerifiedAt:now(),completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    exactChangedFiles:files,identities,productionChanges:files.filter(p=>p.startsWith('apps/')),existingProductionDiff:[],
    historicalRawFilesVerified:f.historyFiles,V3ThroughV24Diff:[],zero,github:checks,cleanWorktreeAtVerification:true,
    disposition:(await load(OUT+'/assessment.json')).disposition,
    receiptCommitNote:'Additive receipt committed afterwards; final HEAD is independently fetched/queried without self-reference.'});
  console.log(JSON.stringify({head:h,github:checks}));
}
const mode=process.argv[2];
if(mode==='prepare')await prepare();else if(mode==='proof')await proof();else if(mode==='integrate')await integrate();
else if(mode==='report')await report();else if(mode==='receipt')await receipt();
else if(mode==='verify'){await verify();console.log('ALL_FROZEN_SOURCES_AND_V3_V24_RAW_BYTES_EXACT');}
else throw Error('prepare/proof/integrate/report/receipt/verify only; no acoustic execution commands');
