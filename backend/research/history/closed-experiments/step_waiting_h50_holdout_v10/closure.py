"""Append-only closure and static design audit. Never imports a scoring/runtime executor."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'step_waiting_h50_holdout_v8'))
import protocol as audit
import json
import math
import os
import subprocess
from hashlib import sha256

ROOT=audit.ROOT
HERE=Path(__file__).resolve().parent
OUT=ROOT/'backend/research/reports/step_waiting_h50_holdout_v10'
START='598600c37e1bce2fb240056687fe71a61012bfe7'
V9='backend/research/reports/step_waiting_h50_holdout_v9/'
V8='backend/research/reports/step_waiting_h50_holdout_v8/'
V9_FREEZE='1b67d9e44d6a052bc785348192b812a84a60ab8c'
V9_SHA='28931c1efbd59f2edc9242c18bf40fd4736354201a60f078fc7cf792820d563c'
V9_EVIDENCE='f4c277e1f06695f8247122f011b6d6f35ff60516'
V9_DISPOSITION='STEP_WAITING_H50_PRIMARY_STAGE_B_QUALIFICATION_NOT_ESTABLISHED_CAUSAL_DENOMINATOR_MISSING'
DISPOSITION='STEP_H50_PRIMARY_QUALIFICATION_CLOSED_CURRENT_CANDIDATE_NOT_QUALIFIED_NEXT_CANDIDATE_AND_FRESH_HOLDOUT_DESIGN_READY'
ZERO={'newNeuralRuns':0,'RobustSessionRuns':0,'InferenceSessionRuns':0,'AcousticModelWorkerRuns':0,
      'StageAReruns':0,'StageBReruns':0,'ContinuousReruns':0,'selectedPcmDecoded':False}
CAPS={'Continuous':'MODEL_NOT_VALIDATED','STEP':'ATTEMPT_ANALYZER_NOT_VALIDATED','productionMicrophone':False,'D4':False}
PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app']+[f'backend/research/{p}step_waiting_h50_holdout_v{n}' for n in range(3,10) for p in ('','reports/')]
READS=[]


def digest_file(path):
    digest=sha256()
    with path.open('rb') as f:
        while chunk:=f.read(1024*1024):digest.update(chunk)
    return digest.hexdigest()


def read(path):
    audit.portable(path)
    if not path.endswith('.json') or path==audit.ACOUSTIC:raise PermissionError('V10_METADATA_ONLY_NO_ACOUSTIC_PAYLOAD_OR_AUDIO_DECODE')
    READS.append({'path':path,'sha256':digest_file(ROOT/path),'mode':'STATIC_JSON_METADATA_OR_IMMUTABLE_V9_TRACE'})
    return json.loads((ROOT/path).read_text(encoding='utf-8'))


def save(name,value):audit.save(OUT/name,value)
def own(name):return json.loads((OUT/name).read_text(encoding='utf-8'))


def unchanged():
    if audit.git('diff','--name-only',START,'--',*PROTECTED):raise ValueError('PRODUCTION_OR_V3_TO_V9_MUTATION')


def exact_git_file(commit,path):
    data=subprocess.check_output(['git','show',commit+':'+path],executable=audit.GIT_EXE,cwd=ROOT)
    if audit.digest(data)!=digest_file(ROOT/path):raise ValueError('IMMUTABLE_GIT_BYTES_MISMATCH:'+path)
    return {'path':path,'sha256':audit.digest(data),'commit':commit,'exactGitBytes':True}


def verify():
    unchanged();older=audit.identities()
    for path,expected in ((audit.ACOUSTIC,audit.ACOUSTIC_SHA),(audit.SEAL,audit.SEAL_SHA),
        (V8+'downstream-eligibility-seal.json','7256b87d1716cc4eab27e90e0b7746cff138d10acad281dc90ad574d43cc798c')):
        if digest_file(ROOT/path)!=expected:raise ValueError('UPSTREAM_SEAL_MISMATCH')
    exact_git_file('80574f39c6608503a478ee7d8488181ada891408',V8+'downstream-eligibility-seal.json')
    frozen=read(V9+'evaluation-protocol-freeze.json');full=dict(frozen);claimed=full.pop('freezeCanonicalSha256')
    if claimed!=V9_SHA or audit.digest(audit.canonical(full))!=V9_SHA:raise ValueError('V9_FREEZE_CANONICAL_MISMATCH')
    exact_git_file(V9_FREEZE,V9+'evaluation-protocol-freeze.json')
    for row in frozen['files']:
        audit.portable(row['path'])
        if digest_file(ROOT/row['path'])!=row['sha256']:raise ValueError('V9_BOUND_FILE_MISMATCH:'+row['path'])
    result=exact_git_file(V9_EVIDENCE,V9+'stage-b-results.json')
    paths=audit.git('ls-files','--',V9+'cells').splitlines()
    if len(paths)!=40:raise ValueError('V9_CELL_TRACE_COUNT_MISMATCH')
    cells=[exact_git_file(V9_EVIDENCE,p) for p in paths]
    for commit in (V9_FREEZE,V9_EVIDENCE,START):
        if audit.git('merge-base',commit,'HEAD')!=commit:raise ValueError('UPSTREAM_NOT_ANCESTOR')
    r=read(V9+'stage-b-results.json')
    if r['disposition']!=V9_DISPOSITION or r['empiricalCellsExpected']!=38 or r['actualValidEmpiricalCells']!=30:raise ValueError('V9_HISTORICAL_FACT_MISMATCH')
    if len(r['safetyCounters'])!=11 or any(v['dangerousCount']!=0 for v in r['safetyCounters'].values()):raise ValueError('V9_SAFETY_OBSERVATION_MISMATCH')
    if len(r['notEvaluableCells'])!=8 or len(r['functionalFailures'])!=6:raise ValueError('V9_INDEPENDENT_BLOCKER_MISMATCH')
    return {'verifiedAt':audit.now(),'olderIntegrity':older,'v9StageBFreezeIdentity':{'commit':V9_FREEZE,'canonicalSha256':V9_SHA,'boundFiles':len(frozen['files'])},
        'v9ResultIdentity':result,'v9CellIdentities':cells,'v9Disposition':V9_DISPOSITION,
        'acousticOutputSha256':audit.ACOUSTIC_SHA,'acousticSealSha256':audit.SEAL_SHA,
        'downstreamSealSha256':'7256b87d1716cc4eab27e90e0b7746cff138d10acad281dc90ad574d43cc798c','hashMismatches':0}


def setup():
    head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=START or remote!=START:raise ValueError('STARTING_GATE_MISMATCH')
    save('starting-gate.json',{'localHead':head,'remoteHead':remote,'mergeBase':audit.git('merge-base',head,remote),'ahead':0,'behind':0,
        'completeCommitChain':[],'productionDiff':[],'github':audit.github(head),'recordedAt':audit.now()})
    identities=verify();save('accepted-identities.json',identities)
    print({'startingRemoteHead':remote,'hashMismatches':0,'v9ResultSha256':identities['v9ResultIdentity']['sha256'],**ZERO})


def distribution(values):
    values=sorted(v for v in values if v is not None)
    return {'count':len(values),'p50':values[math.ceil(len(values)*.5)-1] if values else None,
        'p95':values[math.ceil(len(values)*.95)-1] if values else None,'max':max(values) if values else None}


def latency_row(cell,attempt):
    rate=cell['sourceRateHz'];timing=attempt['timing'];anchor=attempt['attempt']['anchor']
    physical=attempt['truthAttribution']['gesture']['onsetMs'] if attempt['truthAttribution'].get('gesture') else None
    if physical!=timing['physicalSourceMs']:raise ValueError('FROZEN_PHYSICAL_TIME_INCONSISTENCY')
    opened=attempt['openCaptureSource'];verdict=attempt['verdictCaptureSource']
    decoded_open=(opened-anchor)*1000/rate;decoded_verdict=(verdict-anchor)*1000/rate
    if decoded_open!=timing['sourceEventToAttemptOpenCaptureProgressMs'] or decoded_verdict!=timing['sourceEventToVerdictCaptureProgressMs']:
        raise ValueError('V9_LABEL_FORMULA_NOT_CONFIRMED')
    return {'scenarioId':cell['scenarioId'],'sourceRateHz':rate,'jobId':cell['jobId'],'audioBoundCaseId':cell['audioBoundCaseId'],
        'attemptId':attempt['record']['attemptId'],'actualValidCausalDenominator':cell['actualValidCausalDenominator'],
        'truthGestureId':attempt['truthAttribution'].get('gesture',{}).get('gestureId') if physical is not None else None,
        'physicalTruthSourceMs':physical,'decodedEventSourceSample':anchor,'decodedEventSourceMs':anchor*1000/rate,
        'attemptOpenCaptureSourceSample':opened,'verdictCaptureSourceSample':verdict,
        'physicalTruthToAttemptOpenCaptureProgressMs':None if physical is None else opened*1000/rate-physical,
        'physicalTruthToVerdictCaptureProgressMs':None if physical is None else verdict*1000/rate-physical,
        'decodedEventToAttemptOpenCaptureProgressMs':decoded_open,'decodedEventToVerdictCaptureProgressMs':decoded_verdict,
        'interpretation':'NOT_PHYSICAL_DEVICE_UX_LATENCY','noCrossClockAlignment':True}


def diagnostics(cells):
    rows=[latency_row(c,a) for c in cells for a in c['attempts']]
    metrics=['physicalTruthToAttemptOpenCaptureProgressMs','physicalTruthToVerdictCaptureProgressMs',
        'decodedEventToAttemptOpenCaptureProgressMs','decodedEventToVerdictCaptureProgressMs']
    summaries=[]
    for rate in (44100,48000):
        for scope in ('ALL_STORED_ATTEMPTS_INCLUDING_NOT_EVALUABLE','VALID_CAUSAL_TRIAL_ATTEMPTS_ONLY'):
            chosen=[r for r in rows if r['sourceRateHz']==rate and (scope.startswith('ALL') or r['actualValidCausalDenominator']==1)]
            summaries.append({'sourceRateHz':rate,'scope':scope,'metrics':{m:distribution(r[m] for r in chosen) for m in metrics}})
    return {'source':'IMMUTABLE_V9_CELL_TRACES_ONLY_ARITHMETIC_NOT_RESCORING','rows':rows,'summaries':summaries,
        'interpretation':'NOT_PHYSICAL_DEVICE_UX_LATENCY','publicationAvailabilityVsSourceTime':'NOT_COMPARABLE_ACROSS_CLOCK_DOMAINS',**ZERO}


def mechanisms(cells):
    chord=[];repeat=[];busy=[];late=[]
    for c in cells:
        ident={'cell':f"{c['scenarioId']}-{c['sourceRateHz']}",'sourceRateHz':c['sourceRateHz'],'jobId':c['jobId'],'audioBoundCaseId':c['audioBoundCaseId']}
        if c['scenarioId']=='correct_chord':
            a=c['attempts'][0];observations=a['attempt']['observations'];truth=c['physicalTruthPitchSets'][0]
            true=[o['confidence'] for o in observations if o['midiPitch'] in truth]
            false=[o['confidence'] for o in observations if o['midiPitch'] not in truth]
            if truth!=[56,64] or sorted(o['pitch'] for o in observations)!=['E3','E4','G#3','G#4'] or not max(false)>min(true):raise ValueError('CHORD_MECHANISM_WITNESS_MISMATCH')
            chord.append(ident|{'truth':truth,'target':c['targetPitchSets'][0],'verdict':a['record']['verdict'],'observations':observations,
                'classification':'SIMPLE_HIGHER_CONFIDENCE_FILTER_NOT_SUPPORTED','reason':'A cutoff retaining low-confidence true G#3 would also retain higher-confidence false octave events; no threshold selected or tested.'})
        if c['scenarioId']=='post_ready_repeat':
            if c['targetPitchSets']!=[[46,58],[46,58]]:raise ValueError('LEGITIMATE_OCTAVE_CHORD_CHANGED')
            repeat.append(ident|{'truth':c['physicalTruthPitchSets'],'targets':c['targetPitchSets'],
                'attempts':[{'attemptId':a['record']['attemptId'],'truthGesture':a['truthAttribution']['gesture']['gestureId'],
                    'verdict':a['record']['verdict'],'observations':a['attempt']['observations']} for a in c['attempts']],
                'classification':'SIMPLE_GLOBAL_OCTAVE_COLLAPSE_NOT_SUPPORTED','reason':'The legitimate target contains both A#2 and A#3; D5/D3 errors have high confidence and are not repaired by deleting octave identity.'})
        if c['scenarioId'] in ('single_busy_retrigger','chord_busy_retrigger','busy_period_physical_input'):
            physical=c['physicalCaptureStates'];opened=c['attempts'][0]['timing']['attemptOpenMs']
            if physical[1]['state']!='READY' or not physical[1]['physicalSourceMs']<opened:raise ValueError('BUSY_MECHANISM_WITNESS_MISMATCH')
            busy.append(ident|{'physical':physical,'gapMs':physical[1]['physicalSourceMs']-physical[0]['physicalSourceMs'],
                'firstAttemptOpenCaptureProgressMs':opened,'firstVerdict':c['attempts'][0]['record']['verdict'],
                'classification':'RAPID_PHYSICAL_PAIR_NOT_CAUSALLY_BUSY_UNDER_CURRENT_ACOUSTIC_PUBLICATION_GEOMETRY',
                'recognitionMissIsNotEstablishedCause':True,'actualValidCausalDenominator':c['actualValidCausalDenominator']})
        if c['scenarioId']=='late_publication':
            delayed=[d for d in c['publicationDeliveryTrace'] if d['late']]
            if len(delayed)!=1 or delayed[0]['deliveredCapturedThrough']!=c['attempts'][0]['openCaptureSource']:raise ValueError('LATE_MECHANISM_WITNESS_MISMATCH')
            late.append(ident|{'delayedWindow':c['latePublicationWindowIndex'],'delayedReceipt':delayed[0],
                'physical':c['physicalCaptureStates'],'firstAttemptOpenCaptureSource':c['attempts'][0]['openCaptureSource'],
                'classification':'DELAYED_OPENING_PUBLICATION_CANNOT_ESTABLISH_RETIRED_LATE_DENOMINATOR',
                'actualValidCausalDenominator':c['actualValidCausalDenominator'],'storedReasons':c['notEvaluableReasons']})
    return {'source':'IMMUTABLE_V9_TRACES_NO_EVALUATOR_EXECUTION','correctChord':chord,'postReadyRepeat':repeat,'busy':busy,'late':late,
        'HWidthRootCauseEstablished':False,'HMs':50,'HRetuned':False,'HRequalified':False,
        'reason':'Extra decoded pitch contamination and unavailable causal busy/late topology are distinct. Neither establishes H50 width as the root cause.',**ZERO}


def build():
    identities=verify();r=read(V9+'stage-b-results.json')
    cells=[read(row['path']) for row in identities['v9CellIdentities']]
    expected_missing={(s,rate) for s in ('single_busy_retrigger','chord_busy_retrigger','busy_period_physical_input','late_publication') for rate in (44100,48000)}
    expected_functional={(s,rate) for s in ('correct_chord','post_ready_repeat','match_followed_by_next_target') for rate in (44100,48000)}
    if {(c['scenarioId'],c['sourceRateHz']) for c in cells if c['classification']=='NOT_EVALUABLE'}!=expected_missing:raise ValueError('CAUSAL_BLOCKER_FACTS_CHANGED')
    if {(c['scenarioId'],c['sourceRateHz']) for c in cells if c['classification']=='FUNCTIONAL_RECOGNITION_FAILURE'}!=expected_functional:raise ValueError('FUNCTIONAL_BLOCKER_FACTS_CHANGED')
    closure={'primaryQualificationStatus':'NOT_QUALIFIED','currentRobustH50Qualification':'NOT_QUALIFIED','historicalV9Disposition':r['disposition'],
        'blockingReasons':['CAUSAL_SAFETY_COVERAGE_NOT_ESTABLISHED','FUNCTIONAL_RECOGNITION_BLOCKED_ON_VALID_CAUSAL_TRIALS'],
        'causalCoverage':{'classification':'CAUSAL_SAFETY_COVERAGE_NOT_ESTABLISHED','empiricalCellsExpected':38,'actualValid':30,
            'busyPeriodCarryoverAdvanceDenominator':r['safetyCounters']['busyPeriodCarryoverAdvance']['validCausalDenominator'],
            'latePublicationCarryoverAdvanceDenominator':r['safetyCounters']['latePublicationCarryoverAdvance']['validCausalDenominator'],
            'notEvaluableCells':r['notEvaluableCells'],'observedSafetyFailure':False,'safetyPass':False},
        'functionalRecognition':{'classification':'FUNCTIONAL_RECOGNITION_BLOCKED_ON_VALID_CAUSAL_TRIALS','failures':r['functionalFailures']},
        'coverageCannotHideFunctionalBlocker':'Even if future busy/late coverage were filled, the current candidate could not PASS because existing valid functional failures remain.',
        'safetyObservation':{'wording':'11 dangerous counts observed = 0; evidence on currently valid causal trials only. Busy/late denominators are zero, NOT_EVALUABLE, never PASS.',
            'storedCounters':r['safetyCounters'],'globalSafetyQualification':'NOT_ESTABLISHED'},
        'HMs':50,'HStatus':'HISTORICAL_CANDIDATE_NOT_RETUNED_NOT_REQUALIFIED','onsetThreshold':.30,'frameThreshold':.05,
        'microphoneIntegration':'NOT_AUTHORIZED','capabilities':CAPS,**ZERO}
    save('primary-qualification-closure.json',closure)
    diag=diagnostics(cells);save('corrected-source-domain-diagnostics.json',diag)
    erratum={'classification':'NON_GATING_REPORT_LABEL_ERROR','v9Modified':False,
        'scope':'Per-attempt timing.sourceEventTo... fields in immutable v9 cell traces. Do not relabel already physical-based top-level sourceReplayLatency as decoded-based.',
        'fields':{'sourceEventToAttemptOpenCaptureProgressMs':'Actually (openCaptureSource-attempt.anchor)*1000/rate: decoded acoustic event, not physical truth onset.',
            'sourceEventToVerdictCaptureProgressMs':'Actually (verdictCaptureSource-attempt.anchor)*1000/rate: decoded acoustic event, not physical truth onset.'},
        'correctedDiagnostics':'corrected-source-domain-diagnostics.json','doesNotAffect':['attempt assembly','product verdict','truth attribution','denominator','safety counters','functional classifications','v9 disposition'],
        'aggregateNuance':'v9 sourceReplayLatency aggregates already subtract timing.physicalSourceMs. The original per-attempt and aggregate same-named fields used different anchors.',
        'interpretation':'NOT_PHYSICAL_DEVICE_UX_LATENCY','crossPerformanceNowAlignmentCreated':False,'attemptRows':len(diag['rows']),**ZERO}
    save('v9-latency-reporting-erratum.json',erratum)
    exposure={'status':'EXPOSED_DEVELOPMENT_ONLY_FOR_ANY_FUTURE_CHANGED_CANDIDATE','effectiveAt':audit.now(),
        'reason':'Acoustic publications/pitches/confidences and Stage B outcomes have been inspected. Historical blind claims remain historical, never retroactively invalidated.',
        'phaseTrees':[{'phase':f'v{n}','path':path,'gitTreeAtClosureStart':audit.git('rev-parse',START+':'+path)} for n in range(3,10) for path in (f'backend/research/step_waiting_h50_holdout_v{n}',f'backend/research/reports/step_waiting_h50_holdout_v{n}')],
        'appliesToChanges':['new model','new decoder','new postprocessor','new threshold','new assembly','new verdict semantics','new H'],
        'futureRole':'EXPOSED DEVELOPMENT / DIAGNOSTIC CORPUS','allowedFutureUses':['failure reproduction','candidate debugging','engineering comparison'],
        'requiredResultLabel':'DEVELOPMENT_ONLY_NOT_QUALIFICATION','prohibitedFutureClaims':['fresh primary holdout','independent qualification holdout'],
        'futureFreshCorpus':'Must exclude these exposed sources/byte identities; build full recording/hash/history provenance and separately freeze candidate-unexecuted new sources.',**ZERO}
    save('exposure-transition.json',exposure);save('failure-mechanism-inventory.json',mechanisms(cells))
    inventory=inventory_candidates();save('existing-acoustic-candidate-inventory.json',inventory)
    for name in ('next-candidate-requirements.json','fresh-holdout-design.json'):
        value=json.loads((HERE/name).read_text());save(name,value)
    sources=[{'path':row['path'],'sha256':row['sha256']} for row in READS]
    save('closure-read-ledger.json',{'reads':sources,'operation':'STATIC_METADATA_AND_TRACE_ARITHMETIC_ONLY_NO_SCORER_PRODUCT_OR_ACOUSTIC_EXECUTION',**ZERO})
    save('closure-manifest.json',{'role':'PRIMARY_QUALIFICATION_CLOSURE_AND_NEXT_CANDIDATE_DESIGN_NO_EXECUTION','createdAt':audit.now(),
        'upstream':identities,'files':[{'path':audit.local(p),'sha256':digest_file(p)} for p in sorted(list(OUT.glob('*.json'))+[p for p in HERE.iterdir() if p.suffix in ('.py','.json')])],
        'disposition':DISPOSITION,'capabilities':CAPS,**ZERO})
    print({'disposition':DISPOSITION,'correctedAttemptRows':len(diag['rows']),'candidateInventoryEntries':len(inventory['candidates']),**ZERO})


def receipt():
    verify();head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote:raise ValueError('REMOTE_CLOSURE_HEAD_MISMATCH')
    manifest=own('closure-manifest.json')
    for row in manifest['files']:
        if digest_file(ROOT/row['path'])!=row['sha256']:raise ValueError('CLOSURE_ARTIFACT_CHANGED')
        exact_git_file(head,row['path'])
    value={'phase':'PRACTICE_STEP_H50_PRIMARY_QUALIFICATION_CLOSURE_AND_NEXT_CANDIDATE_DESIGN_NO_EXECUTION','startingRemoteHead':START,
        'endingRemoteHead':head,'remoteVerifiedAt':audit.now(),'completeCommitChain':audit.git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),
        'productionDiff':[],'v3-v9Diffs':{f'v{n}':[] for n in range(3,10)},'upstreamIdentities':own('accepted-identities.json'),
        'qualificationClosure':own('primary-qualification-closure.json'),'latencyErratum':own('v9-latency-reporting-erratum.json'),
        'correctedSourceDomainDiagnosticsFile':'corrected-source-domain-diagnostics.json','exposureTransition':own('exposure-transition.json'),
        'failureMechanismInventoryFile':'failure-mechanism-inventory.json','existingAcousticCandidateInventoryFile':'existing-acoustic-candidate-inventory.json',
        'nextCandidateRequirementsFile':'next-candidate-requirements.json','freshHoldoutDesignFile':'fresh-holdout-design.json',
        'disposition':DISPOSITION,'nextAllowedPhase':'STOP_FOR_INDEPENDENT_AUDIT_SEPARATE_AUTHORIZATION_REQUIRED_FOR_CANDIDATE_DEVELOPMENT_NOT_MICROPHONE_INTEGRATION',
        'tests':own('tests.json'),'capabilities':CAPS,'github':audit.github(head),'commercialQualification':'NOT_PERFORMED',**ZERO}
    save('github-closure-receipt.json',value);print({'head':head,'github':value['github'],'disposition':DISPOSITION})


def final():
    verify();head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or audit.git('status','--porcelain'):raise ValueError('FINAL_REMOTE_OR_WORKTREE_MISMATCH')
    value=own('github-closure-receipt.json')|{'endingRemoteHead':head,'github':audit.github(head),'finalVerifiedAt':audit.now(),
        'completeCommitChain':audit.git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines()}
    audit.save(ROOT/'backend/data/work/step_waiting_h50_holdout_v10/final-report.json',value)
    print({'head':head,'disposition':DISPOSITION,'github':value['github']})


# Candidate metadata generation is defined below; no candidate Python/JS code is imported.
def inventory_candidates():
    base='backend/research/reports/'
    registry_path=base+'phase9g_a32_final_candidate_registry_2026-10-10.json'
    roles_path=base+'phase9g_d3_browser_candidate_role_registry_2026-10-13.json'
    f5_path=base+'phase9g_xc1_r3d_f5_full_scientific_result_2026-10-15.json'
    runtime_path=base+'phase9g_xc1_r3d_f5_continuation_runtime_report_2026-10-15.json'
    xc4_path=base+'phase9g_xc4_engineering_default_final_2026-10-16.json'
    tie_path=base+'phase9g_dr3_complete_grouped_browser_runtime_and_close_online_amt_2026-10-13.json'
    registry=read(registry_path)['candidates'];roles=read(roles_path)['candidates'];f5=read(f5_path);runtime=read(runtime_path);xc4=read(xc4_path)
    tie=read(tie_path)['historicalPhase9gBConclusion']
    if tie['outcome']!='STATISTICAL_TIE' or f5['scientificDisposition']!='NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER':raise ValueError('HISTORICAL_SCIENCE_STATE_DRIFT')
    assets=[]
    for root in (ROOT/'models',ROOT/'backend/data/work'):
        for directory,dirs,files in os.walk(root):
            dirs[:]=[d for d in dirs if d not in ('.git','node_modules','venv','.venv','huggingface')]
            for name in sorted(files):
                if name.endswith('.onnx'):
                    p=Path(directory)/name
                    assets.append({'path':audit.local(p),'bytes':p.stat().st_size,'sha256':digest_file(p),'operation':'RAW_FILE_HASH_ONLY_NOT_MODEL_LOAD'})
    def evidence(path,pointer):return {'path':path,'sha256':digest_file(ROOT/path),'pointer':pointer}
    def checkpoint(path,expected):
        p=ROOT/path
        if not p.exists():return {'path':path,'present':False,'recordedSha256':expected,'rawHashVerified':False}
        actual=digest_file(p)
        return {'path':path,'present':True,'bytes':p.stat().st_size,'recordedSha256':expected,'actualSha256':actual,
            'rawHashVerified':actual==expected,'disposition':'EXACT_RECORDED_BYTES' if actual==expected else 'DIFFERENT_LOCAL_ASSET_NOT_PROMOTED'}
    specs={
      'bytedance-original':('models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth',
        'PyTorch research; fixed 29120-sample ONNX Chrome/Edge ORT1.20.1 WebGPU feasibility documented; historical 5s calibration is a different profile.',
        {'sampleRateHz':16000,'fixedInputSamples':29120,'outputShape':[1,183,88],'heads':['reg_onset_output','frame_output'],'historicalCalibrationContext':'5s'},
        'HISTORICAL_RESEARCH_ONLY_NOT_A_NEW_SELECTION'),
      'bytedance-robust-augmented':('models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
        'Current pinned ORT Web1.20.1/WebGPU browser engineering default, no automatic fallback, graph optimization disabled.',
        {'sampleRateHz':16000,'inputSamples':29120,'outputShape':[1,183,88],'ownedMs':600,'pastMs':1050,'futureMs':170,'onset':.30,'frame':.05},
        'CURRENT_DISABLED_ENGINEERING_DEFAULT_BUT_ROBUST_H50_EXACT_SET_STEP_NOT_QUALIFIED'),
      'online-amt':('backend/data/work/online_amt/model-180000.pt',
        'Native active-hop K1 had historical backlog blockers; later grouped K8 ORT1.30.0/WebGPU executed in XC1. Historical K8/K1 two-graph/fallback topology is not automatically admissible to a new no-fallback single-owner candidate.',
        {'sampleRateHz':16000,'hopSamples':512,'hopMs':32,'groupHops':8,'groupMs':256,'io':'Stateful PCM/acoustic/language recurrent tensors; exact graph I/O manifests require re-audit before any new use.'},
        'INACTIVE_SCIENTIFIC_AND_ENGINEERING_REFERENCE_NO_CURRENT_STEP_QUALIFICATION'),
      'transkun':('models/checkpointMSimplerAug/checkpoint.pt','Historical PyTorch whole-recording offline reference; browser/WebGPU qualification not established in inspected evidence.',
        {'io':'Historical upstream whole-recording piano audio -> transcription; no pinned browser ONNX window interface established here.'},'INACTIVE_OFFLINE_RESEARCH_REFERENCE_ONLY'),
      'aria-amt':('models/aria-amt/piano-medium-double-1.0.safetensors','Historical PyTorch/whole-recording offline reference; browser/WebGPU qualification not established in inspected evidence.',
        {'io':'Historical whole-recording piano audio -> symbolic transcription; no pinned browser ONNX interface established here.'},'INACTIVE_LICENSE_AND_OFFLINE_LATENCY_LIMITED_REFERENCE'),
      'rtt':('backend/data/work/rtt_research/rtt/ckpts/CustomAMT.ckpt','Historical offline segmentwise research; strict causal browser/WebGPU runtime not established. RTT onset/ByteDance handoff stopped for sequential safety.',
        {'sampleRateHz':16000,'io':'Historical full-case/segmentwise model execution, not a qualified streaming product interface.'},'INACTIVE_HANDOFF_STOPPED_NO_DETECTOR_REOPENING'),
      'd3rm':(None,'Historical execution blocked reference; no qualified local browser/WebGPU execution established.',
        {'io':'NOT_ESTABLISHED_IN_INSPECTED_LOCAL_EVIDENCE'},'INACTIVE_EXECUTION_BLOCKED')}
    candidates=[]
    for item in registry:
        family=item['candidateFamily'];local,runtime_desc,geometry,engineering=specs[family]
        recorded=item.get('checkpointSha256');checks=checkpoint(local,recorded) if local else None
        relevant=[a for a in assets if (family.startswith('bytedance') and ('robust' in a['path'] if 'robust' in family else 'bytedance_note_model' in a['path'])) or (family=='online-amt' and 'online_amt' in a['path'])]
        f5_key={'bytedance-robust-augmented':'robust-browser-v1','online-amt':'online-amt-k8-browser-v1'}.get(family)
        f5_metadata=f5['candidateIdentities'][f5_key]['deploymentIdentityContent'] if f5_key else None
        candidates.append({'identity':item['candidateId'],'sourceProvenance':[evidence(registry_path,'/candidates/'+str(registry.index(item)))],
            'modelSha256IfPresent':recorded,'checkpoint':checks,'onnxAssetPaths':[a['path'] for a in relevant],
            'runtime':runtime_desc,'inputOutputGeometry':geometry,'browserWebGPUFeasibility':'HISTORICAL_STATIC_EVIDENCE_ONLY_NOT_REEXECUTED',
            'knownScientificDisposition':{'comparisonState':'STATISTICAL_TIE / NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER','automaticWinnerPromotion':False},
            'knownEngineeringDisposition':engineering,'historicalRegistryQualification':item['qualificationStatus'],
            'licenseCommercialLimitation':{'historicalRepositoryClassification':item['licenseClassification'],'source':evidence(registry_path,'/candidates'),
                'commercialQualification':'NOT_PERFORMED','interpretation':'Historical repository classification only, not a new legal approval; dataset rights and primary-role authorization remain separate.'},
            'active':family=='bytedance-robust-augmented','activeMeaning':'Shared disabled engineering foundation only; not an enabled STEP microphone candidate.',
            'historicalF5DeploymentMetadata':f5_metadata,
            'historicalF5RuntimeEligible':runtime['candidates'][f5_key]['runtimeEligible'] if f5_key else None})
    basic=f5['candidateIdentities']['basic-pitch-browser-v1']['deploymentIdentityContent']
    pkg_path='backend/data/work/basic_pitch_browser_feasibility/node_modules/@spotify/basic-pitch/package.json'
    pkg=read(pkg_path)
    basic_assets=[]
    for name,expected in [('model.json',basic['modelJsonSha256']),('group1-shard1of1.bin',basic['weightsSha256'])]:
        p=ROOT/'backend/data/work/basic_pitch_browser_feasibility/node_modules/@spotify/basic-pitch/model'/name
        basic_assets.append({'path':audit.local(p),'sha256':digest_file(p),'expectedSha256':expected,'rawHashVerified':digest_file(p)==expected})
    candidates.append({'identity':'basic-pitch-browser-v1','sourceProvenance':[evidence(f5_path,'/candidateIdentities/basic-pitch-browser-v1'),evidence(pkg_path,'/')],
        'modelSha256IfPresent':basic['weightsSha256'],'assets':basic_assets,'runtime':'@spotify/basic-pitch1.0.1 / TensorFlow.js3.21.0 / WebGL',
        'inputOutputGeometry':{'researchInputSampleRateHz':16000,'modelSampleRateHz':22050,'io':'TFJS model model.json and immutable weights; onset/frame/contour to official note decoder.'},
        'browserWebGPUFeasibility':'Historical real browser WebGL execution exists; WebGPU qualification NOT_ESTABLISHED, not inferred from WebGL.',
        'knownScientificDisposition':'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER; no automatic promotion',
        'knownEngineeringDisposition':'INACTIVE_BROWSER_REFERENCE; historical F5 runtimeEligible='+str(runtime['candidates']['basic-pitch-browser-v1']['runtimeEligible']),
        'licenseCommercialLimitation':{'packageLicense':pkg.get('license'),'commercialQualification':'NOT_PERFORMED','datasetLicensesSeparate':True},'active':False})
    decoder_path='backend/research/browser_runtime/xc2_decoders.mjs'
    decoders=[]
    for ident,status,desc,active in [('A','CURRENT_HISTORICAL_DEFAULT','Contiguous onset region first-maximum, frame support, absolute-pitch all-note evidence.',True),
        ('B','RESEARCH_CHALLENGER_NOT_DEFAULT','Pinned upstream-style score-blind onset regression interpolation.',False),
        ('C','NO_DEMONSTRATED_ENGINEERING_ADVANTAGE','Historical same-pitch consensus of A/B, not a second selected analyzer.',False)]:
        decoders.append({'identity':'Robust decoder '+ident,'sourceProvenance':[evidence(decoder_path,'decodeXc2'),evidence(xc4_path,'/defaults')],
            'modelSha256IfPresent':'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
            'runtime':'Historical JS decoder; source inspection only, not imported or executed','inputOutputGeometry':'Frozen raw onset/frame tensors -> absolute source-domain observations',
            'browserWebGPUFeasibility':'Uses existing model runtime; no new execution','knownScientificDisposition':'NO_NEW_SCIENCE_NO_WINNER',
            'knownEngineeringDisposition':status,'description':desc,'licenseCommercialLimitation':'Upstream/code/model/dataset licenses require separate review; commercial qualification NOT_PERFORMED',
            'active':active,'onset':.30,'frame':.05,'retuned':False})
    return {'scope':'Local paired research/model/decoder/ONNX inventory only; excludes unrelated OCR/LLM assets and dependency ONNX test fixtures. No new sources or downloads.',
        'candidates':candidates,'decoderVariants':decoders,'onnxAssetIndex':sorted(assets,key=lambda a:a['path']),
        'robustGeometryVariants':{'current':'600 owned / 1050 past / 170 future, 29120 samples',
            'historicalXc1':'600 owned / 1000 past / 220 future; historical, not substituted into current runtime',
            'unpromotedChallenger':xc4['defaults']['BAND_LIMITED_A_600_120'],'currentResampler':xc4['defaults']['CURRENT_ENGINEERING_RESAMPLER_DEFAULT'],
            'linearControl':xc4['defaults']['LINEAR'],'source':evidence(xc4_path,'/defaults')},
        'historicalCandidateRoles':{'recordedRows':roles,'source':evidence(roles_path,'/candidates'),
            'interpretation':'D3 roles are historical; subsequent XC1/XC4 evidence and v9 closure are separately recorded, not overwritten.'},
        'scientificState':{'phase9gB':tie,'xc1F5':f5['scientificDisposition'],'sources':[evidence(tie_path,'/historicalPhase9gBConclusion'),evidence(f5_path,'/scientificDisposition')]},
        'newCandidateChosen':False,'winnerSelected':False,'nextCandidateClassification':'PRODUCT_ENGINEERING_CANDIDATE',
        'commercialQualification':'NOT_PERFORMED','staticOnly':True,**ZERO}


if __name__=='__main__':{'setup':setup,'verify':verify,'build':build,'receipt':receipt,'final':final}[sys.argv[1]]()
