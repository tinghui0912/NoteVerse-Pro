"""Materialize frozen original waveforms after MIDI-only selection, no inference."""
from pathlib import Path
from hashlib import sha256
from math import gcd
import io
import json
import sys
import zipfile
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'backend/data/work/step_waiting_topology_v3'
sys.path.insert(0,str(ROOT/'backend/research/fresh_strike'))
from prepare import notes_and_controls,groups_of,guards_of


def save(file,data):
    file.parent.mkdir(parents=True,exist_ok=True)
    with file.open('x') as f:json.dump(data,f,indent=2,allow_nan=False);f.write('\n')


def main():
    inventory=json.loads((BASE/'metadata-v4/inventory.json').read_text())
    if inventory['missing']:raise ValueError('METADATA_GATE_BLOCKED')
    out=BASE/'corpus-v3';truth=[];jobs=[]
    with zipfile.ZipFile(ROOT/'backend/data/work/smd_v2/SMD-piano_v2.zip') as archive:
        for family,cases in inventory['selections'].items():
            for chosen in cases:
                ident=f"v{len(truth):02d}";source=chosen['source'];case=chosen['case']
                negative='guard' in case
                t=case['arm'] if negative else case['time']
                owned=t-3 if negative else t-(3.56 if family=='capturing_outside' else 3.15)
                arm=t if negative else t+.8 if family=='pre_ready' else t-.15
                start=owned-1.2;end=owned+4.8+.2
                midi=archive.read(source['midiMember']);assert sha256(midi).hexdigest()==source['midiSha256']
                notes,controls=notes_and_controls(midi);groups=groups_of(notes);guards=guards_of(notes,controls,source['audio']['durationSeconds'])
                wav=archive.read(source['audioMember']);assert sha256(wav).hexdigest()==source['audioSha256']
                with sf.SoundFile(io.BytesIO(wav)) as audio:
                    rate0=audio.samplerate;first=round(start*rate0);last=round(end*rate0)
                    assert 0<=first<last<=audio.frames
                    audio.seek(first);pcm=audio.read(last-first,dtype='float32',always_2d=True).mean(axis=1)
                truth.append({'id':ident,'topology':family,'source':source,'selected':case,'ownedStart':owned,'ownedEnd':owned+4.8,
                    'arm':arm,'scoredEnd':t+1.2,'intendedTime':None if negative else t,
                    'physicalPitches':sorted(set(n['pitch'] for n in (case['previousPhysical']['notes'] if negative else case['physical']['notes']))),
                    'truth':[g for g in groups if start<=g['time']<end],
                    'guards':[g for g in guards if g['end']>arm and g['start']<t+1.2]})
                for rate in [44100,48000]:
                    d=gcd(rate,rate0);converted=resample_poly(pcm,rate//d,rate0//d).astype('<f4')
                    file=out/'audio_only'/f'{ident}-{rate}.f32';file.parent.mkdir(parents=True,exist_ok=True)
                    with file.open('xb') as f:f.write(converted.tobytes())
                    origin=round(start*rate);region=origin+round(1.2*rate)
                    jobs.append({'id':ident,'rate':rate,'path':str(file.relative_to(ROOT)),'sha256':sha256(file.read_bytes()).hexdigest(),
                        'bytes':file.stat().st_size,'sourceOriginSample':origin,'regionStartSourceSample':region,
                        'regionEndSourceSample':region+round(4.8*rate),'armSourceSample':round(arm*rate),
                        'semanticEndSourceSample':round((t+1.2)*rate),
                        'analysisHoldSamples':rate if family in ['analyzing','late_publication'] else 0,
                        'resetHoldSamples':rate if family=='reset' else 0,'delayPublicationIndex':6 if family=='late_publication' else -1})
    save(out/'truth.json',{'cases':truth,'grouping':'first-anchor <=35ms qualification-only MIDI',
        'alignment':'publisher paired source, zero transform, no model-fit','selectionInventorySha256':sha256((BASE/'metadata-v4/inventory.json').read_bytes()).hexdigest()})
    save(out/'audio_only/jobs.json',{'jobs':jobs,'sourceConversion':'scipy1.14.1 resample_poly defaultKaiser5, float32, no gain normalization; test-side only'})
    print(json.dumps({'cases':len(truth),'jobs':len(jobs),'newDatasetDownloads':0,'neuralRuns':0}))


if __name__=='__main__':main()
