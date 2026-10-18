"""Post-selector-freeze MIDI-only execution. No audio decoder or model imports."""
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path
import mido
from selector import first_topologies

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'backend/research/reports/step_waiting_h50_holdout_v3'


def read_midi(source):
    file=ROOT/source['midi']['path']
    if not file.resolve().is_relative_to(ROOT): raise ValueError('MIDI_OUTSIDE_AUTHORIZED_ROOT')
    data=file.read_bytes()
    if sha256(data).hexdigest()!=source['midi']['sha256']: raise ValueError('FROZEN_MIDI_CHANGED')
    seconds=0.; notes=[]; active={}; pedal=[]
    for message in mido.MidiFile(file=io.BytesIO(data)):
        seconds+=message.time
        if message.type=='note_on' and message.velocity>0:
            note={'pitch':message.note,'onsetMs':seconds*1000,'offsetMs':None,'sourceSeconds':seconds}
            notes.append(note);active.setdefault((message.channel,message.note),[]).append(note)
        elif message.type=='note_off' or (message.type=='note_on' and message.velocity==0):
            queue=active.get((message.channel,message.note),[])
            if queue:queue.pop(0)['offsetMs']=seconds*1000
        elif message.type=='control_change' and message.control==64:
            pedal.append({'timeMs':seconds*1000,'value':message.value})
    groups=[]
    for index,note in enumerate(notes):
        if not groups or note['sourceSeconds']-groups[-1]['sourceSeconds']>.035:
            groups.append({'gestureId':source['recordingId']+':g:'+str(index),'sourceSeconds':note['sourceSeconds'],
                           'onsetMs':note['onsetMs'],'notes':[],'normalizedPitchSet':[]})
        groups[-1]['notes'].append(note)
    for group in groups:group['normalizedPitchSet']=sorted({n['pitch'] for n in group['notes']})
    return {'dataset':source['dataset'],'recordingId':source['recordingId'],'audioSha256':source['audio']['sha256'],
            'midiSha256':source['midi']['sha256'],'durationMs':source['audio']['durationSeconds']*1000,
            'gestures':groups,'pedal':pedal,'noteOnCount':len(notes)}


def main():
    proof=json.loads((OUT/'selector-remote-proof.json').read_text(encoding='utf-8'))
    started=datetime.now(timezone.utc).isoformat()
    if not proof['remoteVerifiedAt']<started: raise ValueError('REMOTE_PROOF_NOT_PROSPECTIVE')
    freeze=json.loads((OUT/'selector-freeze.json').read_text(encoding='utf-8'))
    for file in freeze['files']:
        if sha256((ROOT/file['path']).read_bytes()).hexdigest()!=file['sha256']:
            raise ValueError('FROZEN_SELECTOR_CHANGED:'+file['path'])
    inventory=json.loads((OUT/'source-inventory.json').read_text(encoding='utf-8'))
    sources=[read_midi(row) for row in inventory['recordings'] if row['primaryEligible']]
    selected,counts=first_topologies(sources)
    contract=json.loads((ROOT/'backend/research/step_waiting_h50_holdout_v3/selector-contract.json').read_text())
    missing=[name for name in contract['requiredPhysicalFamilies'] if counts[name]==0]
    result={**proof,'executionStartedAt':started,'executionKind':'TRUTH_ONLY_TOPOLOGY_NOT_ACOUSTIC_QUALIFICATION',
        'completedAt':datetime.now(timezone.utc).isoformat(),'candidateMidiEventsParsed':True,'audioPcmDecoded':False,
        'newNeuralRuns':0,'invalidatedNeuralRuns':0,'HMs':50,
        'primaryEligibleRecordingCount':len(sources),'perSourceCounts':[],
        'selected':selected,'availableOccurrenceCounts':counts,'missingMandatoryFamilies':missing,
        'selectedRapidSinglePair':selected.get('single_busy_retrigger',{}).get('pair'),
        'selectedRepeatedChordPair':selected.get('chord_busy_retrigger',{}).get('pair'),
        'repeatedChordBusyCoverage':'TRUTH_TOPOLOGY_AVAILABLE_CAUSAL_BUSY_NOT_YET_EXECUTED' if counts['chord_busy_retrigger'] else 'NOT_AVAILABLE_IN_UNUSED_LOCAL_HOLDOUT',
        'disposition':'STEP_WAITING_H50_PRIMARY_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED' if missing else 'TRUTH_TOPOLOGY_AVAILABLE_INPUT_PRESERVATION_PENDING',
        'safetyCounters':'NOT_MEASURED','usabilityMetrics':'NOT_MEASURED','stageA':'NOT_STARTED','stageB':'NOT_STARTED'}
    for source in sources:
        _,available=first_topologies([source])
        result['perSourceCounts'].append({k:source[k] for k in ['dataset','recordingId','audioSha256','midiSha256','noteOnCount']}|
                                         {'gestureCount':len(source['gestures']),'availableOccurrenceCounts':available})
    with (OUT/'truth-topology.json').open('x',encoding='utf-8',newline='\n') as f:
        json.dump(result,f,indent=2,allow_nan=False);f.write('\n')
    print(json.dumps({'disposition':result['disposition'],'availableOccurrenceCounts':counts,'missingMandatoryFamilies':missing}))


if __name__=='__main__':main()
