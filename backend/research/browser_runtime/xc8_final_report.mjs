import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PHASE,START,WORK,REPORTS,LABEL,AUDIT,load,atomicJson,fileSha,digest,requireFrozen,git} from './xc8_protocol.mjs';

async function github(append){
  const commit=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s+/)[0];
  if(remote!==commit)throw new Error('XC8_PUSH_FIRST');
  const base='https://api.github.com/repos/tinghui0912/NoteVerse-Pro',requests=[];
  for(const [kind,url]of [['combined',`${base}/commits/${commit}/status`],['runs',`${base}/actions/runs?head_sha=${commit}&per_page=100`]]){
    const r=await fetch(url,{headers:{'User-Agent':'NoteVerse-XC8-evidence',Accept:'application/vnd.github+json'}});
    if(!r.ok)throw new Error('XC8_GITHUB_API:'+r.status);requests.push({kind,url,body:await r.json()});
  }
  const receipt={phase:PHASE,queriedCommit:commit,actualRemoteHead:remote,queriedAt:new Date().toISOString(),requests,
    combinedState:requests[0].body.state,statuses:requests[0].body.statuses,workflowRuns:requests[1].body.workflow_runs,
    interpretation:!requests[0].body.statuses.length&&!requests[1].body.workflow_runs.length?'NOT CI PASS':'Actual API evidence, not inferred.'};
  const p=append?`${REPORTS}/phase9g_xc8_github_post_push_2026-10-16.json`:`${WORK}/github_${commit}.json`;
  await atomicJson(p,receipt);console.log(JSON.stringify({commit,remote,combinedState:receipt.combinedState,statuses:receipt.statuses,workflowRuns:receipt.workflowRuns}));
}
async function final(){
  const {freeze,freezeCommit}=await requireFrozen(),summary=await load(`${WORK}/replay_summary.json`),causal=await load(AUDIT),cells=[];
  for(const row of summary.cells){
    if(await fileSha(row.path)!==row.sha256||await fileSha(row.auditPath)!==row.auditSha256)throw new Error('XC8_REPLAY_RESULT_CHANGED');
    const cell=await load(row.path);cells.push(cell);
    const destination=`${REPORTS}/phase9g_xc8_${row.split.toLowerCase()}_${row.configuration.toLowerCase()}_2026-10-16.json`;
    await atomicJson(destination,cell);row.committedMetrics={path:destination,sha256:await fileSha(destination)};
  }
  const auditsClean=cells.every(c=>Object.values(c.auditTotals).every(n=>n===0)),noNewCritical=cells.every(c=>!c.criticalIncreaseVsR2);
  const noNewEvaluationRegression=cells.filter(c=>c.split==='EVALUATION').every(c=>c.newRegressions.length===0);
  const repairs=cells.flatMap(c=>c.mechanismCases).filter(m=>m.candidateWaitedUntilClaimantsResolved
    &&m.candidateFinalOwner?.disposition==='WRONG'&&m.candidateFinalOwner.owner===m.groupId);
  const tests=spawnSync(process.execPath,['--test','backend/research/browser_runtime/test_xc8_finalizer.mjs'],{encoding:'utf8',maxBuffer:4e6});
  if(tests.status!==0)throw new Error('XC8_POST_REPLAY_MECHANISTIC_TEST_FAILED:'+tests.stdout+tests.stderr);
  const pass=auditsClean&&noNewCritical&&noNewEvaluationRegression&&repairs.length>0;
  const historicalChanges=git('diff','--diff-filter=DMRT','--name-only',START);
  if(historicalChanges)throw new Error('XC8_HISTORICAL_FILE_CHANGED:'+historicalChanges);
  const residualPath=`${REPORTS}/phase9g_xc2_r1_natural_residual_and_paired_latency_2026-10-16.json`,residual=await load(residualPath);
  const protection=await load(`${REPORTS}/phase9g_xc7_bounded_resources_final_v1_2026-10-16.json`);
  const report={phase:PHASE,classification:LABEL,startingHead:START,implementationCommit:freeze.implementationCommit,freezeCommit,
    evidenceCommit:'Containing evidence-only commit, returned after push; not self-referential.',
    postPushReceiptCommit:'Subsequent append-only GitHub receipt commit, returned after push.',
    disposition:pass?'XC8_BOUNDED_FINALIZER_CANDIDATE_READY_FOR_PRODUCT_INTEGRATION_QUALIFICATION':'XC8_NO_BOUNDED_FINALIZER_POLICY_READY',
    decisionInputs:{auditsClean,noNewCritical,noNewEvaluationRegression,confirmedReleasedEvidenceWrongAssignments:repairs.length},
    policy:freeze.policy,mathematicalHorizon:freeze.horizon,sourceHashes:freeze.sources,inputHashes:freeze.inputs,
    remoteFreezeProof:summary.proof,executionStartTimestamp:summary.executionStartTimestamp,
    causalInventory:{path:AUDIT,sha256:await fileSha(AUDIT),hypothesisSupport:causal.hypothesisSupport,
      focus:causal.cells.map(c=>({configuration:c.configuration,split:c.split,categoryCounts:c.categoryCounts,
        releasedBackgroundInstances:c.reservationResolutionInventory.length,reservedGroups:c.reservedGroups,
        newlyRegressedTargetMechanisms:c.inventory.filter(r=>r.newlyRegressedVsR1||r.newlyRegressedVsOriginal)}))},
    cells:summary.cells,metrics:cells.map(c=>({configuration:c.configuration,split:c.split,policyMetrics:c.policyMetrics,
      confusionMatrices:c.confusionMatrices,classConditionalDenominators:c.classConditionalDenominators,
      safetyCounters:c.safetyCounters,auditTotals:c.auditTotals,newRegressions:c.newRegressions,recoveredRegressions:c.recoveredRegressions,
      horizon:c.horizon,assignmentChangeCounts:c.assignmentChangeCounts,ownershipChangeCounts:c.ownershipChangeCounts,
      logicalTargetLatencyIncludingWrongClass:c.logicalTargetLatencyIncludingWrongClass})),
    naturalPhysicalResidual:{source:residualPath,sha256:await fileSha(residualPath),newAcousticEvaluation:false,
      interpretation:'Same frozen acoustic stream, counted once per physical clip in the existing R1 receipt. Scenario-expanded EXTRA targets are a separate constructed metric, not natural error prevalence.',
      rows:residual.rows.filter(r=>freeze.configurations.includes(r.id))},
    extraSingleOwnerConflict:'An observation legally consumed as WRONG or MATCHED is not also EXTRA. No observation is duplicated to improve synthetic recall.',
    tests:{preFreeze:freeze.preFreezeTests,postReplay:{command:'node --test backend/research/browser_runtime/test_xc8_finalizer.mjs',exitCode:tests.status,stdout:tests.stdout,stderr:tests.stderr}},
    historicalProof:{allPreexistingFilesUnchanged:!historicalChanges,productTreeUnchanged:git('rev-parse','HEAD:apps/customer-web')===freeze.unchangedProductGitTree,
      r2Disposition:'DIRECT_CONFLICT_RESERVATION_PARTIALLY_RECOVERS_SAFETY',r2ProductionQualification:'R2_RESEARCH_POLICY_NOT_PRODUCTION_QUALIFIED'},
    currentCapability:'MODEL_NOT_VALIDATED',productionMicrophone:false,productFinalizerFullyQualified:false,uiIntegration:false,
    xc4AcousticIdentitySha256:freeze.acousticCoreSha256,protections:protection.protections,
    counters:{newNeuralInference:0,newOnnxBrowserInference:0,newDataset:0,newAudioReads:0,newMidiFileReads:0,
      acousticRedecoding:0,newDecoderComparison:0,newGeometryComparison:0,modelChanges:0,productionIntegration:0},
    limitations:['Already exposed frozen XC2 data only; not fresh/blind/generalization evidence or a scientific winner.',
      'Known competing-WRONG and correct-owner counterfactual conflicts are not assumed to be reservation-release bugs.',
      'Logical finalization uses historical publication availability; no new device/runtime/UI/perceptual latency evidence.',
      'Bounded analysis frontiers do not bound wall-clock latency if acoustic publication stalls.',
      'No natural independent fixed-BPM human capture qualification, latency SLO or commercial qualification.'],
    commercialQualificationStatus:'NOT_PERFORMED',productLatencySlo:'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN',
    github:'Actual post-push GitHub receipt appended separately; empty statuses and workflow runs mean NOT CI PASS.'};
  await atomicJson(`${REPORTS}/phase9g_xc8_bounded_finalizer_final_2026-10-16.json`,report);
  console.log(JSON.stringify({disposition:report.disposition,decisionInputs:report.decisionInputs}));
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const command=process.argv[2];if(command==='final')await final();else if(command==='github')await github(process.argv.includes('--append'));else throw new Error('XC8_REPORT_COMMAND');
}
