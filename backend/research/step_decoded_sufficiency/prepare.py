"""Prospective paired-data selection. MIDI metadata only; no model output reads."""
from pathlib import Path
from collections import Counter
import hashlib
import io
import json
import sys
import zipfile
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'backend/data/work/step_decoded_sufficiency/v1-final'
sys.path.insert(0,str(ROOT/'backend/research/fresh_strike'))
from prepare import notes_and_controls,groups_of,guards_of

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf8') as f:json.dump(value,f,indent=2,allow_nan=False);f.write('\n')

FAMILIES=['single','chord','same_note_retrigger','soft_after_loud','rapid_retrigger','repeated_chord','held','pedal_sustain','release_or_pedal_change']

def occurrences(notes,controls,duration):
    groups=groups_of(notes);guards=guards_of(notes,controls,duration)
    selected={}
    for family in FAMILIES:
        if family in ['held','pedal_sustain','release_or_pedal_change']:
            guard=next((g for g in guards if family in g['tags'] and g['end']-g['start']>=.6
                        and 1.6<=g['start']<duration-4),None)
            if guard:
                previous=next(g for g in reversed(groups) if g['time']<=guard['start'])
                selected[family]=previous['time']
        else:
            group=next((g for g in groups if family in g['tags'] and 1.5<=g['time']<duration-4),None)
            if group:selected[family]=group['time']
    return selected,groups,guards

def main():
    audit=json.loads((ROOT/'backend/research/reports/fresh_strike_v2/dataset-audit.json').read_text())
    sources=sorted((r for r in audit['recordings'] if r['dataset']=='smd-v2'),key=lambda r:r['recordingId'])
    archive=zipfile.ZipFile(ROOT/'backend/data/work/smd_v2/SMD-piano_v2.zip')
    inventory=[];details={}
    for source in sources:
        data=archive.read(source['midiMember'])
        assert hashlib.sha256(data).hexdigest()==source['midiSha256']
        notes,controls=notes_and_controls(data)
        found,groups,guards=occurrences(notes,controls,source['audio']['durationSeconds'])
        details[source['recordingId']]=(source,found,groups,guards)
        inventory.append({'recordingId':source['recordingId'],'audioSha256':source['audioSha256'],
            'midiSha256':source['midiSha256'],'families':found,'midiNotes':len(notes),'controls':len(controls)})
    chosen=[];composers=set()
    for source in sources:
        composer=source['recordingId'].split('_')[0]
        if composer not in composers and source['midi']['sustainCc64Count']>0:
            chosen.append(source['recordingId']);composers.add(composer)
        if len(chosen)==3:break
    for family in FAMILIES:
        if not any(family in details[name][1] for name in chosen):
            extra=next((s['recordingId'] for s in sources if family in details[s['recordingId']][1]),None)
            if extra and extra not in chosen:chosen.append(extra)
    jobs=[];cases=[];receipt=[]
    for index,name in enumerate(chosen):
        source,found,groups,guards=details[name]
        wav=archive.read(source['audioMember'])
        assert hashlib.sha256(wav).hexdigest()==source['audioSha256']
        selections=[]
        for family in FAMILIES:
            if family not in found:continue
            center=found[family];start=round((center-.25)*100)/100
            near=next((s for s in selections if abs(s['start']-start)<.6 and s['start']<=center<s['start']+3.6),None)
            if near:near['families'].append(family);continue
            selections.append({'start':start,'center':center,'families':[family]})
        for ordinal,selection in enumerate(selections):
            ident=f's{index:02d}-{ordinal:02d}';start=selection['start'];end=start+3.6;clip_start=start-1.2
            owned=[g for g in groups if start<=g['time']<end]
            expanded=[g for g in groups if start-.1<=g['time']<end+.1]
            for group in expanded:group['truthId']=f'{name}:{group["time"]:.12f}'
            reference=min(owned,key=lambda g:abs(g['time']-selection['center']))
            singles=[g for g in owned if len(g['notes'])==1]
            chords=[g for g in owned if len(g['notes'])>1]
            plans=[{'name':'as_played','targets':[[n['pitch'] for n in g['notes']] for g in owned]},
                {'name':'busy_period_input','targets':[[n['pitch'] for n in g['notes']] for g in owned],'holdPublications':1},
                {'name':'late_busy_publication','targets':[[n['pitch'] for n in g['notes']] for g in owned],'holdPublications':1,'lateReplay':True}]
            if singles:
                pitch=singles[0]['notes'][0]['pitch']
                plans += [{'name':'single_correct','targets':[[pitch]]},
                    {'name':'wrong_semitone','targets':[[pitch+1]]}, {'name':'wrong_octave','targets':[[pitch+12 if pitch<=96 else pitch-12]]},
                    {'name':'same_pitch_repeated','targets':[[pitch]]*3}]
            if chords:
                pitches=sorted(set(n['pitch'] for n in chords[0]['notes']))
                absent=next(p for p in range(21,109) if p not in pitches)
                plans += [{'name':'correct_chord','targets':[pitches]},
                    {'name':'partial_chord','targets':[pitches+[absent]]},
                    {'name':'extra_note_in_gesture','targets':[pitches[:-1]]},
                    {'name':'same_chord_repeated','targets':[pitches]*3}]
            for tag in ['held','pedal_sustain','soft_after_loud','rapid_retrigger','repeated_chord']:
                if tag in selection['families']:
                    tagged=min(owned,key=lambda g:abs(g['time']-found[tag]))
                    pitches=sorted(set(n['pitch'] for n in tagged['notes']))
                    plans.append({'name':tag,'targets':[pitches]*3})
            if any(tag in selection['families'] for tag in ['held','pedal_sustain']):
                tag=next(tag for tag in ['held','pedal_sustain'] if tag in selection['families'])
                tagged=min(owned,key=lambda g:abs(g['time']-found[tag]))
                plans.append({'name':'correct_then_sustain','targets':[[n['pitch'] for n in tagged['notes']]]*2})
            if len(owned)>1:
                plans.append({'name':'mismatch_then_correct','targets':[[n['pitch'] for n in owned[1]['notes']]]})
            cases.append({'id':ident,'recordingId':name,'ownedStartSeconds':start,'ownedEndSeconds':end,
                'selectedFor':selection['families'],'referenceTruthId':reference['truthId'],'truth':expanded,
                'diagnosticTruth':[g for g in groups if clip_start<=g['time']<end+.2],
                'negativeGuards':[{**g,'start':max(start,g['start']),'end':min(end,g['end'])} for g in guards if min(end,g['end'])>max(start,g['start'])],
                'scenarios':plans})
            with sf.SoundFile(io.BytesIO(wav)) as audio:
                original_rate=audio.samplerate;first=round(clip_start*original_rate);audio.seek(first)
                pcm=audio.read(round((end+.2)*original_rate)-first,dtype='float32',always_2d=True).mean(axis=1)
            for rate in [44100,48000]:
                factor=gcd(rate,original_rate)
                converted=resample_poly(pcm,rate//factor,original_rate//factor).astype('<f4')
                file=WORK/'audio_only'/f'{ident}-{rate}.f32';file.parent.mkdir(parents=True,exist_ok=True);converted.tofile(file)
                jobs.append({'id':ident,'rate':rate,'path':str(file.relative_to(ROOT)),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),
                    'bytes':file.stat().st_size,'sourceOriginSample':round(clip_start*rate),'ownedStartTarget':19200,'ownedSamples':57600})
        receipt.append(source)
    previous=json.loads((ROOT/'backend/research/reports/fresh_strike_v2/development-manifest.json').read_text())
    assert not {s['audioSha256'] for s in receipt}&{s['audioSha256'] for s in previous['sources']}
    save(WORK/'inventory.json',{'sources':inventory,'chosen':chosen,'families':FAMILIES,
        'missingFamilies':[f for f in FAMILIES if not any(f in details[n][1] for n in chosen)],
        'recordingReceipts':receipt,'sourceDisjointFromPreviousDevelopment':True,
        'exposure':'SMD previously AMT/Continuous-exposed; engineering only; commercial NOT_PERFORMED',
        'alignment':'publisher synchronized paired source, zero fixed transform; no prediction-fitted offset',
        'sourceConversion':'scipy 1.14.1 resample_poly default Kaiser5; original 44100 stereo -> mono float32; no normalization'})
    save(WORK/'truth.json',{'cases':cases,'groupingMs':35,'selection':'lexical composer + first MIDI family occurrence v1',
        'matchingToleranceMs':100,'ownedClipSecondsPerRate':len(cases)*3.6,'noOutputDependentSelection':True})
    save(WORK/'audio_only/jobs.json',{'jobs':jobs})
    print(json.dumps({'sources':chosen,'cases':len(cases),'jobs':len(jobs),'families':dict(Counter(f for c in cases for f in c['selectedFor']))}))

if __name__=='__main__':main()
