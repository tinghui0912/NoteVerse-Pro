"""Metadata-only prospective inventory. Never reads acoustic outputs or audio PCM."""
from pathlib import Path
from hashlib import sha256
import json
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'backend/data/work/step_waiting_topology_v3/metadata-v4'
sys.path.insert(0,str(ROOT/'backend/research/fresh_strike'))
from prepare import notes_and_controls, groups_of, guards_of


def eligible(groups, guards, duration):
    candidates={name:[] for name in ['single','chord','close_spread_chord','same_pitch_after_ready',
        'repeated_chord_after_ready','soft_after_loud_after_ready','held_note','pedal_sustain',
        'pre_ready','capturing_outside','analyzing','reset','late_publication','rapid_not_ready']}
    previous_by_pitch={}
    for i,g in enumerate(groups):
        t=g['time'];p=sorted(set(n['pitch'] for n in g['notes']))
        prior=groups[i-1] if i else None
        end=max(n['time'] for n in prior['notes']) if prior else 0
        following=groups[i+1]['time'] if i+1<len(groups) else duration
        item={'groupIndex':i,'time':t,'pitches':p,'physical':g}
        if 5<=t<duration-3:
            if prior and t-end>=.2 and following-t>=1.2:
                candidates['single' if len(p)==1 else 'chord'].append(item)
                if len(p)>1 and 0<max(n['time'] for n in g['notes'])-t<=.035:
                    candidates['close_spread_chord'].append(item)
                old=previous_by_pitch.get(p[0]) if len(p)==1 else None
                if old and t-old['time']<=3:
                    candidates['same_pitch_after_ready'].append(item)
                    if max(n['velocity'] for n in g['notes'])<.6*max(n['velocity'] for n in old['notes']):
                        candidates['soft_after_loud_after_ready'].append(item)
                if len(p)>1 and sorted(set(n['pitch'] for n in prior['notes']))==p and t-prior['time']<=3:
                    candidates['repeated_chord_after_ready'].append(item)
                candidates['pre_ready'].append(item)
            if prior and t-end>=.2:
                gap=following-t
                labels=['capturing_outside'] if .25<=gap<=.5 else ['rapid_not_ready'] if .2<=gap<=.25 else ['analyzing','reset','late_publication'] if .7<=gap<=.9 else []
                for label in labels:candidates[label].append({**item,'secondPhysical':groups[i+1]})
        for pitch in p:previous_by_pitch[pitch]=g
    for i,guard in enumerate(guards):
        arm=guard['start']+.2
        if arm<4.5 or guard['end']-guard['start']<1.6 or arm+2>duration:continue
        previous=next((g for g in reversed(groups) if g['time']<guard['start']),None)
        item={'guardIndex':i,'arm':arm,'guard':guard,'previousPhysical':previous}
        if 'held' in guard['tags']:candidates['held_note'].append(item)
        if 'pedal_sustain' in guard['tags']:candidates['pedal_sustain'].append(item)
    return candidates


def main():
    contract_path=ROOT/'backend/research/step_waiting_topology_v3/contract.json'
    contract=json.loads(contract_path.read_text())
    report=ROOT/'backend/research/reports'
    audit=json.loads((report/'fresh_strike_v2/dataset-audit.json').read_text())
    receipts=[]
    def add(records,origin):
        receipts.extend({**r,'exclusionReceipt':origin} for r in records)
    add(json.loads((report/'step_decoded_sufficiency_v1/inventory.json').read_text())['recordingReceipts'],'STEP decoded sufficiency actual sources; assembly development reused this seal')
    add(json.loads((report/'fresh_strike_v2/development-manifest.json').read_text())['sources'],'fresh-strike development, including prior invalidation')
    add([c['source'] for c in json.loads((report/'step_waiting_attempt_v2/truth.json').read_text())['cases']],'waiting-attempt V2 qualification, all selected sources including invalidated runs')
    add([r for r in audit['recordings'] if isinstance(r.get('historicalTriggerExposure'),list) and r['historicalTriggerExposure']],
        'conservative exclusion: historical STEP development/calibration/frozen/causal exposure')
    excluded_ids={r['recordingId'] for r in receipts}
    excluded_audio={r['audioSha256'] for r in receipts}
    excluded_midi={r['midiSha256'] for r in receipts}
    inventory=[];selections={k:[] for k in contract['readyTopologies']+contract['negativeTopologies']+contract['suppressionTopologies']}
    used=set()
    with zipfile.ZipFile(ROOT/'backend/data/work/smd_v2/SMD-piano_v2.zip') as archive:
        for source in sorted(audit['recordings'],key=lambda s:(s['dataset'],s['recordingId'])):
            reasons=[]
            if source['recordingId'] in excluded_ids:reasons.append('EXPOSED_RECORDING_ID')
            if source['audioSha256'] in excluded_audio:reasons.append('EXPOSED_AUDIO_HASH')
            if source['midiSha256'] in excluded_midi:reasons.append('EXPOSED_MIDI_HASH')
            if source['dataset']!='smd-v2':reasons.append('NOT_SELECTED: SMD publisher-synchronized archive preferred; no pairing assumption for other local media')
            row={'source':source,'excludedReasons':reasons}
            if reasons:inventory.append(row);continue
            midi=archive.read(source['midiMember'])
            if sha256(midi).hexdigest()!=source['midiSha256']:raise ValueError('MIDI_IDENTITY_MISMATCH')
            notes,controls=notes_and_controls(midi)
            groups=groups_of(notes);guards=guards_of(notes,controls,source['audio']['durationSeconds'])
            cases=eligible(groups,guards,source['audio']['durationSeconds'])
            row['availableCounts']={k:len(v) for k,v in cases.items()}
            inventory.append(row)
            for family in selections:
                if len(selections[family])>=2:continue
                first=next((c for c in cases[family] if (source['recordingId'],c.get('groupIndex',f"guard:{c.get('guardIndex')}")) not in used),None)
                if first:
                    selections[family].append({'source':source,'case':first})
                    if family in contract['readyTopologies']+contract['negativeTopologies']:
                        used.add((source['recordingId'],first.get('groupIndex',f"guard:{first.get('guardIndex')}")))
    missing=[{'topology':k,'occurrences':len(v),'distinctRecordings':len({c['source']['recordingId'] for c in v})}
        for k,v in selections.items() if len(v)<2]
    OUT.mkdir(parents=True,exist_ok=True)
    result={'phase':contract['phase'],'contractSha256':sha256(contract_path.read_bytes()).hexdigest(),
        'metadataOnly':True,'acousticOutputsOpened':False,'newDatasetDownloads':0,'neuralRuns':0,
        'truthGroupingMs':35,'rateCasesAreNotIndependentPerformances':True,'excludedReceipts':receipts,
        'inventory':inventory,'selections':selections,'missing':missing,
        'status':'BLOCKED_METADATA_MINIMUM' if missing else 'METADATA_REQUIREMENTS_MET'}
    with (OUT/'inventory.json').open('x') as f:json.dump(result,f,indent=2,allow_nan=False);f.write('\n')
    print(json.dumps({'status':result['status'],'selectedPhysicalOccurrences':sum(len(v) for v in selections.values()),'missing':missing,
        'recordings':sorted({x['source']['recordingId'] for v in selections.values() for x in v})}))


if __name__=='__main__':main()
