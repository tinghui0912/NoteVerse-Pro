import path from 'node:path';
import {ROOT,APP,WORK,REPORTS,START,PHASE,CORE,freezeId,git,hash,canonical,load,newJson,fileId,assertFrozenSources} from './xc7-evidence.mjs';
const command=process.argv[2];
if(command==='github'){
  const commit=git('rev-parse','HEAD'),base='https://api.github.com/repos/tinghui0912/NoteVerse-Pro',rows=[];
  for(const [kind,url]of [['status',`${base}/commits/${commit}/status`],['runs',`${base}/actions/runs?head_sha=${commit}&per_page=100`],
    ['branch',`${base}/branches/codex%2Fcustomer-web-delivery-boundary`]]){
    const r=await fetch(url,{headers:{'User-Agent':'NoteVerse-XC7-evidence',Accept:'application/vnd.github+json'}});
    if(!r.ok)throw new Error('GITHUB_API_FAILED:'+r.status);rows.push({kind,url,body:await r.json()});
  }
  if(rows[2].body.commit.sha!==commit)throw new Error('GITHUB_REMOTE_HEAD_MISMATCH');
  const r={phase:PHASE,queriedCommit:commit,queriedAt:new Date().toISOString(),requests:rows,
    combinedState:rows[0].body.state,statuses:rows[0].body.statuses,workflowRuns:rows[1].body.workflow_runs,interpretation:'Empty arrays are not CI PASS.'};
  await newJson(path.join(WORK,`github_${commit}.json`),r);console.log(JSON.stringify({commit,combinedState:r.combinedState,statuses:r.statuses,workflowRuns:r.workflowRuns}));
}else if(command==='final'){
  const freeze=await assertFrozenSources(),checks=await load(path.join(WORK,`checks_${freezeId}.json`)),vitest=await load(path.join(WORK,`vitest_${freezeId}.json`)),
    smoke=await load(path.join(WORK,freezeId,'result.json')),long=await load(path.join(WORK,`long_session_${freezeId}.json`)),
    pressure=await load(path.join(WORK,`backpressure_${freezeId}.json`));
  if(!vitest.success||vitest.numFailedTests||checks.runs.some(r=>r.exitCode!==0)||smoke.result.status!=='XC7_BOUNDED_FAKE_MEDIA_SMOKE_PASS'
    ||smoke.proof.remoteVerifiedAt>=smoke.executionStartedAt||long.snapshot.state!=='SEALED'||long.streamed!==3000
    ||pressure.atFailure.error!=='Error: ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED'||pressure.delivered!==0)throw new Error('XC7_FINAL_GATES_NOT_PASS');
  const changed=git('diff','--name-status',START).split('\n').filter(Boolean);
  const forbidden=changed.filter(s=>!s.startsWith('A\t')&&!['apps/customer-web/src/lib/practice/acoustic-inference/xc4-robust-acoustic-runtime.ts',
    'apps/customer-web/src/lib/practice/acoustic-inference/xc6-capture-bridge.ts'].includes(s.slice(2)));
  if(forbidden.length)throw new Error('XC7_UNEXPECTED_HISTORICAL_CHANGE:'+forbidden.join());
  const oldXc6=JSON.parse(git('show',`${START}:backend/research/reports/phase9g_xc6_disabled_capture_final_2026-10-16.json`));
  const receipts={};for(const name of ['long_session','backpressure','fast_parity_44100','fast_parity_48000'])receipts[name]=await load(path.join(WORK,`${name}_${freezeId}.json`));
  const testCounts=vitest.testResults.map(f=>({file:f.name.split('/').at(-1),count:f.assertionResults.length,passed:f.assertionResults.filter(t=>t.status==='passed').length}));
  const report={phase:PHASE,startingRemoteHead:START,commitsBeforeEvidence:git('log','--reverse','--format=%H',START+'..HEAD').split('\n'),
    disposition:'XC7_BOUNDED_ACOUSTIC_RESOURCES_READY_DISABLED',freeze,remoteFreezeProof:smoke.proof,
    browserExecutionStartedAt:smoke.executionStartedAt,checksRemoteProof:await load(path.join(WORK,`checks_remote_proof_${freezeId}.json`)),
    previousXc6Disposition:oldXc6.disposition,xc4CoreIdentitySha256:CORE,
    sourceAdapterIdentities:await load(path.join(APP,'src/lib/practice/acoustic-inference/xc6-source-identities.json')),
    boundedTimeline:{strategy:'ONE_SEGMENT_METADATA_ONLY',retainedPcmBytes:0,genericPerformancePcmTimelineUnmodified:true,
      originalSourceCoordinatesPreserved:true,metadataSegmentCount:1},
    resourceBounds:{outstandingWindows:4,mainOutstandingInputsBytes:465920,activeIncludedInMainLimit:true,
      workerInputCloneBytes:116480,providerAdditionalInputReservationBytes:116480,targetRingBytes:262144,firSourceRingBytes:512,
      conservativePcmSubtotalExcludingCaptureCoefficientsAndOrtInternal:961536,diagnosticWindows:32,
      diagnosticObservationsMaximum:32*183*88,diagnosticOneKiBPerObservationPlanningEstimate:32*183*88*1024,
      diagnosticEstimateIsNotMeasuredJsHeapCeiling:true,workletPendingBlocks:32,maximumBlockSamples:2048,
      workletInTransitPcmMaximumBytes:262144,workletInTransitAtObserved128QuantumBytes:16384,activeIngressMaximumBytes:8192,
      sessionDurationDependentPcmStorage:false,coefficientsBytes44100:35284*2,coefficientsBytes48000:244,
      exclusions:'JS object headers, scalar metadata, bounded temporary projections/filter arrays, model/ORT/GPU/OPFS memory and external sink retention. No claim of exact total browser heap cap.'},
    measuredUnitReceipts:receipts,streamingDelivery:{browser:smoke.result.streamingPublicationCount,immutable:smoke.result.immutableCallbacks,
      longFakePort:long.streamed,sinkFailureAndReentrancyTests:testCounts},
    testing:{vitest:{count:vitest.numTotalTests,passed:vitest.numPassedTests,failed:vitest.numFailedTests,byFile:testCounts},
      dspReferenceFixtureCount:28,dspReference:'Unchanged XC6 fixtures exercised by existing FIR parity unit test; not28extra Vitest tests.',
      typecheck:{command:'tsc --noEmit --incremental false',exitCode:checks.runs[1].exitCode},
      bundleCompile:await load(path.join(WORK,freezeId,'bundle_compile.json')),fullApplicationProductionBuild:'NOT_PERFORMED',
      browserSmoke:'ONE_BOUNDED_FAKE_MEDIA_PASS',longSimulation:'1800seconds source chronology, fake non-retaining inference port,0 ONNX'},
    browserSmoke:smoke,realDeviceProbe:'REAL_DEVICE_NOT_PERFORMED_NO_NEW_PERMISSION_REQUEST',productCapability:'MODEL_NOT_VALIDATED',
    productionMicrophone:false,productFinalizer:'STILL_PRODUCT_CRITICAL',r2:'R2_RESEARCH_POLICY_NOT_PRODUCTION_QUALIFIED',
    protections:oldXc6.scopeProtections,historicalReportsUnchanged:true,trackedChanges:changed,
    counters:{newExternalDatasetDownloads:0,newScientificBenchmarkRuns:0,newDecoderComparisons:0,newGeometrySweeps:0,newModelComparisons:0,
      newMidiTruthReads:0,realDevicePermissionRequests:0,browserModelRuns:smoke.result.actualSessionRunCount},
    limitations:['Disabled engineering resource qualification only, not accuracy/product/UX or real microphone qualification.',
      'Active noncancellable computation must finish before worker disposal; outputs are suppressed after failure.',
      'External consumers must not retain an entire session; their storage is outside runtime ownership.',
      'Finite diagnostic event count can still have a large worst-case JS footprint; no measured total browser heap ceiling is claimed.'],
    evidenceCommit:'Containing evidence-only commit; returned after push. GitHub receipt is appended prospectively after push.'};
  await newJson(path.join(REPORTS,`phase9g_xc7_bounded_resources_final_${freezeId}_2026-10-16.json`),report);
}else throw new Error('XC7_REPORT_COMMAND');
