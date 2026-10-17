"""MIDI-only deterministic holdout selection. No acoustic inference/output reads."""
from pathlib import Path
from hashlib import sha256
import io
import json
import sys
import zipfile
from math import gcd
import soundfile as sf
from scipy.signal import resample_poly
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'backend/data/work/step_waiting_attempt_v2/v2'
sys.path.insert(0, str(ROOT / 'backend/research/fresh_strike'))
from prepare import notes_and_controls, groups_of, guards_of


def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')


def first_cases(groups, guards, duration):
    found = {}
    for i, group in enumerate(groups):
        t = group['time']
        prior_end = max(n['time'] for n in groups[i-1]['notes']) if i else 0
        next_start = groups[i+1]['time'] if i+1 < len(groups) else duration
        pitches = sorted(set(n['pitch'] for n in group['notes']))
        if t < 3 or t > duration-4:
            continue
        if i and t-prior_end>=.35 and i+2<len(groups) and .6<=next_start-t<=.9 and groups[i+2]['time']-next_start>=1.2:
            for name in ['busy_period_input','late_publication']:
                found.setdefault(name,{'family':name,'eventTime':t,'physicalPitches':pitches,'warmBoundary':t-.35,
                    'ownedStart':t-.95,'ownedEnd':t+1.45,'scoredEnd':t+1.4,'reference':group,
                    'busyInput':groups[i+1],'previousPhysical':groups[i-1],'nextPhysical':groups[i+2]})
        if next_start-t < 1.2:
            continue
        ordinary = t-prior_end >= .35
        tags = set(group['tags'])
        names = []
        if ordinary:
            if len(pitches) == 1:
                names += ['correct_single', 'wrong_semitone', 'wrong_octave']
            else:
                names += ['correct_chord', 'missing_chord_tone', 'extra_chord_tone']
                spread = max(n['time'] for n in group['notes'])-t
                if 0 < spread <= .035:
                    names.append('close_spread_chord')
            names += [name for name, tag in [('same_note_retrigger','same_note_retrigger'),
                ('repeated_chord','repeated_chord'),('soft_after_loud','soft_after_loud')] if tag in tags]
            warm = t-.35
        else:
            warm = (prior_end+t)/2
            if i and .2 <= t-prior_end <= .25 and 'rapid_retrigger' in tags:
                names = ['rapid_retrigger']
        for name in names:
            found.setdefault(name, {'family':name,'eventTime':t,'physicalPitches':pitches,'warmBoundary':warm,
                'ownedStart':warm-.6,'ownedEnd':warm+1.8,'scoredEnd':min(t+1.0,warm+1.8),
                'reference':group,'previousPhysical':groups[i-1] if i else None,'nextPhysical':groups[i+1] if i+1<len(groups) else None})
    for guard in guards:
        if guard['end']-guard['start'] < 1.8 or guard['start'] < 3 or guard['end'] > duration-.3:
            continue
        previous = next(g for g in reversed(groups) if g['time'] < guard['start'])
        pitches = sorted(set(n['pitch'] for n in previous['notes']))
        name = 'held_note_negative' if 'held' in guard['tags'] and len(pitches)==1 else 'pedal_sustain_negative' if 'pedal_sustain' in guard['tags'] and len(pitches)>1 else None
        if name:
            warm = guard['start']+.2
            found.setdefault(name, {'family':name,'eventTime':None,'physicalPitches':pitches,'warmBoundary':warm,
                'ownedStart':warm-.6,'ownedEnd':warm+1.8,'scoredEnd':warm+1.2,'reference':previous,'negativeGuard':guard})
    return found


def main():
    contract = json.loads((ROOT/'backend/research/step_waiting_attempt_v2/contract.json').read_text())
    previous = json.loads((ROOT/'backend/research/reports/step_decoded_sufficiency_v1/inventory.json').read_text())['recordingReceipts']
    previous += json.loads((ROOT/'backend/research/reports/fresh_strike_v2/development-manifest.json').read_text())['sources']
    excluded_ids = {s['recordingId'] for s in previous}
    excluded_audio = {s['audioSha256'] for s in previous}
    excluded_midi = {s['midiSha256'] for s in previous}
    sources = json.loads((ROOT/'backend/research/reports/fresh_strike_v2/dataset-audit.json').read_text())['recordings']
    eligible = sorted([s for s in sources if s['dataset']=='smd-v2' and s['recordingId'] not in excluded_ids
        and s['audioSha256'] not in excluded_audio and s['midiSha256'] not in excluded_midi], key=lambda s:s['recordingId'])
    archive = zipfile.ZipFile(ROOT/'backend/data/work/smd_v2/SMD-piano_v2.zip')
    selected, inventory = {}, []
    for source in eligible:
        midi = archive.read(source['midiMember'])
        assert sha256(midi).hexdigest() == source['midiSha256']
        notes, controls = notes_and_controls(midi)
        groups = groups_of(notes)
        guards = guards_of(notes, controls, source['audio']['durationSeconds'])
        available = first_cases(groups, guards, source['audio']['durationSeconds'])
        inventory.append({'recordingId':source['recordingId'],'audioSha256':source['audioSha256'],
            'midiSha256':source['midiSha256'],'availableFamilies':list(available)})
        for name in contract['families']:
            if name not in selected and name in available:
                selected[name] = {'source':source,'case':available[name],'groups':groups,'guards':guards}
    missing = [f for f in contract['families'] if f not in selected]
    audit = {'selectionRule':contract,'excludedSources':list(previous),'eligibleMetadataInventory':inventory,
        'missingFamilies':missing,'selectedSourceIds':sorted(set(s['source']['recordingId'] for s in selected.values())),
        'sourceDisjoint':True,'acousticOutputOpened':False,'newDatasetDownloads':0}
    save(WORK/'metadata-audit.json',audit)
    if missing:
        print(json.dumps({'status':'MISSING_REQUIRED_FAMILIES','missing':missing,'sources':audit['selectedSourceIds']}))
        return
    truth, jobs = [], []
    for ordinal, family in enumerate(contract['families']):
        item = selected[family]; source, case = item['source'], item['case']; ident = f'q{ordinal:02d}'
        start = case['ownedStart']-1.2; end = case['ownedEnd']+.2
        wav = archive.read(source['audioMember']); assert sha256(wav).hexdigest()==source['audioSha256']
        with sf.SoundFile(io.BytesIO(wav)) as audio:
            original_rate=audio.samplerate;first=round(start*original_rate);last=round(end*original_rate)
            assert first>=0 and last<=audio.frames
            audio.seek(first);pcm=audio.read(last-first,dtype='float32',always_2d=True).mean(axis=1)
        truth.append({'id':ident,**case,'source':source,'truth':[g for g in item['groups'] if case['ownedStart']<=g['time']<=case['ownedEnd']],
            'guards':[g for g in item['guards'] if g['end']>case['warmBoundary'] and g['start']<case['scoredEnd']]})
        for rate in [44100,48000]:
            factor=gcd(rate,original_rate);converted=resample_poly(pcm,rate//factor,original_rate//factor).astype('<f4')
            file=WORK/'audio_only'/f'{ident}-{rate}.f32';file.parent.mkdir(parents=True,exist_ok=True);converted.tofile(file)
            source_origin=round(start*rate);region_start=source_origin+round(1.2*rate);region_end=region_start+round(2.4*rate)
            jobs.append({'id':ident,'rate':rate,'path':str(file.relative_to(ROOT)),'sha256':sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size,
                'sourceOriginSample':source_origin,'regionStartSourceSample':region_start,'regionEndSourceSample':region_end,
                'semanticEndSourceSample':round(case['scoredEnd']*rate)})
    save(WORK/'truth.json',{'cases':truth,'contractSha256':sha256((ROOT/'backend/research/step_waiting_attempt_v2/contract.json').read_bytes()).hexdigest(),
        'selection':'MIDI metadata only, lexical source and first qualifying occurrence; no replacement',
        'truthGroupingMs':35,'sourceConversion':'SciPy1.14.1 resample_poly default Kaiser5 float32; no gain normalization; qualification infrastructure only'})
    save(WORK/'audio_only/jobs.json',{'jobs':jobs})
    print(json.dumps({'status':'SELECTED_METADATA_ONLY','cases':len(truth),'jobs':len(jobs),'sources':audit['selectedSourceIds']}))


if __name__=='__main__':
    main()
