"""Local intake and metadata-only exposure projection. No MIDI event parsing."""
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import wave
import zipfile
from eligibility import primary_decision

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'backend/research/reports/step_waiting_h50_holdout_v3'
START = '4a2e2e15c266d4b3bd6f23006cefe59d8e16e313'
PHASE = 'PRACTICE_STEP_H50_PRIMARY_HOLDOUT_CORPUS_INTAKE_AND_PROSPECTIVE_FREEZE_DISABLED'
WORK = ROOT / 'backend/data/work'
RECEIPTS = []


def now():
    return datetime.now(timezone.utc).isoformat()


def relative(path):
    return Path(str(path).removeprefix('\\\\?\\')).relative_to(ROOT).as_posix()


def native(path):
    text = str(Path(path).absolute())
    return '\\\\?\\' + text if os.name == 'nt' and not text.startswith('\\\\?\\') else text


def digest(path):
    result = sha256()
    with open(native(path),'rb') as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def identity(path):
    return {'path':relative(path), 'sha256':digest(path), 'bytes':os.stat(native(path)).st_size}


def receipt(path):
    path = ROOT / path
    RECEIPTS.append(identity(path))
    return json.loads(path.read_text(encoding='utf-8'))


def save(name, value):
    OUT.mkdir(parents=True,exist_ok=True)
    with (OUT / name).open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(value,stream,indent=2,allow_nan=False)
        stream.write('\n')


def header(path):
    try:
        with wave.open(native(path),'rb') as source:
            return {'sampleRateHz':source.getframerate(), 'channels':source.getnchannels(),
                    'frames':source.getnframes(), 'durationSeconds':source.getnframes()/source.getframerate()}
    except (wave.Error, EOFError) as error:
        return {'headerStatus':'UNSUPPORTED_HEADER_NO_PCM_DECODE', 'errorKind':type(error).__name__}


def census():
    media, archives = [], []
    skipped = {'.git','node_modules','.next','.venv','venv','__pycache__','site-packages'}
    roots = [ROOT / 'backend/data/work', ROOT / 'backend/research/fixtures', ROOT / 'backend/tests/fixtures', ROOT / 'apps/customer-web/public']
    for root in roots:
        if not root.exists(): continue
        for parent, dirs, files in os.walk(native(root),followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in skipped and not (Path(parent)/d).is_symlink())
            for name in sorted(files):
                path = Path(parent)/name
                if path.is_symlink(): continue
                if path.suffix.lower() in {'.wav','.flac','.mp3','.m4a','.ogg','.mid','.midi'}:
                    media.append({'path':relative(path),'bytes':path.stat().st_size,'extension':path.suffix.lower()})
                elif path.suffix.lower() == '.zip':
                    row = {'path':relative(path),'bytes':path.stat().st_size}
                    try:
                        with zipfile.ZipFile(path) as archive:
                            names = archive.namelist()
                            row['audioMembers'] = [n for n in names if Path(n).suffix.lower() in {'.wav','.flac','.mp3'}]
                            row['midiMembers'] = [n for n in names if Path(n).suffix.lower() in {'.mid','.midi'}]
                    except zipfile.BadZipFile:
                        row['status'] = 'INVALID_ARCHIVE'
                    archives.append(row)
    return {'roots':[relative(r) for r in roots], 'outsideProjectRootsScanned':False,
            'privateAppStorageScanned':False, 'symlinksFollowed':False,
            'excludedDirectories':sorted(skipped), 'media':media,'archives':archives}


def main():
    started = now()
    files = census()
    records, ledger, aliases = [], [], []
    def event(audio, cls, path, basis):
        item = {'exposureClass':cls,'audioSha256':audio,'evidencePath':path,'basis':basis}
        if item not in ledger: ledger.append(item)
    def add(dataset, ident, audio, midi, pairing, license_info, pairing_evidence, history_complete=True):
        a, m = identity(audio), identity(midi)
        row = {'dataset':dataset,'recordingId':ident,'audio':{**a,**header(audio)},'midi':m,
               'pairingEstablished':pairing,'pairingEvidence':pairing_evidence,'usage':license_info,
               'lineageAudioSha256s':[], 'historyAuditComplete':history_complete}
        records.append(row)
        event(a['sha256'],'TRUTH_ONLY_INVENTORY',relative(Path(__file__)),'Current byte hash/header/source provenance inventory; not acoustic exposure.')
        return row

    # Dataset membership is not an exclusion. Only explicit source evidence below can exclude.
    registry = receipt('backend/research/reports/phase9g_d1r_corrected_local_public_dataset_inventory_2026-10-12.json')
    registry_datasets = {d['datasetId']:d for d in registry['datasets']}
    def usage(dataset):
        item = registry_datasets.get(dataset,{})
        evidence = item.get('knownLicenseEvidence',{})
        license_name = evidence.get('license','UNKNOWN') if isinstance(evidence,dict) else 'UNKNOWN'
        return {'license':license_name,
                'researchUse':'LOCAL_PUBLIC_RESEARCH_SOURCE' if license_name!='UNKNOWN' else 'UNKNOWN_LICENSE_RESEARCH_AUTHORIZATION_NOT_ESTABLISHED',
                'commercialUse':'NOT_QUALIFIED',
                'historicalResearchRole':item.get('currentlyAllowedResearchRole','NOT_LOCALLY_RECORDED'),
                'locallyRecordedProvenance':evidence,'licenseNetworkLookup':False}

    old = receipt('backend/research/reports/step_waiting_h50_holdout_v2/inventory.json')
    smd_archive = ROOT / old['archive']['path']
    if digest(smd_archive) != old['archive']['sha256']:
        raise ValueError('SMD_ARCHIVE_CHANGED_REQUIRES_NEW_MEMBER_HASH_INVENTORY')
    for source in old['localRecordings']:
        row = {'dataset':'smd-v2','recordingId':source['recordingId'],
            'audio':{'path':relative(smd_archive)+'!'+source['audioMember'],'sha256':source['audioSha256'],
                     'bytes':source['audioBytes'],**source['audio']},
            'midi':{'path':relative(smd_archive)+'!'+source['midiMember'],'sha256':source['midiSha256'],'bytes':source['midiBytes']},
            'pairingEstablished':True,'pairingEvidence':'Publisher synchronized performance pair; v2 exact member hashes revalidated through unchanged complete archive SHA256.',
            'usage':usage('smd'),'lineageAudioSha256s':[],'historyAuditComplete':True}
        records.append(row)
        for proof in source['priorActualExecution']:
            event(source['audioSha256'],'ACTUAL_ROBUST_EXECUTION',proof['receipt'],
                  'Completed F5 real Chrome Robust execution; positive actual InferenceSession.run count; source audio hash binding.')
        event(source['audioSha256'],'TRUTH_ONLY_INVENTORY',old['archive']['path'],'Inventory itself is non-blocking; actual F5 evidence is separate.')
        for representation in ['wav_22050_mono','wav_44100_mono']:
            aliases.append({'kind':'PUBLISHER_SOURCE_REPRESENTATION','sourceAudioSha256':source['audioSha256'],
                            'alias':relative(smd_archive)+'!'+representation+'/'+source['recordingId']+'.wav',
                            'independentPerformance':False,'evidence':'Same publisher recording ID in source representations; not a new recording.'})

    maestro = WORK / 'datasets/maestro-v3.0.0'
    with (maestro / 'maestro-v3.0.0.csv').open(newline='',encoding='utf-8') as stream:
        for row in csv.DictReader(stream):
            a,m = maestro/row['audio_filename'],maestro/row['midi_filename']
            if a.exists() and m.exists():
                add('maestro-v3.0.0',row['audio_filename'],a,m,True,usage('maestro-v3.0.0'),
                    'Official local CSV binds this performance audio/MIDI; downloader extracts official paired archive members. No candidate MIDI events parsed.')

    vienna = WORK / 'public_proxy/vienna-4x22'
    for audio in sorted((vienna/'audio-extracted/audio').rglob('*.wav')):
        midi = vienna/'vienna4x22-metadata/midi'/(audio.stem+'.mid')
        if not midi.exists(): continue
        matched = (vienna/'vienna4x22-metadata/match'/(audio.stem+'.match')).exists()
        add('vienna-4x22',audio.stem,audio,midi,matched,usage('vienna-4x22'),
            'Local README + CHANGES.md 07.03.24: performed MIDI and match files shifted to same audio origin; matching performance-specific stem and match file.' if matched
            else 'PAIRING_PROVENANCE_NOT_ESTABLISHED: special/average take has no corresponding publisher match file; setup_audio.py explicitly excludes these. Stem equality alone is insufficient.',
            history_complete=matched)

    piano = WORK / 'datasets/pianovam-v1.0'
    for audio in sorted((piano/'Audio').glob('*.wav')):
        midi = piano/'MIDI'/(audio.stem+'.mid')
        if midi.exists():
            add('pianovam-v1.0',audio.stem,audio,midi,False,usage('pianovam-v1.0'),
                'PAIRING_PROVENANCE_NOT_ESTABLISHED: download helper binds modality stems, but local publisher performance/alignment declaration not established.')

    # Only source identity/status metadata are projected from output-bearing artifacts.
    # Metric values, note lists, raw tensors and verdicts never enter the ledger or selector.
    for dataset in [maestro,piano]:
        for path in sorted(dataset.glob('*observer_report.json')):
            report = receipt(relative(path))
            meta = report.get('dataset',{})
            audio_hash = meta.get('audio_sha256')
            if audio_hash:
                event(audio_hash,'OUTPUT_BEARING_INSPECTION',relative(path),
                      'Acoustic observer generated/aggregated inspection report with exact dataset audio hash; only dataset identity read, not metrics/diagnostics.')

    # Old STEP neural reports bind derived cases back to the original performance bytes.
    # Only source_identity is projected; accepted/observed_groups/metrics are not read.
    old_step_reports = [maestro/'bytedance_rolling_step_events_dev_cal.json',
                        maestro/'production_step_frozen_evaluation_set/frozen_bytedance_policy_evaluation_report.json']
    for path in old_step_reports:
        report = receipt(relative(path))
        rows = report.get('evaluations',report.get('frontend',{}).get('evaluations',[]))
        for item in rows:
            audio_hash = item.get('source_identity',{}).get('source_audio_sha256')
            if audio_hash:
                event(audio_hash,'OUTPUT_BEARING_INSPECTION',relative(path),
                      'Historical neural STEP evaluation source_identity binds original audio to derived cases; output/verdict values not projected.')

    for path in sorted((ROOT/'backend/research/reports').glob('*raw_evidence_manifest*.json')):
        report = receipt(relative(path))
        for item in report.get('rows',[]):
            audio_hash = item.get('sourceAudioSha256')
            if audio_hash:
                event(audio_hash,'OUTPUT_BEARING_INSPECTION',relative(path),
                      'Historical raw neural execution manifest binds source audio bytes to input/output artifact hashes; no tensor values or quality metrics read.')
                source_path = item.get('sourceAudioPath','').replace('\\','/')
                for source in records:
                    if source['audio']['path'] == source_path and source['audio']['sha256'] != audio_hash:
                        source['lineageAudioSha256s'].append(audio_hash)
                        aliases.append({'kind':'HISTORICAL_SOURCE_PATH_LINEAGE','recordingId':source['recordingId'],
                            'currentAudioSha256':source['audio']['sha256'],'historicalAudioSha256':audio_hash,
                            'evidence':relative(path),'independentPerformance':False})

    fresh = receipt('backend/research/reports/fresh_strike_v2/development-manifest.json')
    for source in fresh['sources']:
        event(source['audioSha256'],'ACTUAL_ROBUST_EXECUTION','backend/research/reports/fresh_strike_v2/browser-seal.json',
              'Source identity from frozen development manifest; accepted real Worker/WebGPU development execution seal.')
        event(source['audioSha256'],'OUTPUT_DRIVEN_SELECTION_OR_TUNING','backend/research/reports/fresh_strike_v2/development-manifest.json',
              'Development source used in fresh-strike candidate selection, never primary independent qualification.')
    decoded = receipt('backend/research/reports/step_decoded_sufficiency_v1/inventory.json')
    for source in decoded['recordingReceipts']:
        event(source['audioSha256'],'OUTPUT_DRIVEN_SELECTION_OR_TUNING','backend/research/reports/step_attempt_assembly_v1/development.json',
              'Previously sealed decoded evidence used by H-window development; acoustic values not opened in this intake.')
    prior_topology = receipt('backend/research/reports/step_waiting_topology_v3/truth.json')
    for case in prior_topology['cases']:
        event(case['source']['audioSha256'],'PRIOR_PRODUCT_TOPOLOGY_DESIGN_EXPOSURE',
              'backend/research/reports/step_waiting_topology_v3/truth.json',
              'Previously used to design waiting topology scenarios, truth-only selection is not called acoustic execution.')

    for name in ['vienna_fixed_bpm_proxy_final_comparison_phase9fb3_2026-10-08.json',
                 'phase9g_a_vienna_calibration_current_baselines_2026-10-09.json']:
        report = receipt('backend/research/reports/'+name)
        for run in report.get('candidateRuns',{}).get('receipts',[]):
            audio_hash = run.get('audioSha256')
            if audio_hash:
                event(audio_hash,'OUTPUT_BEARING_INSPECTION','backend/research/reports/'+name,
                      'Actual per-source acoustic candidate run receipt included in comparison; only source hash/status identity projected, not scores.')
                scenario_parts = run.get('scenarioId','').split(':')
                if len(scenario_parts) >= 2:
                    for source in records:
                        if source['dataset'] == 'vienna-4x22' and source['recordingId'] == scenario_parts[1]:
                            event(source['audio']['sha256'],'OUTPUT_BEARING_INSPECTION','backend/research/reports/'+name,
                                  'Executed scenario explicitly binds this physical performance ID; clip/cache hash differences cannot create a new recording.')
    for name in ['phase9g_b3_official_product_blind_execution_receipt_2026-10-11.json',
                 'phase9g_b3_official_product_blind_replacement_execution_receipt_2026-10-11.json']:
        report = receipt('backend/research/reports/'+name)
        for run in report.get('evidenceRows',[]):
            audio_hash = run.get('sourceAudioSha256')
            if audio_hash:
                event(audio_hash,'OUTPUT_BEARING_INSPECTION','backend/research/reports/'+name,
                      'Historical source-hash-bound acoustic execution/product inspection evidence; not relabeled current ONNX execution without a session-run receipt.')
                scenario_parts = run.get('scenarioId','').split(':')
                if len(scenario_parts) >= 2:
                    for source in records:
                        if source['dataset'] == 'vienna-4x22' and source['recordingId'] == scenario_parts[1]:
                            event(source['audio']['sha256'],'OUTPUT_BEARING_INSPECTION','backend/research/reports/'+name,
                                  'Historical executed scenario binds physical performance ID; not bypassed through clip/resampling/hash wrappers.')

    # A raw cache referencing an otherwise unaccounted physical take cannot prove non-exposure.
    # Do not open its tensors or guess an ONNX execution count from the filename.
    for path in sorted((vienna/'runs').glob('*.raw.json')):
        for source in records:
            if source['dataset'] == 'vienna-4x22' and '_'+source['recordingId']+'_' in path.name:
                event(source['audio']['sha256'],'OUTPUT_BEARING_INSPECTION',relative(path),
                      'Existing take-specific raw acoustic cache is output-bearing association, not proof of current ONNX run count. Tensor content not opened.')

    # Previously selected truth is not actual execution. No blanket performer/dataset exclusion.
    for name in ['phase9g_a1_vienna_calibration_scenarios_2026-10-09.json',
                 'phase9g_b_blind_truth_only_scenarios_2026-10-09.json']:
        report = receipt('backend/research/reports/'+name)
        for item in report.get('scenarioReceipts',[]):
            if item.get('audioSha256'):
                event(item['audioSha256'],'TRUTH_ONLY_PRIOR_SELECTION','backend/research/reports/'+name,
                      'Historical truth-only scenario identity; not an execution event and not, by itself, a primary exclusion.')

    known_audio_paths = {r['audio']['path'] for r in records}
    midi_paths = [m['path'] for m in files['media'] if m['extension'] in {'.mid','.midi'}]
    by_stem = defaultdict(list)
    for midi_path in midi_paths:
        by_stem[Path(midi_path).stem].append(midi_path)
    unbound = []
    for media in files['media']:
        if media['extension'] not in {'.wav','.flac','.mp3','.m4a','.ogg'} or media['path'] in known_audio_paths: continue
        candidates = by_stem.get(Path(media['path']).stem,[])
        # Local files sharing a stem are possible aliases/derived pairs, never new truth by assumption.
        if candidates:
            audio = ROOT/media['path']
            a_hash = digest(audio)
            for candidate in candidates:
                unbound.append({'audioPath':media['path'],'audioSha256':a_hash,'midiPath':candidate,
                    'midiSha256':digest(ROOT/candidate),'status':'UNBOUND_OR_DERIVED_PAIR_NOT_PRIMARY',
                    'reason':'No authoritative same-performance lineage for this derived/fixture pair. Filename equality is not physical truth.'})

    by_hash = defaultdict(list)
    for row in records: by_hash[row['audio']['sha256']].append(row['audio']['path'])
    for row in unbound:
        if row['audioSha256'] in by_hash:
            aliases.append({'kind':'EXACT_AUDIO_BYTES_ALIAS','audioSha256':row['audioSha256'],
                            'sourcePaths':by_hash[row['audioSha256']],'alias':row['audioPath']})
    for audio_hash,paths in by_hash.items():
        if len(paths)>1:
            aliases.append({'kind':'EXACT_AUDIO_BYTES_DUPLICATE','audioSha256':audio_hash,'paths':paths})

    decisions = []
    for row in records:
        row['lineageAudioSha256s'] = sorted(set(row['lineageAudioSha256s']))
        facts = {'recordingId':row['recordingId'],'audioSha256':row['audio']['sha256'],'midiSha256':row['midi']['sha256'],
                 'lineageAudioSha256s':row['lineageAudioSha256s'],'pairingEstablished':row['pairingEstablished'],
                 'researchAuthorized':row['usage']['license']!='UNKNOWN','provenanceComplete':row['historyAuditComplete']}
        if not row['pairingEstablished'] or not row['historyAuditComplete']:
            event(row['audio']['sha256'],'UNKNOWN_PROVENANCE',relative(Path(__file__)),row['pairingEvidence'])
        decisions.append({**row,**primary_decision(facts,ledger)})
    eligible = [r['recordingId'] for r in decisions if r['primaryEligible']]
    production_diff = subprocess.check_output(['git','diff','--name-only',START,'--','apps/customer-web/src','apps/customer-web/public','backend/app'],cwd=ROOT,text=True).strip()
    if production_diff: raise ValueError('PRODUCTION_SOURCE_CHANGED')
    result = {'phase':PHASE,'startingRemoteHead':START,'startedAt':started,'completedAt':now(),
        'sourceInventoryVersion':3,'localCandidatePairCount':len(records),
        'localPairedSourceCount':sum(r['pairingEstablished'] for r in records),
        'datasetBreakdown':dict(Counter(r['dataset'] for r in records)),
        'exposureLedgerCounts':dict(Counter(cls for r in decisions for cls in r['exposureClasses'])),
        'ledgerCountsAreNonExclusive':True,'primaryEligibleRecordingCount':len(eligible),'primaryEligibleRecordingIds':eligible,
        'recordings':decisions,'metadataExposureEvents':ledger,
        'duplicateAliasCount':len({(a['kind'],a.get('alias') or a.get('recordingId',''),a.get('historicalAudioSha256','')) for a in aliases}),
        'duplicateAliasWitnessCount':len(aliases),'duplicateAliasEvidence':aliases,
        'unboundOrDerivedPairs':unbound,'census':files,'metadataReceiptIdentities':RECEIPTS,
        'candidateMidiEventsParsed':False,'audioPcmDecoded':False,'candidateAcousticOutputContentUsed':False,
        'newNeuralRuns':0,'invalidatedNeuralRuns':0,'productionDiff':production_diff,
        'nextAction':'FREEZE_TOPOLOGY_SELECTOR_CONTRACT_BEFORE_MIDI_EVENTS' if eligible else 'STOP_NO_PRIMARY_SOURCE',
        'disposition':None if eligible else 'STEP_WAITING_H50_PRIMARY_HOLDOUT_SOURCE_NOT_AVAILABLE'}
    save('source-inventory.json',result)
    print(json.dumps({k:result[k] for k in ['localCandidatePairCount','localPairedSourceCount','datasetBreakdown','primaryEligibleRecordingCount','primaryEligibleRecordingIds','disposition']}))


if __name__ == '__main__':
    main()
