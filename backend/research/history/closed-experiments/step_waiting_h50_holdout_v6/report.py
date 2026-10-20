"""Append-only evidence/receipt reporting; never acoustic qualification execution."""
import sys
from contracts import *
from protocol import github, unchanged, V5


def assessment():
    proof=require_protocol(); unchanged()
    primary=read(OUT/'primary-freeze-remote-proof.json')
    host=read(OUT/'primary-freeze-host-preflight.json'); container=read(OUT/'primary-freeze-container-preflight.json')
    if host['status']!='PASS' or container['status']!='PASS' or host['freezeSha256']!=primary['freezeSha256'] or container['freezeSha256']!=primary['freezeSha256']:
        raise ValueError('PRIMARY_DUAL_PREFLIGHT_REQUIRED')
    decoded=read(OUT/'decoded-audio.json'); inputs=read(OUT/'input-preservation.json')
    prehost=read(OUT/'portable-predecode-host-preflight.json'); precontainer=read(OUT/'portable-predecode-container-preflight.json')
    first=min(r['executionStartedAt'] for ident,r in decoded['sources'].items() if ident in SELECTED)
    if not proof['remoteVerifiedAt']<prehost['startedAt']<prehost['completedAt']<precontainer['startedAt']<precontainer['completedAt']<first:
        raise ValueError('FIRST_DECODE_TIME_ORDER_INVALID')
    value={'phase':'PRACTICE_STEP_H50_PORTABLE_PREDECODE_REPAIR_AND_PRIMARY_ACOUSTIC_FREEZE_DISABLED',
        'startingRemoteHead':START,'remoteHeadAtAssessment':primary['remoteHead'],
        'commitChainThroughPrimaryFreeze':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),
        'productionDiff':'','v3HistoricalDiff':'','v4HistoricalDiff':'','v5HistoricalDiff':'',
        'v5BlockedFreezeCommit':'986fa74e1f0aedbdd9b320843c8f41f27d6f506c',
        'v5BlockedFreezeSha256':'0f669a76c9b2661b2577300d641e195feeee33018081e510b58498b35f75b2fe',
        'v5BlockerClassification':'QUALIFICATION_TOOLING_FREEZE_PATH_NOT_PORTABLE_PRESERVED',
        'portablePathSchema':'REPO_RELATIVE_POSIX_V1','portablePredecodeFreezeCommit':proof['freezeCommit'],
        'portablePredecodeFreezeSha256':proof['freezeSha256'],'portableFreezeRemoteVerifiedAt':proof['remoteVerifiedAt'],
        'hostPreflight':prehost,'containerPreflight':precontainer,'firstSelectedAudioDecodeStartedAt':first,
        'selectedAudioObjects':read(OUT/'audio-acquisition.json')['objects'],'audioRedownloaded':False,
        'decoderDeterminism':{'status':'PASS','freshSelectedMp3Processes':12,'viennaWavProcesses':4,
            'environment':read(OUT/'decoder-environment.json'),'contractSha256':digest((HERE/'decoder-contract.json').read_bytes()),
            'fallback':False,'trialArtifacts':'decode-trials/'},
        'decodedAudio':decoded,'actualAudioContextValidation':read(OUT/'actual-audio-context.json'),
        'publisherSynchronizationContract':read(OUT/'publisher-sync-evidence.json'),'alignmentTransformSeconds':0,
        'exactByteExposureAudit':read(OUT/'exact-byte-exposure-audit.json'),
        'sourceRateTrials':read(OUT/'source-rate-trials.json'),
        'qualifiedAdapterIdentities':read(HERE/'input-preservation-contract.json')['identities'],
        'inputPreservation':{'totalCases':inputs['totalCases'],'totalRateJobs':inputs['totalRateJobs'],'mismatches':inputs['mismatches'],
            'modelInputHashManifest':'input-preservation.json','modelInputHashManifestSha256':digest((OUT/'input-preservation.json').read_bytes()),
            'modelInputHashes':[{k:r[k] for k in ('jobId','family','sourceRateHz','audioBoundCaseId','modelInputs','eventWindows')} for r in inputs['results']]},
        'scenarioCount':read(OUT/'scenario-manifest.json')['totalScenarios'],
        'scenarioManifestSha256':digest((OUT/'scenario-manifest.json').read_bytes()),
        'primaryQualificationFreezeCommit':primary['freezeCommit'],'primaryQualificationFreezeSha256':primary['freezeSha256'],
        'primaryFreezeRemoteVerifiedAt':primary['remoteVerifiedAt'],'primaryFreezeHostPreflight':host,'primaryFreezeContainerPreflight':container,
        'focusedTests':read(OUT/'focused-tests.json'),'nodeTests':read(OUT/'node-tests.json'),
        'preFreezeFailedTestAttempt':'pre-freeze-test-attempt-1/; 52/53 before explicit host-equivalent Git EOL environment. Preserved, not a qualification run.',
        'warnings':'Git emitted LF-to-CRLF warnings. No raw hash normalization or decoder fallback.',
        'HMs':50,'HQualification':'NOT_QUALIFIED','newNeuralRuns':0,'RobustSessionRuns':0,
        'ContinuousRegression':'NOT_STARTED','StageA':'NOT_STARTED','acousticSeal':'NOT_CREATED','StageB':'NOT_STARTED',
        'safetyCounters':'NOT_MEASURED','usabilityMetrics':'NOT_MEASURED','latencyMetrics':'NOT_MEASURED',
        'commercialQualification':'NOT_PERFORMED','commercialScope':'NONCOMMERCIAL_ENGINEERING_QUALIFICATION_SOURCE',
        'capabilities':{'Continuous':'MODEL_NOT_VALIDATED','STEP':'ATTEMPT_ANALYZER_NOT_VALIDATED','productionMicrophone':False,'D4':False},
        'disposition':'STEP_WAITING_H50_PRIMARY_ACOUSTIC_QUALIFICATION_FREEZE_ESTABLISHED_NEURAL_NOT_STARTED',
        'limitations':['Publisher zero-transform synchronization, not independently measured sample-perfect alignment.',
            'Offline PCM/DSP preservation does not establish browser READY timing, acoustic safety or usability.',
            'Scenario causal denominators require future actual STEP traces; no preparation-time PASS or 0/0 PASS.',
            'No Continuous historical PASS inherited. No real-device, commercial or UX SLO qualification.'],
        'nextAllowedPhase':['Independent audit and exact remote primary freeze verification','NEW Continuous engineering8/8 musical8/8 controller and semantic parity',
            'Audio-only Stage A real Worker/WebGPU exact Robust; immutable acoustic seal','Verify seal','Frozen truth/scenario Stage B real STEP causal trace',
            'No tuning','Independent audit','Only after acceptance: separate microphone integration phase']}
    save(OUT/'assessment.json',value)
    print({'disposition':value['disposition'],'jobs':inputs['totalRateJobs'],'mismatches':inputs['mismatches'],'firstSelectedAudioDecodeStartedAt':first})


def receipt():
    head=git('rev-parse','HEAD'); remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote: raise ValueError('RECEIPT_REMOTE_MISMATCH')
    value={'evidenceCommit':head,'remoteHead':remote,'completeCommitChain':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),'github':github(head)}
    save(OUT/'github-receipt.json',value); print(value['github'])


def final():
    unchanged(); head=git('rev-parse','HEAD'); remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or git('status','--porcelain'): raise ValueError('FINAL_INTEGRITY_FAILURE')
    value=read(OUT/'assessment.json')|{'finalHead':head,'endingRemoteHead':remote,'worktreeClean':True,
        'completeCommitChain':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),'github':github(head)}
    save(WORK/'final-report.json',value); print({'finalHead':head,'github':value['github']})


if __name__=='__main__': {'assessment':assessment,'receipt':receipt,'final':final}[sys.argv[1]]()
