"""Truth-side development selection, before detector execution. Docker only."""
import hashlib
import io
import json
from pathlib import Path
from math import gcd
import mido
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from audit import ROOT, WORK, save

def notes_and_controls(data):
    clock, notes, controls, active = 0., [], [], {}
    for message in mido.MidiFile(file=io.BytesIO(data)):
        clock += message.time
        if message.type == 'note_on' and message.velocity:
            item = {'time':clock,'pitch':message.note,'velocity':message.velocity,'end':None}
            notes.append(item); active.setdefault((message.channel,message.note),[]).append(item)
        elif message.type == 'note_off' or (message.type == 'note_on' and not message.velocity):
            queue = active.get((message.channel,message.note),[])
            if queue: queue.pop(0)['end'] = clock
        elif message.type == 'control_change' and message.control == 64:
            controls.append({'time':clock,'value':message.value})
    return notes, controls

def groups_of(notes):
    groups = []
    for note in notes:
        if not groups or note['time'] - groups[-1]['time'] > .035:
            groups.append({'time':note['time'],'notes':[]})
        groups[-1]['notes'].append(note)
    last_by_pitch, previous = {}, None
    for group in groups:
        tags = ['single' if len(group['notes']) == 1 else 'chord']
        same = [last_by_pitch[n['pitch']] for n in group['notes'] if n['pitch'] in last_by_pitch]
        if same:
            gap = min(group['time'] - n['time'] for n in same)
            group['minimumRetriggerGapSeconds'] = gap
            tags.append('same_note_retrigger')
            if gap <= .25: tags.append('rapid_retrigger')
            if any(n['end'] is not None and n['end'] >= group['time'] for n in same): tags.append('key_held_retrigger')
            if max(n['velocity'] for n in group['notes']) < .6 * max(n['velocity'] for n in same): tags.append('soft_after_loud')
        if previous and len(group['notes']) > 1 and {n['pitch'] for n in group['notes']} == {n['pitch'] for n in previous['notes']}:
            tags.append('repeated_chord')
        group['tags'] = tags
        for note in group['notes']: last_by_pitch[note['pitch']] = note
        previous = group
    return groups

def guards_of(notes, controls, duration):
    # Any-pitch note-on exclusion. Labels describe MIDI state, not acoustic energy.
    times = sorted(set(n['time'] for n in notes))
    guards = []
    for a,b in zip(times,times[1:]+[duration]):
        start,end = a+.1,min(b-.1,duration)
        if end-start < .3: continue
        tags = ['all_note_on_free']
        if any(n['time'] <= start and n['end'] is not None and n['end'] >= end for n in notes): tags.append('held')
        pedal = [c for c in controls if c['time'] <= start]
        if pedal and pedal[-1]['value'] >= 64: tags.append('pedal_sustain')
        if any(start <= c['time'] < end for c in controls) or any(n['end'] is not None and start <= n['end'] < end for n in notes):
            tags.append('release_or_pedal_change')
        assert not any(start <= n['time'] < end for n in notes)
        guards.append({'start':start,'end':end,'tags':tags})
    return guards

def main():
    audit = json.loads((WORK/'local_dataset_audit.json').read_text())
    eligible = [r for r in audit['recordings'] if r['dataset']=='maestro-v3.0.0'
                and 'production_step_development_set' in r['historicalTriggerExposure']]
    sources = sorted(eligible,key=lambda r:r['recordingId'])[:3]
    truth, jobs, corpus = [], [], []
    base = WORK/'development'
    (base/'audio_only').mkdir(parents=True,exist_ok=True)
    for index,source in enumerate(sources):
        notes,controls = notes_and_controls((ROOT/source['midiPath']).read_bytes())
        duration = source['audio']['durationSeconds']
        groups, guards = groups_of(notes), guards_of(notes,controls,duration)
        centers = []
        requested = ['single','chord','same_note_retrigger','soft_after_loud','rapid_retrigger','repeated_chord']
        for family in requested:
            item = next((g for g in groups if family in g['tags'] and 2 <= g['time'] < duration-4),None)
            if item: centers.append((item['time'],family))
        for family in ['held','pedal_sustain','release_or_pedal_change']:
            guard = next((g for g in guards if family in g['tags'] and 2 <= g['start'] < duration-4),None)
            if guard: centers.append((guard['start'],family))
        selected = []
        for center,family in centers:
            start = round((center-.3)*10)/10
            near = next((s for s in selected if abs(s['ownedStartSeconds']-start)<.6),None)
            if near: near['selectedFor'].append(family); continue
            selected.append({'ownedStartSeconds':start,'selectedFor':[family]})
        for n,case in enumerate(selected):
            ident = f'd{index:02d}-{n:02d}'
            start,end = case['ownedStartSeconds'],case['ownedStartSeconds']+3
            clip_start = start-1.2
            clip_end = end+.2
            case_truth = {'id':ident,'recordingId':source['recordingId'],**case,
                'ownedEndSeconds':end,'clipStartSeconds':clip_start,
                'groups':[g for g in groups if start <= g['time'] < end],
                'negativeGuards':[{**g,'start':max(start,g['start']),'end':min(end,g['end'])}
                    for g in guards if min(end,g['end']) > max(start,g['start'])]}
            truth.append(case_truth)
            original_rate = source['audio']['rate']
            with sf.SoundFile(ROOT/source['audioPath']) as audio:
                first = round(clip_start*original_rate); audio.seek(first)
                pcm = audio.read(round(clip_end*original_rate)-first,dtype='float32',always_2d=True).mean(axis=1)
            for rate in [44100,48000]:
                divisor = gcd(rate,original_rate)
                converted = resample_poly(pcm,rate//divisor,original_rate//divisor).astype('<f4')
                file = base/'audio_only'/f'{ident}-{rate}.f32'
                converted.tofile(file)
                jobs.append({'id':ident,'rate':rate,'sourceDomainId':f'{ident}:{rate}',
                    'sourceOriginSample':round(clip_start*rate),'ownedStartTarget':19200,'ownedSamples':48000,
                    'path':str(file.relative_to(ROOT)),'bytes':file.stat().st_size,
                    'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
        corpus.append({**source,'cases':selected,'alignmentTransformSeconds':0,
            'alignmentBasis':'official MAESTRO paired recording, no model-fitted adjustment'})
    save(base/'audio_only/jobs.json',{'jobs':jobs})
    save(base/'truth.json',{'cases':truth,'sources':corpus,'selectionAlgorithm':'first-family-occurrence-v1; chronological; merge start distance <600ms',
        'grouping':'fixed first anchor 35ms, not transitive','scoredSecondsPerSourceRate':len(truth)*3,
        'strongSustainAcousticEnergyQualification':'NOT_ESTABLISHED_BY_MIDI_ONLY',
        'testSourceConversion':'scipy1.14.1 resample_poly default Kaiser5, float32, no gain normalization'})
    print(json.dumps({'sources':len(corpus),'cases':len(truth),'jobs':len(jobs),
        'groups':sum(len(c['groups']) for c in truth),'guards':sum(len(c['negativeGuards']) for c in truth)}))

if __name__ == '__main__': main()
