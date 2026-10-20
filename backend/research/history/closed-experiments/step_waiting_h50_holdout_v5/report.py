"""Append-only preparation evidence and actual GitHub receipts, no qualification."""
import sys
from contracts import *
from protocol import github


def assessment():
    proof=require_protocol(); selected=read(OUT/'selected-truth-and-sources.json')
    acquisition=read(OUT/'audio-acquisition.json'); decoded=read(OUT/'decoded-audio.json')
    inputs=read(OUT/'input-preservation.json'); primary=read(OUT/'primary-freeze-remote-proof.json')
    if git('diff','--name-only',START,'HEAD','--',*PROTECTED): raise ValueError('PROTECTED_SOURCE_CHANGED')
    value={'phase':'PRACTICE_STEP_H50_SELECTED_AUDIO_ACQUISITION_INPUT_PRESERVATION_AND_PRIMARY_FREEZE_DISABLED',
        'startingRemoteHead':START,'remoteHeadAtAssessment':primary['remoteHead'],
        'commitChainThroughPrimaryFreeze':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),
        'productionDiff':'','v3HistoricalDiff':'','v4HistoricalDiff':'',
        'v4TruthTopologySealSha256':selected['v4TruthTopologySealSha256'],
        'audioAcquisitionProtocolFreezeCommit':proof['freezeCommit'],'audioAcquisitionProtocolFreezeSha256':proof['freezeSha256'],
        'remoteVerifiedBeforeAudioDownloadAt':proof['remoteVerifiedAt'],
        'audioDownloadStartedAt':acquisition['executionStartedAt'],
        'publisherSyncEvidence':read(OUT/'publisher-sync-evidence.json'),
        'selectedBatikAudioCount':4,'selectedBatikAudioObjects':acquisition['objects'],
        'decoder':{'container':IMAGE,'implementation':'python-soundfile/libsndfile','versions':read(OUT/'decoder-environment.json'),
            'protocolSha256':digest((HERE/'decoder-contract.json').read_bytes()),'deterministicTrials':12,'alternateDecoderUsed':False},
        'decodedAudio':decoded['sources'],'alignmentTransformSeconds':0,
        'actualAudioContextValidation':read(OUT/'actual-audio-context.json'),
        'historicalExactByteExposureCheck':{'artifact':'exact-byte-exposure-audit.json',
            'eligible':read(OUT/'exact-byte-exposure-audit.json')['eligible'],
            'scope':'Reachable Git objects, current project reports/work metadata, known receipts/manifests and pre-existing MP3 byte aliases. Frozen v4 truth-only references are not acoustic exposure.'},
        'sourceRateTrials':read(OUT/'source-rate-trials.json'),
        'qualifiedAdapterIdentities':read(HERE/'input-preservation-contract.json')['identities'],
        'inputPreservation':{'totalCases':inputs['totalCases'],'totalRateJobs':inputs['totalRateJobs'],
            'mismatches':inputs['mismatches'],'modelInputHashManifest':'input-preservation.json',
            'modelInputHashManifestSha256':digest((OUT/'input-preservation.json').read_bytes()),
            'modelInputHashes':[{k:r[k] for k in ('jobId','family','sourceRateHz','audioBoundCaseId','modelInputs','eventWindows')} for r in inputs['results']]},
        'scenarioManifestSha256':digest((OUT/'scenario-manifest.json').read_bytes()),
        'primaryQualificationFreezeCommit':primary['freezeCommit'],'primaryQualificationFreezeSha256':primary['freezeSha256'],
        'primaryFreezeRemoteVerifiedAt':primary['remoteVerifiedAt'],
        'newNeuralRuns':0,'RobustSessionRuns':0,'ContinuousRegression':'NOT_STARTED','StageA':'NOT_STARTED',
        'acousticSeal':'NOT_CREATED','StageB':'NOT_STARTED','safetyCounters':'NOT_MEASURED',
        'usabilityMetrics':'NOT_MEASURED','latencyMetrics':'NOT_MEASURED','commercialQualification':'NOT_PERFORMED',
        'commercialScope':'NONCOMMERCIAL_ENGINEERING_QUALIFICATION_SOURCE_NOT_COMMERCIAL_CORPUS_APPROVAL',
        'capabilities':{'Continuous':'MODEL_NOT_VALIDATED','STEP':'ATTEMPT_ANALYZER_NOT_VALIDATED','productionMicrophone':False,'D4':False},
        'focusedTests':read(OUT/'focused-tests.json'),'nodeTests':read(OUT/'node-tests.json'),
        'disposition':'STEP_WAITING_H50_PRIMARY_ACOUSTIC_QUALIFICATION_FREEZE_ESTABLISHED_NEURAL_NOT_STARTED',
        'limitations':['Publisher zero-transform contract, not independently measured sample-perfect synchronization.',
            'Codec/runtime is part of PCM identity. Decoder processing time is not source-time shift or device latency.',
            'Source context and exact DSP parity do not establish real browser READY availability, acoustic safety, UX, hardware or commercial qualification.',
            'No model/Worker/WebGPU execution or previous Continuous PASS inherited.'],
        'nextAllowedPhase':['Verify exact remote primary freeze again','NEW Continuous engineering8/8 musical8/8 production-controller and exact parity',
            'Stage A audio-only real Worker/WebGPU exact Robust, immutable acoustic seal','Verify seal','Stage B frozen truth/scenarios with real STEP causal product trace and frozen scorer',
            'No tuning','Independent audit','Only after acceptance: separate microphone controller integration phase']}
    save(OUT/'assessment.json',value)
    print({'disposition':value['disposition'],'inputRateJobs':inputs['totalRateJobs'],'mismatches':inputs['mismatches']})


def receipt():
    head=git('rev-parse','HEAD'); remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote: raise ValueError('REMOTE_RECEIPT_MISMATCH')
    save(OUT/'github-receipt.json',{'evidenceCommit':head,'remoteHead':remote,'startingRemoteHead':START,
        'completeCommitChain':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),'github':github(head)})
    print(read(OUT/'github-receipt.json')['github'])


def final():
    head=git('rev-parse','HEAD'); remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or git('status','--porcelain') or git('diff','--name-only',START,'HEAD','--',*PROTECTED): raise ValueError('FINAL_INTEGRITY_FAILED')
    value=read(OUT/'assessment.json')|{'endingRemoteHead':remote,'finalHead':head,
        'completeCommitChain':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),
        'github':github(head),'worktreeClean':True}
    save(WORK/'final-report.json',value)
    print({'finalHead':head,'github':value['github'],'finalReport':str((WORK/'final-report.json').relative_to(ROOT))})


if __name__=='__main__': {'assessment':assessment,'receipt':receipt,'final':final}[sys.argv[1]]()
