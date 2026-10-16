import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {ROOT,WORK,REPORTS,PHASE,START,CORE,git,load,fileId,newJson,sourceRows,canonical,freezePath} from './xc6-evidence.mjs';

const [command]=process.argv.slice(2);
if(command==='github'){
  const commit=git('rev-parse','HEAD'),base='https://api.github.com/repos/tinghui0912/NoteVerse-Pro',requests=[];
  for(const[k,url]of[['combinedStatus',`${base}/commits/${commit}/status`],['workflowRuns',`${base}/actions/runs?head_sha=${commit}&per_page=100`],['branch',`${base}/branches/codex%2Fcustomer-web-delivery-boundary`]]){
    const response=await fetch(url,{headers:{'User-Agent':'NoteVerse-XC6-evidence','Accept':'application/vnd.github+json'}});
    if(!response.ok)throw new Error('GITHUB_API_FAILED:'+response.status);requests.push({kind:k,url,body:await response.json()});
  }
  if(requests[2].body.commit.sha!==commit)throw new Error('GITHUB_REMOTE_HEAD_MISMATCH');
  const r={phase:PHASE,queriedCommit:commit,queriedAt:new Date().toISOString(),requests,
    combinedState:requests[0].body.state,statuses:requests[0].body.statuses,workflowRuns:requests[1].body.workflow_runs,
    interpretation:'Empty statuses/workflows are not CI PASS.'};
  await newJson(path.join(WORK,`github_${commit}.json`),r);
  console.log(JSON.stringify({commit,combinedState:r.combinedState,statuses:r.statuses,workflowRuns:r.workflowRuns}));
}else if(command==='final'){
  const f=await load(freezePath('capture_integration'));
  if(canonical(await sourceRows())!==canonical(f.sources))throw new Error('SOURCE_CHANGED_AFTER_INTEGRATION_FREEZE');
  const smoke=await load(path.join(WORK,'integration/result.json')),fake=await load(path.join(WORK,'metadata_fake.json')),real=await load(path.join(WORK,'metadata_real.json'));
  if(smoke.result.status!=='XC6_FAKE_MEDIA_END_TO_END_CAPTURE_SMOKE_PASS'||smoke.proof.remoteHead!==smoke.proof.freezeCommit
    ||smoke.proof.remoteVerifiedAt>=smoke.executionStartedAt)throw new Error('REMOTE_FREEZE_OR_SMOKE_NOT_PASS');
  const changes=git('diff','--name-status',START).split('\n').filter(Boolean);
  if(changes.some(line=>!line.startsWith('A\t')))throw new Error('PREEXISTING_SOURCE_OR_REPORT_CHANGED');
  const memory={rawSourceBytesPerMinute:{44100:44100*4*60,48000:48000*4*60},
    implementedTimelineBytesPerMinute:{44100:44100*4*60,48000:16000*4*60},
    rawSourceEquivalentRetention:[5,10,20].map(minutes=>({minutes,bytes44100:minutes*44100*4*60,bytes48000:minutes*48000*4*60})),
    implementedTimelineRetention:[5,10,20].map(minutes=>({minutes,bytes44100:minutes*44100*4*60,bytes48000Filtered16k:minutes*16000*4*60})),
    targetRingBytes:65536*4,activeWorkerInputBytes:29120*4,transportCloneBytesPerWindow:29120*4,
    mainQueuedInputBytesPerWindow:29120*4,queueTotalMaximum:'UNBOUNDED_IF_PRODUCER_OUTRUNS_CONSUMER_NO_SILENT_DROP',
    exclusions:'Typed PCM payload only; timeline block slack/object overhead, publications, ONNX/session/GPU/cache allocations are additional.',
    classification:'PCM_RETENTION_MUST_BE_BOUNDED_BEFORE_PRODUCT_ENABLEMENT',privacyPolicyClaim:false};
  const dsp=await load(path.join(WORK,'dsp48_reference.json')),checks=await load(path.join(WORK,'checks.json'));
  const r={phase:PHASE,startingRemoteHead:START,commitSequence:git('log','--reverse','--format=%H',START+'..HEAD').split('\n'),
    disposition:'XC6_DISABLED_CAPTURE_BRIDGE_READY_FAKE_MEDIA_REAL_DEVICE_NOT_PERFORMED',
    remoteFreezePrecedesBrowserExecution:smoke.proof,executionStartedAt:smoke.executionStartedAt,
    consoleErrorAttribution:await load(path.join(REPORTS,'phase9g_xc6_xc5_console_attribution_2026-10-16.json')),
    microphoneMetadata:{real,fake},sourceAdapterIdentities:await load(path.join(ROOT,'apps/customer-web/src/lib/practice/acoustic-inference/xc6-source-identities.json')),
    dsp48ReferenceIdentity:await fileId(path.join(WORK,'dsp48_reference.json')),dsp48Policy:dsp.filter,
    dsp48BrowserParity:smoke.result.dsp,browserIntegration:smoke,focusedChecks:checks,memory,
    historicalSourceAndReportsUnchanged:true,trackedChanges:changes,sourceHashBoundary:f.sources,
    xc5CaveatPreserved:'Freeze artifact/source hashes preceded XC5 smoke, but its Git freeze commit followed smoke due stale lock. XC6 uses remote freeze gate; no cosmetic XC5 rerun.',
    xc4CoreIdentitySha256:CORE,xc5Disposition:'XC4_BROWSER_ACOUSTIC_RUNTIME_INTEGRATION_READY_DISABLED',
    productionMicrophoneCapability:'MODEL_NOT_VALIDATED',productionMicrophone:false,productFinalizer:'R2_RESEARCH_POLICY_NOT_PRODUCTION_QUALIFIED',
    sourceClock:'AudioWorklet currentFrame authoritative; externally scheduled source boundaries mapped with AudioContext.getOutputTimestamp. No arrival-time event timing or cursor authority.',
    preRollAndTail:'1050ms fully real past; first10 FIR boundary outputs excluded. Early start rejected. Exact external stop; real future/lookahead context-only. No padded finish.',
    geometryChallenger:'600/120 remains STRONGEST_UNPROMOTED_GEOMETRY_CHALLENGER; historical higher agreement/recall but more residual EXTRA. No new comparison.',
    decoderPolicy:{A:'CURRENT_ENGINEERING_DEFAULT',B:'RESEARCH_CHALLENGER_NOT_DEFAULT',C:'TESTED_NO_DEMONSTRATED_ENGINEERING_ADVANTAGE'},
    counters:{newExternalDatasetDownloads:0,newScientificBenchmarkRuns:0,newDecoderComparisons:0,newGeometrySweeps:0,newModelComparisons:0,newMidiTruthReads:0,
      engineeringModelRuns:4+smoke.result.actualSessionRunCount,diagnosticReproductionRuns:4,captureIntegrationRuns:smoke.result.actualSessionRunCount,realDevicePermissionAttempts:1},
    scopeProtections:(await load(path.join(REPORTS,'phase9g_xc4_engineering_default_final_2026-10-16.json'))).scopeProtections,
    limitations:['No granted real-device permission;48k was established with browser-faithful fake capture, not claimed as an observed real microphone rate.',
      'Single short engineering smoke and deterministic DSP parity, not accuracy, indefinite runtime or product/UX qualification.',
      '48k boundary commands require original source indices divisible by3; natural fixed-BPM timing and device-clock drift still need product qualification.',
      'PCM/session retention and potentially growing queues must be bounded before product enablement.'],
    evidenceCommit:'Containing evidence-only commit returned after push; not self-referential.',githubEvidence:'Versioned github command queries actual pushed HEAD; empty arrays are not CI PASS.'};
  await newJson(path.join(REPORTS,'phase9g_xc6_disabled_capture_final_2026-10-16.json'),r);
}else throw new Error('XC6_REPORT_COMMAND');
