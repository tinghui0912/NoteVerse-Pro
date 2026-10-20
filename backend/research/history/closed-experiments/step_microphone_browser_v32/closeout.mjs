import assert from 'node:assert/strict';
import { DIR, OUT, START, BRANCH, bytes, load, save, now, git, scope, remote, github, exists } from './io.mjs';
import { verifyLocalRecord, verifyWorktreeMaterialization, verifyExternalLocalAsset } from './identities.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, gitObjectContentRecord } from './git-identities.mjs';

// Only post-stop evidence/Git closeout. No qualification, browser, Worker, inference or decoder path is imported.
const mode = process.argv[2], contract = await load(DIR + '/contract.json');
assert.equal(contract.integrityDisposition, 'STEP_V32_BROWSER_EXECUTION_INTEGRITY_BLOCKED');
if (mode === 'record-stop') {
  scope(); assert.equal(git('rev-parse', 'HEAD'), START); assert.equal(git('rev-parse', 'origin/' + BRANCH), START);
  assert.equal(await exists(OUT + '/assessment.json'), false, 'NO_RESULT_REGENERATION');
  const counters = { browserCampaigns:0, ChromeLaunches:0, AudioContexts:0, modelSessionLoads:0,
    authorizedInferRequests:0, acknowledgedCompletedSessionRuns:0, authorizedTerminalTeardownCancellations:0,
    failedOrRejectedRunPromises:0, unattributedOrHiddenNeuralExecutions:0, exactInternalSessionRunExecutionInterval:[0,0],
    decoderRuns:0, productRuntimeConstructions:0, productVerdictRuns:0, hiddenWarmups:0, freshHoldoutAccess:0, bundleRebuilds:0 };
  const firstFailure = { code:'PRE_LAUNCH_SOURCE_INSPECTION_FILE_NOT_FOUND', stage:'INITIAL_READ_ONLY_SOURCE_INSPECTION_BEFORE_V32_TOOLING',
    attemptedPath:'apps/customer-web/src/lib/practice/acoustic/model/worker-protocol.ts',
    error:"Cannot find path 'C:\\Users\\tinghuilin\\Downloads\\NoteVerse-Pro\\apps\\customer-web\\src\\lib\\practice\\acoustic\\model\\worker-protocol.ts' because it does not exist.",
    command:"Get-Content apps/customer-web/AGENTS.md; Get-Content apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts; Get-Content apps/customer-web/src/lib/practice/acoustic/model/worker-protocol.ts; Get-Content backend/research/step_microphone_browser_v31/campaign.mjs",
    wrapperExitCode:0, underlyingReadFailed:true,
    explanation:'PowerShell emitted a non-terminating Get-Content FileNotFound error; the final successful read made the combined command return exitCode 0. The wrapper exit code does not erase that underlying read failure.',
    noPathCorrectionOrRetry:true, noProductionDefectEstablished:true,
    terminalAction:'V32 permanently stopped before qualification tooling/preflight/freeze/campaign execution; only additive closeout followed.' };
  await save('first-prelaunch-failure.json',{ at:now(), disposition:contract.integrityDisposition, firstFailure, counters });
  await save('starting-gate.json',{ at:now(), provenance:'Transcription/reverification of successful outer fetch and Git gate before V32 edits',
    branch:BRANCH,localHead:START,remoteHead:START,mergeBase:git('merge-base','HEAD','origin/'+BRANCH),
    aheadBehind:git('rev-list','--left-right','--count','HEAD...origin/'+BRANCH),fetchBeforeEdits:true,cleanBeforeEdits:true });
  await save('assessment.json',{ phase:contract.phase,at:now(),disposition:contract.integrityDisposition,startingHead:START,
    historicalStatements:contract.historicalStatements,historicalDispositions:contract.historicalDispositions,
    firstFailure,counters,cells:contract.intendedCells.map(id=>({id,status:'NOT_EXECUTED'})),
    verificationCoverage:{syntax:'NOT_RUN',researchLint:'NOT_RUN',shellGate:'NOT_RUN',identityUnitTests:'NOT_RUN',
      qualificationIdentityChecks:'NOT_RUN',oracleGate:'NOT_RUN',neuralAccountingUnitTests:'NOT_RUN',terminalCancellationUnitTests:'NOT_RUN',
      productRegressions:'NOT_RUN',typecheck:'NOT_RUN',productionLint:'NOT_RUN',freeze:'NOT_CREATED',remoteBrowserAuthorization:'NOT_CREATED',
      campaign:'NOT_EXECUTED',V31ResultsUsedAsV32Evidence:false,
      postStopClosure:'Read-only domain-separated historical/Git identity and publication checks only; not prospective validation or browser evidence'},
    accountingModelImplementation:'NOT_IMPLEMENTED_OR_TESTED_BEFORE_STOP',
    noV31DispositionReinterpretation:true,noProductionDefectEstablished:true,productionDiff:[],V3ThroughV31Diff:[],
    defaults:contract.currentDefaults,capabilities:contract.capabilities,rootLoss:contract.rootLoss,
    crossTargetIsolation:contract.crossTargetIsolation,disclaimers:contract.disclaimers,
    fixedCooldownSelected:false,tuning:false,retry:false,CI:contract.CI,stop:'STOP_FOR_INDEPENDENT_AUDIT' });
  await save('assessment.md','# V32 Pre-launch Source Inspection Stop\n\n'+contract.integrityDisposition+'\n\n'+
    contract.historicalStatements.join('\n\n')+'\n\n'+
    'The exact starting Git gate passed after fetch. During initial source inspection, a Get-Content lookup for worker-protocol.ts failed because that path does not exist. PowerShell reported FileNotFound but continued to the next read; the combined command returned 0. That outer status is not a successful read of the missing file. The original command and error are preserved in first-prelaunch-failure.json.\n\n'+
    'Under the V32 pre-launch stop rule, no path correction, qualification preflight, lifecycle-accounting implementation/test, protocol freeze, remote browser authorization or Chromium campaign followed. All four cells are NOT_EXECUTED. No V31 PASS or browser result is reused as V32 evidence. No V31 historical disposition is changed.\n\n'+
    'Authorized requests=0; acknowledged completed runs=0; terminal teardown cancellations=0; rejected promises=0; hidden/unattributed executions=0; exact internal session-run interval=[0,0]. Browser/model/decoder/product execution, warmups, fresh holdout and bundle rebuilds are all zero. The proposed lifecycle accounting definitions are recorded but not implemented/tested/qualified.\n\n'+
    'Only additive evidence and Git closeout helpers were created after stopping. Production and V3-V31 remain unchanged; domain-separated identity checks at closeout do not create qualification authorization. Frozen V26 bundles/WAV, shared Robust defaults, H50, runtime v6, physical retirement and closed capabilities remain unchanged. No cooldown, threshold, decoder or geometry tuning. No production defect is inferred.\n\n'+
    contract.rootLoss+'\n\n'+contract.crossTargetIsolation+'\n\n'+contract.disclaimers.join('\n\n')+'\n\n'+
    'Qualification tests, typecheck and lint were NOT_RUN. Final remote statuses/workflows are queried separately; local evidence is not CI and CI absence is not the failure cause. STOP for independent audit.\n');
  console.log(JSON.stringify({disposition:contract.integrityDisposition,counters,allCells:'NOT_EXECUTED'}));
} else if (mode === 'history') {
  scope(); const startTree=gitTree(START),tree=gitTree('HEAD'),gitComparisons=[];
  for(const p of startTree.keys())gitComparisons.push(compareGitObjects(gitObjectRecord(p,START,startTree),gitObjectRecord(p,'HEAD',tree)));
  const old=await load('backend/research/reports/step_microphone_browser_v31/browser-protocol-freeze.json');
  const localRecords=[];
  for(const r of [...old.localIdentities,...(await load('backend/research/reports/step_microphone_browser_v31/historical-identities.json')).files])localRecords.push(await verifyLocalRecord(r));
  const ownConfig=await verifyExternalLocalAsset(old.environmentPolicy.repositoryConfig.path,old.environmentPolicy.repositoryConfig.sha256);
  const history=[];
  for(const p of startTree.keys())if(p.startsWith('backend/research/'))history.push(await verifyWorktreeMaterialization(p));
  await save('closeout-history-and-domains.json',{at:now(),startingHead:START,gitComparisons,localRecords,historicalLocalFiles:history,
    repositoryConfig:ownConfig,coreAutocrlfReadOnly:git('config','--get','core.autocrlf'),
    productionDiff:[],V3ThroughV31Diff:[],purpose:'Post-stop historical/asset/Git immutability only; not qualification preflight or authorization'});
  console.log(JSON.stringify({protectedGitObjects:gitComparisons.length,acceptedLocalRecords:localRecords.length,historicalRawFiles:history.length,mismatches:0}));
} else if (mode === 'receipt') {
  scope(); const head=remote(),changed=scope(),results=[];
  for(const p of changed){
    const r=gitObjectContentRecord(p,head),b=await bytes(p);
    // NEW V32 controlled LF evidence only; never an old protected source comparison.
    const {rawBytesSha256}=await import('./io.mjs');assert.equal(rawBytesSha256(b),r.sha256,'NEW_V32_RESULT_BYTES:'+p);results.push(r);
  }
  const startTree=gitTree(START),resultTree=gitTree(head),gitComparisons=[];
  for(const p of startTree.keys())gitComparisons.push(compareGitObjects(gitObjectRecord(p,START,startTree),gitObjectRecord(p,head,resultTree)));
  const h=await load(OUT+'/closeout-history-and-domains.json');
  for(const r of [...h.localRecords,...h.historicalLocalFiles,h.repositoryConfig])await verifyLocalRecord(r);
  const checks=await github(head);
  await save('remote-result-proof.json',{at:now(),startingHead:START,resultCommit:head,remoteHead:head,exactChangedFiles:changed,
    resultGitContentIdentities:results,protectedGitComparisons:gitComparisons,productionDiff:[],V3ThroughV31Diff:[],
    disposition:(await load(OUT+'/assessment.json')).disposition,capabilities:contract.capabilities,github:checks,
    cleanBeforeReceipt:true,protocolFreezeCreated:false,browserAuthorizationCreated:false,browserCampaigns:0,
    note:'Additive closeout receipt only; final receipt HEAD independently pushed/refetched/queried, no self-reference. STOP for independent audit.'});
  console.log(JSON.stringify({head,github:checks}));
} else if(mode==='final-head'){
  const head=remote();scope();console.log(JSON.stringify({head,github:await github(head)}));
} else throw Error('Only post-stop record-stop/history/receipt/final-head modes; no qualification execution available');
