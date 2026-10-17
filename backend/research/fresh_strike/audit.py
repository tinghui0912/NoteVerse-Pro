"""Dataset/history audit only. Run in Docker; no inference or PCM feature scoring."""
from __future__ import annotations
import csv
import hashlib
import io
import json
from pathlib import Path
import wave
import zipfile
from collections import Counter
import mido

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'backend/data/work/fresh_strike/v1'
START = 'c8de147f819cf5bd971de581192b096ef7b6abb4'

def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def midi_summary(data):
    midi = mido.MidiFile(file=io.BytesIO(data))
    clock = 0.0
    notes = []
    controls = Counter()
    for message in midi:
        clock += message.time
        if message.type == 'note_on' and message.velocity > 0:
            notes.append((clock, message.note, message.velocity))
        if message.type == 'control_change': controls[message.control] += 1
    return {'noteOnCount': len(notes), 'midiEndSeconds': clock,
            'controls': dict(controls), 'sustainCc64Count': controls[64],
            'lastNoteOnSeconds': notes[-1][0] if notes else None}

def wav_summary(stream):
    with wave.open(stream, 'rb') as w:
        return {'rate': w.getframerate(), 'channels': w.getnchannels(),
                'frames': w.getnframes(), 'durationSeconds': w.getnframes()/w.getframerate()}

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf8') as f:
        json.dump(value, f, indent=2, allow_nan=False); f.write('\n')

def main():
    maestro = ROOT / 'backend/data/work/datasets/maestro-v3.0.0'
    rows = []
    manifests = []
    exposures = {}
    for folder in ['production_step_causal_cases','production_step_causal_cases_multi_source',
                   'production_step_development_set','production_step_calibration_set','production_step_frozen_evaluation_set']:
        path = maestro / folder / 'public_step_causal_cases_manifest.json'
        if not path.exists(): continue
        value = json.loads(path.read_text())
        sources = value.get('sources', [])
        if not sources and 'source' in value: sources = [value['source']]
        manifests.append({'path': str(path.relative_to(ROOT)), 'sha256':digest_file(path),
                          'role':'EXPOSED_FROZEN_NOT_FRESH' if 'frozen' in folder else 'DEVELOPMENT_ONLY',
                          'sourceCount':len(sources), 'sourceFields':sorted(sources[0]) if sources else []})
        for source in sources:
            name = source.get('audio_filename') or source.get('source_audio_filename')
            if name: exposures.setdefault(name, []).append(folder)
    with (maestro/'maestro-v3.0.0.csv').open(newline='',encoding='utf8') as f:
        for meta in csv.DictReader(f):
            a, m = maestro/meta['audio_filename'], maestro/meta['midi_filename']
            if not a.exists() or not m.exists(): continue
            with a.open('rb') as stream: audio = wav_summary(stream)
            rows.append({'dataset':'maestro-v3.0.0', 'recordingId':meta['audio_filename'],
                'audioPath':str(a.relative_to(ROOT)), 'midiPath':str(m.relative_to(ROOT)),
                'audioSha256':digest_file(a),'midiSha256':digest_file(m), 'audioBytes':a.stat().st_size,
                'audio':audio,'midi':midi_summary(m.read_bytes()),'historicalTriggerExposure':exposures.get(meta['audio_filename'],[]),
                'pairing':'official CSV path binding; local byte identity, not proof of full publisher media',
                'publishedDurationSeconds':float(meta['duration'])})
    piano = ROOT/'backend/data/work/datasets/pianovam-v1.0'
    for a in (piano/'Audio').glob('*.wav'):
        m = piano/'MIDI'/(a.stem+'.mid')
        if not m.exists(): continue
        with a.open('rb') as stream: audio = wav_summary(stream)
        rows.append({'dataset':'pianovam-v1.0','recordingId':a.stem,'audioPath':str(a.relative_to(ROOT)),
            'midiPath':str(m.relative_to(ROOT)),'audioSha256':digest_file(a),'midiSha256':digest_file(m),
            'audioBytes':a.stat().st_size,'audio':audio,'midi':midi_summary(m.read_bytes()),
            'historicalTriggerExposure':'REQUIRES_HISTORY_AUDIT','pairing':'exact stem only; needs publisher/recording identity evidence'})
    archive_path = ROOT/'backend/data/work/smd_v2/SMD-piano_v2.zip'
    if archive_path.exists():
        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())
            for name in sorted(names):
                if not name.startswith('wav_44100_stereo/') or not name.lower().endswith('.wav'): continue
                midi_name = 'midi/'+Path(name).stem+'.mid'
                if midi_name not in names: continue
                with archive.open(name) as stream: audio = wav_summary(stream)
                h = hashlib.sha256()
                with archive.open(name) as stream:
                    for block in iter(lambda:stream.read(1024*1024),b''): h.update(block)
                data = archive.read(midi_name)
                rows.append({'dataset':'smd-v2','recordingId':Path(name).stem,'archive':str(archive_path.relative_to(ROOT)),
                    'audioMember':name,'midiMember':midi_name,'audioSha256':h.hexdigest(),
                    'midiSha256':hashlib.sha256(data).hexdigest(),'audioBytes':archive.getinfo(name).file_size,
                    'audio':audio,'midi':midi_summary(data),'historicalTriggerExposure':'NOT_ESTABLISHED_BY_THIS_AUDIT',
                    'historicalAmtExposure':'F5/XC2/Continuous: already exposed, not globally blind',
                    'pairing':'SMD v2 publisher synchronized performance pair; exact member stem and prior hash receipt'})
    save(WORK/'local_dataset_audit.json',{'startingHead':START,'mode':'LOCAL_METADATA_HASH_MIDI_AUDIT_ONLY',
        'manifests':manifests,'recordings':rows,'counts':dict(Counter(r['dataset'] for r in rows)),
        'newNeuralRuns':0,'newDownloads':0,'noViennaMediaReads':True,
        'notes':['Derived clips and model-produced MIDI are not independent performances.',
                 'Prior frozen STEP is exposed, never a fresh blind set.',
                 'Hash/MIDI inventory alone does not establish historical non-exposure.']})
    print(json.dumps({'counts':dict(Counter(r['dataset'] for r in rows)),
        'withPedal':dict(Counter(r['dataset'] for r in rows if r['midi']['sustainCc64Count'])),
        'maestroWithoutListedExposure':[r['recordingId'] for r in rows if r['dataset']=='maestro-v3.0.0' and not r['historicalTriggerExposure']]}))

if __name__ == '__main__': main()
