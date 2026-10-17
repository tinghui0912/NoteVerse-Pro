"""Local-only paired replay preparation; execute in the pinned science Docker image."""
import hashlib
import io
import json
import math
import platform
import wave
import zipfile
from pathlib import Path
import numpy as np
import scipy
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'backend/data/work/product_completion_replay/v1'
REPORT = ROOT / 'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'
SHA = lambda b: hashlib.sha256(b).hexdigest()

def receipt_file(value):
    relative = Path(value.replace('\\', '/'))
    if relative.is_absolute() or ':' in str(relative) or '..' in relative.parts:
        raise ValueError('UNSAFE_RECEIPT_PATH')
    resolved = (ROOT / relative).resolve()
    if not resolved.is_relative_to(ROOT.resolve()): raise ValueError('UNSAFE_RECEIPT_PATH')
    return resolved

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf8') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')

def prepare():
    if scipy.__version__ != '1.14.1' or np.__version__ != '1.26.4':
        raise ValueError('REFERENCE_VERSION_DRIFT')
    prior = json.loads((ROOT / 'backend/research/reports/phase9g_xc2_clip_source_manifest_2026-10-15.json').read_text())
    takes = json.loads((ROOT / 'backend/research/reports/phase9g_xc1_r3d_full_take_manifest_f5_stream_2026-10-15.json').read_text())['takes']
    by_id = {t['takeId']: t for t in takes}
    archive_path = ROOT / 'backend/data/work/smd_v2/SMD-piano_v2.zip'
    rows, inventory = [], []
    with zipfile.ZipFile(archive_path) as archive:
        for take in takes:
            inventory.append({k: take[k] for k in ['takeId', 'acousticWavRelativePath', 'acousticWavSha256', 'midiRelativePath', 'midiSha256', 'audioDurationSeconds']})
        chosen = [c for c in prior['clips'] if c['split'] == 'DEVELOPMENT'][:3]
        for clip in chosen:
            take = by_id[clip['takeId']]
            data = archive.read(take['acousticWavRelativePath'])
            if SHA(data) != take['acousticWavSha256']: raise ValueError('WAV_DRIFT')
            with wave.open(io.BytesIO(data)) as wav:
                rate, channels, frames = wav.getframerate(), wav.getnchannels(), wav.getnframes()
                if wav.getsampwidth() != 2: raise ValueError('PCM16_REQUIRED')
                source = np.frombuffer(wav.readframes(frames), dtype='<i2').reshape(-1, channels)
            start = clip['sourceStartSeconds'] + 2
            # Exactly 1.8s real source pre-roll, 6s owned, 0.5s real context tail.
            left, right = round((start - 1.8) * rate), round((start + 6.5) * rate)
            mono = (source.astype(np.float32) / np.float32(32768)).astype(np.float64).mean(axis=1).astype(np.float32)
            extended = mono[left-rate:right+rate]
            pcms = {}
            for target in [44100, 48000]:
                common = math.gcd(rate, target)
                converted = resample_poly(extended, target//common, rate//common, window=('kaiser',5.0), padtype='constant').astype('<f4')
                converted = converted[target:target + round(8.3*target)]
                if len(converted) != round(8.3*target) or not np.isfinite(converted).all(): raise ValueError('PCM_INVALID')
                path = WORK / 'audio_only' / f'{clip["clipId"]}_{target}.f32'
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as f: f.write(converted.tobytes())
                pcms[str(target)] = {'path': str(path.relative_to(ROOT)), 'sha256': SHA(path.read_bytes()), 'bytes': path.stat().st_size, 'samples': len(converted)}
            rows.append({'id': clip['clipId'], 'takeId': take['takeId'], 'paired': True,
              'sourceWav': take['acousticWavRelativePath'], 'sourceWavSha256': SHA(data), 'audioDurationSeconds': frames/rate,
              'originalSampleRateHz': rate, 'channels': channels, 'startSeconds': start, 'durationMs': 6000,
              'prerollMs': 1800, 'tailMs': 500, 'pcm': pcms, 'midi': clip['physicalMidi']})
    save(REPORT, {'classification': 'PRODUCT_REPLAY_QUALIFICATION_NOT_REAL_DEVICE_EVIDENCE', 'priorExposedData': True,
      'selection': 'First three DEVELOPMENT rows in frozen XC2 clip manifest; start=old start+2 seconds; exactly 6s each; no output-based replacement.',
      'sourceArchive': str(archive_path.relative_to(ROOT)), 'source': 'SMD MIDI-Audio Piano Music Version 2',
      'provenanceReceipt': 'backend/research/reports/phase9g_xc1_smd_dataset_prerequisite_2026-10-14.json',
      'authoritativeUrl': 'https://www.audiolabs-erlangen.de/resources/MIR/SMD/midi', 'doi': '10.5281/zenodo.10847280',
      'licenseFromExistingReceipt': 'CC BY-NC-SA 3.0; research/development only; commercialQualification NOT_PERFORMED',
      'alignment': 'Publisher synchronized physical MIDI/acoustic pair; exact frozen filename/hash binding. No additional offset, no fit to model predictions. Gross onset-envelope sanity checked downstream, not used to shift truth.',
      'inventory': inventory, 'inventoryLimitations': 'SMD inventory from previously verified full-take manifest. MAESTRO/PianoVAM/Vienna and generated model MIDIs exist locally but are not substituted or read; generated transcription MIDI is not physical truth.',
      'clips': rows, 'syntheticControls': [{'id':'silence','durationMs':1800,'paired':False,'truth':'empty by construction'}],
      'sourceConversion': {'scipy': scipy.__version__, 'numpy': np.__version__, 'algorithm': 'resample_poly Kaiser5, rational conversion, 1s real guard each side, exact crop, float32 output', 'gainNormalization':False},
      'matching': {'samePitch':True,'windowMs':250,'objective':'max cardinality then min absolute time error then stable IDs'},
      'scenarioRecipe': 'Canonical groups anchored at earliest MIDI attack; include subsequent distinct pitches within 20ms only in test-side grouping (not product tolerance). Five separate copies of full expected score: unchanged; add absent pitch group at silent - guarded interval if available; transpose first guarded single semitone; add absent chord tone; omit first physical strike. No model-dependent choices. NOT_REACHED uses manual stop before expected target.',
      'midiContentReadsBeforeAcousticSeal':0, 'newDatasetDownloads':0, 'realPhysicalMicrophones':0})
    save(WORK / 'audio_only/manifest.json', {'clips': [{k:v for k,v in c.items() if k not in ['midi']} for c in rows]})

def truth(run_id):
    import pretty_midi
    work = ROOT / 'backend/data/work/product_completion_replay' / run_id
    manifest = json.loads(REPORT.read_text())
    seal = json.loads((work / 'acoustic_seal.json').read_text())
    for item in seal['files']:
        if SHA(receipt_file(item['path']).read_bytes()) != item['sha256']: raise ValueError('ACOUSTIC_SEAL_DRIFT')
    rows = []
    with zipfile.ZipFile(ROOT / manifest['sourceArchive']) as archive:
        for c in manifest['clips']:
            raw = archive.read(c['midi']['path'])
            if SHA(raw) != c['midi']['sha256']: raise ValueError('MIDI_DRIFT')
            midi = pretty_midi.PrettyMIDI(io.BytesIO(raw))
            all_notes = sorted([{'pitch':n.pitch,'timeMs':n.start*1000-c['startSeconds']*1000,'velocity':n.velocity,'endMs':n.end*1000-c['startSeconds']*1000}
              for instrument in midi.instruments if not instrument.is_drum for n in instrument.notes if n.velocity>0 and 21<=n.pitch<=108], key=lambda n:(n['timeMs'],n['pitch']))
            notes = [dict(n,id=f'{c["id"]}:truth:{i}') for i,n in enumerate(all_notes) if 0<=n['timeMs']<6000]
            # Source-only sanity: note attack vicinity versus acoustic positive energy change.
            pcm = np.fromfile(ROOT/c['pcm']['44100']['path'],dtype='<f4')
            envelopes = np.array([np.sqrt(np.mean(x.astype(np.float64)**2)) for x in np.array_split(pcm,830)])
            flux = np.maximum(0,np.diff(envelopes,prepend=envelopes[0]))
            peaks = [int(np.argmax(flux[max(0,round((n['timeMs']+1800)/10)-25):min(830,round((n['timeMs']+1800)/10)+26)]))+max(0,round((n['timeMs']+1800)/10)-25) for n in notes]
            lag_scores = []
            for lag in range(-100,101):
                indices = [round((n['timeMs']+1800)/10)+lag for n in notes]
                value = sum(float(np.max(flux[max(0,i-2):min(830,i+3)])) for i in indices if 2<=i<828)
                lag_scores.append((lag*10,value))
            best_lag,best_value = max(lag_scores,key=lambda p:(p[1],-abs(p[0]),-p[0]))
            zero_value = dict(lag_scores)[0]
            gross_warning = abs(best_lag)>250 and best_value>2*zero_value
            rows.append({'id':c['id'],'midiSha256':SHA(raw),'fullMidiNoteCount':len(all_notes),'notes':notes,
              'alignmentSanity': {'method':'source-only 10ms RMS positive-flux peak within +/-250ms of physical MIDI, no offset fitting',
                'grossOffsetScan': {'rangeMs':[-1000,1000],'stepMs':10,'bestDiagnosticLagMs':best_lag,'bestScore':best_value,'zeroScore':zero_value,
                  'warningRule':'abs(bestLag)>250 AND bestScore>2*zeroScore; flags truth scoring exclusion, never applies a time shift','warning':gross_warning},
                'nearestFluxOffsetsMs':[p*10-1800-n['timeMs'] for p,n in zip(peaks,notes)],
                'limitation':'Not proof of per-note physical onset precision in dense/pedalled passages; pairing relies on publisher synchronization, no correction applied'}})
    save(work/'truth.json',{'acousticSealSha256':SHA((work/'acoustic_seal.json').read_bytes()),'additionalAlignmentMs':0,'clips':rows})

if __name__ == '__main__':
    import sys
    if platform.system() != 'Linux' or not Path('/.dockerenv').exists(): raise RuntimeError('DOCKER_ONLY')
    prepare() if sys.argv[1]=='prepare' else truth(sys.argv[2])
