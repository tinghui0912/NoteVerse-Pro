import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ROOT,OUT,DIR,START,bytes,load,save,hash,git,now,zero } from './io.mjs';
import { verify,scope,remote } from './audit.mjs';
const optional=async p=>load(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});

export async function report(){
  await verify();const c=await load(DIR+'/contract.json'),r=await optional(OUT+'/migration-replay-results.json'),failure=await optional(OUT+'/replay-failure.json');
  const disposition=failure?.disposition??r?.disposition??'STEP_V24_H50_MIGRATION_EVIDENCE_INTEGRITY_BLOCKED';
  await save(OUT+'/assessment.json',{phase:c.phase,classification:c.classification,createdAt:now(),startingRemoteHead:START,
    completeCommitChainAtAssessment:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    proof:await load(OUT+'/remote-migration-freeze-proof.json'),answers:{
      V23LeftImmutable:true,allNeuralModelDecoderPCMCountersZero:zero,currentDefault6001050170And030005:true,newAcousticTuning:false,
      productionH50AssemblerCount:1,targetAndScoreBlind:true,strictEventGreaterThanWatermark:true,
      halfOpenInterval:'[T,T+50ms)',sourceFrontierSealNotTimer:true,allBoundedPitchesPreserved:true,minimumConfidencePreserved:true,
      oldDelayedPublicationCanOpenAfterRetirement:false,observationCanBelongToTwoAttempts:false,
      allFrozenAssembliesExactlyMatch:r?.completeAssemblyParity??false,assembliesChecked:r?.assembliesChecked??0,
      runtimeV6Verdicts:r?.verdicts??null,physicalClassifications:r?.classifications??null,
      externalP2Executions:r?.externalP2Executions??0,MIDIRemainsExactSet:true,ContinuousBehaviorUnchanged:true,
      microphoneCooldownSelected:false,STEPReason:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,
      freshHoldoutTouched:false,gitHubCIPass:'Actual result-commit statuses/workflows in remote-result-proof.json; local tests are not CI.'},
    sourceNeutralFrontier:'ownedThroughSourceSample = sourceOrigin + ownedEndTarget * sourceRate / 16000; exclusive processed coverage, not physical captured-through',
    mapping:'PracticeTimebase fixed source/sample anchor in same localSessionId; sampleIndex retained; no transport/arrival-clock/fit/compensation',
    ownership:{acousticPipeline:'Source observations only',assembler:'Bounded ownership only',runtime:'Target-relative verdict and progression only',
      controllerResourceOwner:'Future qualified retirement/READY orchestration; not wired in V24',hooks:'Projection only'},
    rearm:c.rearm,cooldown:c.cooldown,currentDefaults:c.currentDefaults,baselineClassification:c.baselineClassification,
    allowedProductionChanges:await scope(),historicalRawFilesVerified:(await load(OUT+'/historical-identities.json')).files.length,
    V3ThroughV23Diff:[],zero,semanticAssemblyDifferences:r?.semanticAssemblyDifferences??failure?.mismatches??null,
    evidenceResultArtifact:r?OUT+'/migration-replay-results.json':null,failure,
    evidenceSource:'V7 baseline .30/.05 at 600/1050/170; V15 historical assemblies; V18 current-runtime records; no V23 candidate outputs',
    localVerification:await load(OUT+'/local-verification.json'),capabilities:c.capabilities,
    microphoneQualification:false,browserMicrophoneEnabled:false,physicalUXLatencyQualification:false,cooldownQualification:false,
    acousticScientificValidation:false,disposition,nextAllowedPhase:'STOP_WAIT_FOR_INDEPENDENT_AUDIT_NO_AUTOMATIC_MICROPHONE_INTEGRATION'});
  const lines=['# V24 Production H50 Assembler Migration','',disposition,'',
    'One production StepAcousticAttemptAssembler now owns score-blind bounded gesture evidence. StepPracticeRuntime v6 remains untouched and alone owns target-relative verdict/progression. Browser microphone startup remains fail-closed.','',
    r?`Exact bounded assembly parity: ${r.assembliesChecked}/${r.assembliesChecked}; semantic differences ${r.semanticAssemblyDifferences.length}. Verdicts ${JSON.stringify(r.verdicts)}. Physical classifications ${JSON.stringify(r.classifications)}.`:'Replay blocked; see failure evidence.','',
    'Shared publication adds only absolute exclusive ownedThroughSourceSample. It is analyzed source coverage, not physical capture retirement and not product time. Continuous projection ignores it and retains existing semantics.','',
    'First strictly eligible source event anchors [T,T+50ms). All pitches/extras remain, confidence is minimum, seal uses source frontier only. No timer, target filter, detector, decoder, cooldown or resource startup exists in the assembler. Duplicate IDs are idempotent, mutated IDs fail closed, no ID can acquire a second attempt.','',
    'PracticeTimebase maps fixed source/sample anchors into localSessionId and preserves sampleIndex. Publication arrival is never source-event time. The external owner establishes retirement/READY after runtime rearm; the assembler never rearms or advances targets. Processed frontier is never presented as physical captured-through.','',
    'Replay directly consumes immutable V7 current-baseline publications and adds the mathematically established frontier from V6/V20 metadata. Full observations are not regenerated. It compares anchor/end, complete IDs/order/source samples, pitches, minimum confidence, source domain and rate before forwarding ordinary EVIDENCE to runtime. No external P2. Fixed prior paced replay epochs are not microphone timing/retirement qualification. Persistent-instance same-target safety is separately covered by production tests.','',
    'V3-V23 evidence stays byte-identical. V23 600/120 output is not a reference/default. Current defaults remain shared Robust, 16k mono, 29120/1820ms, decoder A .30/.05, owned600/past1050/future170; not a global optimum. MIDI path and Continuous implementation remain unchanged.','',
    'All real neural/model/Worker/decoder/PCM-codec/fresh-holdout/Continuous-acoustic execution counts are zero. Source runtime and Continuous regression unit tests use deterministic inference ports/test doubles; no model or decoder tests were run. Local results and actual GitHub receipts are kept separately.','',
    'REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY. FIXED_MICROPHONE_COOLDOWN_NOT_ESTABLISHED. STEP_ANALYSIS_UNAVAILABLE / ATTEMPT_ANALYZER_NOT_VALIDATED remains. Capabilities closed.','',
    'STOP for independent audit. No microphone qualification, browser enablement, physical UX latency, cooldown qualification or scientific acoustic validation is claimed.'];
  await writeFile(path.join(ROOT,OUT,'assessment.md'),lines.join('\n')+'\n',{flag:'wx'});
  console.log(JSON.stringify({disposition,verdicts:r?.verdicts??null,zero}));
}
export async function receipt(){
  await verify();const head=await remote(),files=await scope(),identities=[];
  for(const p of files){const b=await bytes(p),remoteBytes=execFileSync('git',['show',head+':'+p],{cwd:ROOT,maxBuffer:64*1024*1024});
    assert.equal(hash(b),hash(remoteBytes),'COMMITTED_BYTES:'+p);identities.push({path:p,sha256:hash(b)});}
  const github=JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",head],{cwd:ROOT,encoding:'utf8'}));
  await save(OUT+'/remote-result-proof.json',{startingRemoteHead:START,resultCommit:head,endingRemoteHeadAtResultSeal:head,remoteVerifiedAt:now(),
    completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),exactChangedFiles:files,identities,
    V3ThroughV23Diff:[],productionChanges:files.filter(p=>p.startsWith('apps/')),onlyAllowedProductionChanges:true,
    historicalRawFilesVerified:(await load(OUT+'/historical-identities.json')).files.length,zero,github,cleanWorktreeAtVerification:true,
    disposition:(await load(OUT+'/assessment.json')).disposition,
    receiptCommitNote:'This additive receipt is committed afterwards; final receipt HEAD is independently fetched and verified without self-reference.'});
  console.log(JSON.stringify({head,github}));
}
