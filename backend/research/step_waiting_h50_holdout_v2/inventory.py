"""Preflight source-exposure audit only. Never opens predictions, scores or PCM."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path, PurePosixPath
import json
import subprocess
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / 'backend/research/reports'
OUTPUT = REPORTS / 'step_waiting_h50_holdout_v2'
START = '2722e5b2a4dda1d412d37689b4974214f9621dcf'
PHASE = 'PRACTICE_STEP_WAITING_H50_HOLDOUT_TOPOLOGY_REPAIR_AND_PRODUCT_SAFETY_QUALIFICATION_DISABLED'
ARCHIVE = 'backend/data/work/smd_v2/SMD-piano_v2.zip'


def now():
    return datetime.now(timezone.utc).isoformat()


def digest_stream(stream):
    value = sha256()
    while chunk := stream.read(1024 * 1024):
        value.update(chunk)
    return value.hexdigest()


def file_identity(path):
    file = ROOT / path
    with file.open('rb') as stream:
        digest = digest_stream(stream)
    return {'path': path, 'bytes': file.stat().st_size, 'sha256': digest}


def read_receipt(relative, consumed):
    # Only the explicit metadata allowlist below is opened. No recursive report scanning.
    file = 'backend/research/reports/' + relative
    consumed.append(file_identity(file))
    return json.loads((ROOT / file).read_text(encoding='utf-8'))


def main():
    started = now()
    consumed = []
    manifest = read_receipt('phase9g_xc1_r3d_full_take_manifest_f5_2026-10-15.json', consumed)
    predictions = read_receipt('phase9g_xc1_r3d_f5_stream_primary_prediction_receipts_2026-10-15.json', consumed)
    completion = read_receipt('phase9g_xc1_r3d_f5_continuation_completion_receipt_2026-10-15.json', consumed)
    sources = read_receipt('fresh_strike_v2/dataset-audit.json', consumed)
    takes = {take['takeId']: take for take in manifest['takes']}
    exposure = {}

    def add(source, family, receipt, status, execution=None):
        ident = source['recordingId']
        row = exposure.setdefault(ident, {'recordingId':ident, 'audioSha256':source['audioSha256'],
                                         'midiSha256':source['midiSha256'], 'evidence':[]})
        if row['audioSha256'] != source['audioSha256'] or row['midiSha256'] != source['midiSha256']:
            raise ValueError('SOURCE_IDENTITY_CONFLICT:' + ident)
        row['evidence'].append({'family':family, 'receipt':receipt, 'exposureStatus':status,
                                **({'execution':execution} if execution else {})})

    # These are receipt metadata, not inference outputs or musical quality results.
    robust_rows = [r for r in predictions['rows'] if r['candidateId'] == 'robust-browser-v1']
    for row in robust_rows:
        if row['status'] != 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE' or row['actualInferenceSessionRunCount'] <= 0:
            raise ValueError('F5_EXECUTION_RECEIPT_NOT_COMPLETE')
        take = takes[row['takeId']]
        ident = PurePosixPath(take['acousticWavRelativePath']).stem
        add({'recordingId':ident, 'audioSha256':take['acousticWavSha256'], 'midiSha256':take['midiSha256']},
            'F5_REAL_BROWSER_ROBUST_ALL_TAKES', consumed[1]['path'], 'ACTUAL_ACOUSTIC_EXECUTION',
            {key:row[key] for key in ['takeId','candidateId','status','artifactPath','artifactSha256','actualInferenceSessionRunCount']})
    if len(robust_rows) != len(takes) or {r['takeId'] for r in robust_rows} != set(takes):
        raise ValueError('F5_TAKE_COVERAGE_MISMATCH')
    if completion['uniquePrimaryTakes'] != len(takes) or not completion['primarySealUnchanged']:
        raise ValueError('F5_CONTINUATION_RECEIPT_MISMATCH')

    continuous = read_receipt('product_completion_corpus_v1_2026-10-17.json', consumed)
    for clip in continuous['clips']:
        add({'recordingId':PurePosixPath(clip['sourceWav']).stem, 'audioSha256':clip['sourceWavSha256'],
             'midiSha256':clip['midi']['sha256']}, 'CONTINUOUS_PAIRED_REPLAY', consumed[-1]['path'], 'PRIOR_EXECUTED_CORPUS')
    decoded = read_receipt('step_decoded_sufficiency_v1/inventory.json', consumed)
    for source in decoded['recordingReceipts']:
        add(source, 'STEP_DECODED_SUFFICIENCY_AND_H_WINDOW_DEVELOPMENT', consumed[-1]['path'], 'PRIOR_EXECUTED_OR_SEALED_OUTPUT_REUSED')
    fresh = read_receipt('fresh_strike_v2/development-manifest.json', consumed)
    for source in fresh['sources']:
        add(source, 'FRESH_STRIKE_DEVELOPMENT', consumed[-1]['path'], 'PRIOR_EXECUTED_CORPUS')
    waiting = read_receipt('step_waiting_attempt_v2/truth.json', consumed)
    for case in waiting['cases']:
        add(case['source'], 'WAITING_ATTEMPT_V2', consumed[-1]['path'], 'PRIOR_EXECUTED_CORPUS')
    topology = read_receipt('step_waiting_topology_v3/truth.json', consumed)
    for case in topology['cases']:
        add(case['source'], 'TOPOLOGY_V3_AND_AFTER_CAPTURE_PREFLIGHT', consumed[-1]['path'], 'PREVIOUSLY_SELECTED_NOT_STAGE_A_EXECUTED')
    for source in sources['recordings']:
        if isinstance(source.get('historicalTriggerExposure'), list) and source['historicalTriggerExposure']:
            add(source, 'HISTORICAL_STEP_TRIGGER_RESEARCH', consumed[3]['path'], 'CONSERVATIVE_HISTORICAL_EXPOSURE')
    for row in exposure.values():
        row['evidence'] = list({json.dumps(e,sort_keys=True):e for e in row['evidence']}.values())

    index = {s['recordingId']:s for s in sources['recordings'] if s['dataset'] == 'smd-v2'}
    local = []
    with zipfile.ZipFile(ROOT / ARCHIVE) as archive:
        names = set(archive.namelist())
        audio_names = sorted(n for n in names if n.startswith('wav_44100_stereo/') and n.endswith('.wav'))
        for audio_name in audio_names:
            ident = PurePosixPath(audio_name).stem
            midi_name = 'midi/' + ident + '.mid'
            if midi_name not in names:
                raise ValueError('UNPAIRED_ARCHIVE_AUDIO:' + ident)
            source = index[ident]
            with archive.open(audio_name) as stream:
                audio_hash = digest_stream(stream)
            with archive.open(midi_name) as stream:
                midi_hash = digest_stream(stream)
            if audio_hash != source['audioSha256'] or midi_hash != source['midiSha256']:
                raise ValueError('LOCAL_MEMBER_HASH_CHANGED:' + ident)
            with archive.open(audio_name) as stream, wave.open(stream) as header:
                audio = {'rateHz':header.getframerate(), 'channels':header.getnchannels(), 'frames':header.getnframes(),
                         'durationSeconds':header.getnframes()/header.getframerate()}
            history = exposure.get(ident)
            actual = [e for e in history['evidence'] if e['exposureStatus'] == 'ACTUAL_ACOUSTIC_EXECUTION'] if history else []
            if history and (history['audioSha256'] != audio_hash or history['midiSha256'] != midi_hash):
                raise ValueError('EXPOSURE_HASH_JOIN_MISMATCH:' + ident)
            local.append({'recordingId':ident, 'audioMember':audio_name, 'audioBytes':archive.getinfo(audio_name).file_size,
                'audioSha256':audio_hash, 'midiMember':midi_name, 'midiBytes':archive.getinfo(midi_name).file_size,
                'midiSha256':midi_hash, 'audio':audio, 'priorActualExecution':actual,
                'primaryEligible':not bool(history),
                'exclusionReasons':['PRIOR_RECORDING_ACOUSTIC_EXECUTION','PRIOR_AUDIO_HASH_ACOUSTIC_EXECUTION','PRIOR_MIDI_HASH_BINDING'] if actual
                    else ['PRIOR_EXPOSURE_OR_SELECTION'] if history else []})
    if set(index) != {r['recordingId'] for r in local}:
        raise ValueError('CURRENT_LOCAL_SMD_INVENTORY_CHANGED')
    eligible = [r for r in local if r['primaryEligible']]
    if eligible:
        raise ValueError('UNUSED_SOURCE_FOUND_CONTINUE_PROSPECTIVE_MIDI_SELECTION_DO_NOT_REPORT_BLOCKED')
    production_diff = subprocess.check_output(['git','diff','--name-only',START,'--',
        'apps/customer-web/src','apps/customer-web/public','backend/app'],cwd=ROOT,text=True).strip()
    if production_diff:
        raise ValueError('PRODUCTION_SOURCE_CHANGED')
    OUTPUT.mkdir(parents=True,exist_ok=True)
    report = {'phase':PHASE, 'schemaVersion':'h50-holdout-topology-v2-preflight', 'startingHead':START,
        'disposition':'STEP_WAITING_H50_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED',
        'preflightExecution':{'startedAt':started,'completedAt':now(),'kind':'SOURCE_METADATA_AND_BYTE_IDENTITY_ONLY_NOT_QUALIFICATION'},
        'selectionAlgorithm':'Enumerate publisher-paired 44.1k stereo SMD archive members lexically. Exclude every prior-execution recording and matching audio/MIDI identity before reading candidate MIDI events. Pick no exposed substitute. If none remain, stop before pair selection.',
        'metadataOnly':True, 'candidateModelOutputsOpened':False, 'candidateScoresOpened':False,
        'audioPcmDecoded':False, 'candidateMidiEventsParsed':False, 'sourceMemberByteHashesRecomputed':True,
        'archive':file_identity(ARCHIVE), 'receiptIdentities':consumed,
        'localRecordings':local, 'priorExposureInventory':sorted(exposure.values(),key=lambda r:r['recordingId']),
        'counts':{'localSmdPairedRecordings':len(local),'actualRobustPreviouslyExecutedRecordings':sum(bool(r['priorActualExecution']) for r in local),
                  'unusedPrimaryRecordings':len(eligible),'selectedPrimaryOccurrences':0,'selectedSourceRateTrials':0},
        'primaryCorpusManifest':{'version':'v2','status':'NOT_CONSTRUCTIBLE_NO_UNUSED_SOURCE','selected':[],
                                'selectedRapidSinglePair':None,'selectedRepeatedChordPair':None},
        'repeatedChordBusyCoverage':'NOT_AVAILABLE_IN_UNUSED_LOCAL_HOLDOUT',
        'missingEvidenceContract':'At least one already-local paired SMD recording without prior acoustic model execution, containing a prospectively selected explicit same-single-pitch rapid pair and required post-READY/guard/scenario occurrences. Every local paired SMD recording already has sealed F5 real-browser Robust execution evidence.',
        'HMs':50,'HStatus':'CANDIDATE_NOT_QUALIFIED',
        'model':{'assetId':'practice-acoustic-robust-browser','version':'v1','bytes':98689283,
                 'sha256':'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
                 'ort':'1.20.1','provider':'webgpu','automaticFallback':False,'onset':.30,'frame':.05,
                 'ownedMs':600,'pastMs':1050,'futureMs':170},
        'sourceAdapters':{'44100':'32e39d991c47f5dbe1f13d2f77cf2a652d6a5da34cb5051ff43c0155b91edca5',
                          '48000':'6003b89c69965259baf9b329be6faec19128e6e5743be952c23069fb8673da17'},
        'qualification':{'freezeCommit':None,'freezeSha256':None,'stageA':'NOT_STARTED','acousticSeal':None,'stageB':'NOT_STARTED',
            'continuousRegression':'NOT_STARTED_PREFLIGHT_BLOCKED','fullStaticVerification':'NOT_STARTED_NO_QUALIFICATION_FREEZE',
            'actualModelRuns':0,'invalidatedModelRuns':0,'safetyCounters':None,'opportunityDenominators':0,
            'usabilityMetrics':None,'latencyDistributions':None},
        'productionDiff':production_diff, 'historicalReportsModified':False,'newDatasetDownloads':0,
        'capabilities':{'Continuous':'MODEL_NOT_VALIDATED','STEP':'ATTEMPT_ANALYZER_NOT_VALIDATED','productionMicrophone':False,'D4':False},
        'interpretation':'Missing unused primary source evidence, not an acoustic safety failure. Historical 28,396 Robust runs in the F5 receipts are exposure evidence only, not new runs or inherited PASS.'}
    with (OUTPUT / 'inventory.json').open('x',encoding='utf-8',newline='\n') as file:
        json.dump(report,file,indent=2,allow_nan=False)
        file.write('\n')
    print(json.dumps({'disposition':report['disposition'],**report['counts'],'actualNewModelRuns':0}))


if __name__ == '__main__':
    main()
