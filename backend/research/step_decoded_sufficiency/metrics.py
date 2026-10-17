"""Post-seal truth scoring. Product progression is exclusively the TS runtime."""
from collections import Counter,defaultdict
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from scipy.optimize import linear_sum_assignment

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'backend/data/work/step_decoded_sufficiency/v1-final'
SAFETY=['falseAdvanceWithoutNewTruthGesture','doubleAdvanceFromOneTruthGesture','busyPeriodCarryoverAdvance',
 'latePublicationCarryoverAdvance','samePitchSustainAdvance','sameChordSustainAdvance','crossAttemptEvidenceReuse','wrongPitchAdvance']

def pitch(midi):return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi%12]+str(midi//12-1)
def key(pitches):return tuple(sorted(set(pitches)))
def gt_key(group):return key(pitch(n['pitch']) for n in group['notes'])
def distribution(values):
    return {'count':len(values),'median':float(np.median(values)) if values else None,
        'p95':float(np.percentile(values,95)) if values else None,'max':max(values) if values else None}

def assignment(events,groups,pitch_aware=True):
    if not events:return {}
    cost=np.full((len(events),len(groups)+len(events)),1e6,dtype=float)
    for i,event in enumerate(events):
        for j,group in enumerate(groups):
            error=abs(event['eventMs']-group['time']*1000)
            if error<=100 and (not pitch_aware or key(event['targetPitches'])==gt_key(group)):cost[i,j]=error
    rows,cols=linear_sum_assignment(cost)
    return {int(i):int(j) for i,j in zip(rows,cols) if j<len(groups) and cost[i,j]<1e6}

def score_scenario(result,case,rate):
    outcomes=result['outcomes'];groups=case['truth'];matches=[r for r in outcomes if r['verdict']=='MATCH']
    matched=assignment(matches,groups);used=set(matched.values())
    safety=dict.fromkeys(SAFETY,0);witnesses=[]
    for i,event in enumerate(matches):
        violations=[]
        nearby=[j for j,g in enumerate(groups) if abs(event['eventMs']-g['time']*1000)<=100]
        if i not in matched:
            if not nearby:violations.append('falseAdvanceWithoutNewTruthGesture')
            elif any(gt_key(groups[j])==key(event['targetPitches']) and j in used for j in nearby):violations.append('doubleAdvanceFromOneTruthGesture')
            else:violations.append('wrongPitchAdvance')
        prior=[r for r in outcomes if r['eventMs']<event['eventMs'] and r['attemptId']!=event['attemptId']]
        # Semantic busy time starts at lock, not at an unknown pre-lock physical event.
        if any(r['lockMs']<=event['eventMs']<r['verdictMs'] for r in prior):violations.append('busyPeriodCarryoverAdvance')
        if event['lateReceipt'] or any(r['rearmed'] and event['eventMs']<=r['rearmWatermarkMs'] for r in prior):violations.append('latePublicationCarryoverAdvance')
        guards=[g for g in case['negativeGuards'] if g['start']*1000<=event['eventMs']<g['end']*1000]
        if guards:
            if len(event['targetPitches'])==1:violations.append('samePitchSustainAdvance')
            else:violations.append('sameChordSustainAdvance')
        for violation in violations:safety[violation]+=1
        if violations:witnesses.append({'caseId':case['id'],'recordingId':case['recordingId'],'rate':rate,
            'scenario':result['scenario']['name'],'violations':violations,'outcome':event,
            'nearbyTruth':[groups[j] for j in nearby],'priorOutcomes':prior,'negativeGuards':guards})
    ids=[identity for r in outcomes for identity in r['observationIds']]
    reuse=sum(n-1 for n in Counter(ids).values() if n>1);safety['crossAttemptEvidenceReuse']=reuse
    if reuse:witnesses.append({'caseId':case['id'],'rate':rate,'scenario':result['scenario']['name'],'violations':['crossAttemptEvidenceReuse'],'observationIds':ids})
    # Independent oracle progression defines intended opportunities, never production input.
    targets=result['scenario']['targets'];pointer=0;intended=[]
    for group in groups:
        if not case['ownedStartSeconds']<=group['time']<case['ownedEndSeconds']:continue
        if pointer<len(targets) and gt_key(group)==key(pitch(p) for p in targets[pointer]):
            intended.append(group);pointer+=1
    supported_ids={groups[j]['truthId'] for j in matched.values()}
    recall=[{**g,'accepted':g['truthId'] in supported_ids} for g in intended]
    mismatch={'total':0,'truthSupportedCorrectRejection':0,'falseMismatch':0,'noNearbyTruth':0}
    for event in outcomes:
        if event['verdict']!='MISMATCH':continue
        mismatch['total']+=1
        near=min(groups,key=lambda g:abs(event['eventMs']-g['time']*1000),default=None)
        if near is None or abs(event['eventMs']-near['time']*1000)>100:mismatch['noNearbyTruth']+=1
        elif key(event['targetPitches'])==gt_key(near):mismatch['falseMismatch']+=1
        else:mismatch['truthSupportedCorrectRejection']+=1
    latencies={'eventToEvidenceMs':[],'eventToLockMs':[],'eventToVerdictMs':[],'lockToVerdictMs':[],'additionalTruthGesturesBeforeLock':[]}
    for event in outcomes:
        latencies['eventToEvidenceMs'].append(event['evidenceAvailabilityMs']-event['eventMs'])
        latencies['eventToLockMs'].append(event['lockMs']-event['eventMs'])
        latencies['eventToVerdictMs'].append(event['verdictMs']-event['eventMs'])
        latencies['lockToVerdictMs'].append(event['verdictMs']-event['lockMs'])
        near=min(groups,key=lambda g:abs(event['eventMs']-g['time']*1000),default=None)
        anchor=near['time']*1000 if near and abs(event['eventMs']-near['time']*1000)<=100 else event['eventMs']
        latencies['additionalTruthGesturesBeforeLock'].append(sum(anchor<g['time']*1000<=event['lockMs'] for g in case.get('diagnosticTruth',groups)))
    return {'id':case['id'],'recordingId':case['recordingId'],'rate':rate,'scenario':result['scenario']['name'],
        'safety':safety,'witnesses':witnesses,'recallOpportunities':recall,'mismatch':mismatch,'latencies':latencies,
        'outcomes':len(outcomes),'matches':len(matches),'supportedMatches':len(matched),'retryCount':sum(r['verdict']=='RETRY' for r in outcomes),
        'ignoredGestures':result['ignoredGestures'],'receiptMaxOpened':max((r['opened'] for r in result['receipts']),default=0)}

def summarize(rows):
    opportunities=[g for r in rows for g in r['recallOpportunities']]
    families={}
    for family in ['single','chord','same_note_retrigger','soft_after_loud','rapid_retrigger','repeated_chord']:
        subset=[g for g in opportunities if family in g['tags']]
        families[family]={'accepted':sum(g['accepted'] for g in subset),'total':len(subset),'recall':sum(g['accepted'] for g in subset)/len(subset) if subset else None}
    latency={name:distribution([v for r in rows for v in r['latencies'][name]]) for name in ['eventToEvidenceMs','eventToLockMs','eventToVerdictMs','lockToVerdictMs','additionalTruthGesturesBeforeLock']}
    attempts=sum(r['outcomes'] for r in rows)
    return {'safety':{s:sum(r['safety'][s] for r in rows) for s in SAFETY},'scenarioCells':len(rows),
        'attempts':attempts,'matches':sum(r['matches'] for r in rows),'supportedMatches':sum(r['supportedMatches'] for r in rows),
        'intendedAttempts':len(opportunities),'acceptedIntendedAttempts':sum(g['accepted'] for g in opportunities),
        'acceptedAttemptRecall':sum(g['accepted'] for g in opportunities)/len(opportunities) if opportunities else None,
        'recallByFamily':families,'mismatch':{k:sum(r['mismatch'][k] for r in rows) for k in ['total','truthSupportedCorrectRejection','falseMismatch','noNearbyTruth']},
        'retryCount':sum(r['retryCount'] for r in rows),'retryRate':sum(r['retryCount'] for r in rows)/attempts if attempts else None,
        'latencies':latency,'preLockAdditionalTruthGestures':sum(v for r in rows for v in r['latencies']['additionalTruthGesturesBeforeLock'])}

def main():
    product=json.loads((WORK/'product.json').read_text());seal=json.loads((WORK/'acoustic-seal.json').read_text())
    assert hashlib.sha256((ROOT/seal['path']).read_bytes()).hexdigest()==seal['sha256']
    truth=json.loads((WORK/'truth.json').read_text());inventory=json.loads((WORK/'inventory.json').read_text())
    cases={c['id']:c for c in truth['cases']};rows=[];raw=[]
    for cell in product['results']:
        case=cases[cell['id']]
        rows.extend(score_scenario(s,case,cell['rate']) for s in cell['scenarios'])
        tokens=[{'eventMs':g['eventMs']} for g in cell['gestures']]
        matched=assignment(tokens,case['truth'],False)
        raw.append({'id':cell['id'],'rate':cell['rate'],'recordingId':case['recordingId'],'decodedNotes':cell['rawObservationCount'],
            'gestureTokens':len(tokens),'matchedGestureTokens':len(matched),'unmatchedTokens':len(tokens)-len(matched),
            'extraTokensInNoteOnFreeGuards':sum(any(g['start']*1000<=t['eventMs']<g['end']*1000 for g in case['negativeGuards']) for t in tokens)})
    summaries={str(rate):summarize([r for r in rows if r['rate']==rate]) for rate in [44100,48000]}
    blocked=bool(inventory['missingFamilies']) or any(sum(s['safety'].values()) for s in summaries.values())
    final={'disposition':'STEP_DECODED_ACOUSTIC_ATTEMPT_SAFETY_NOT_ESTABLISHED' if blocked else 'STEP_DECODED_ACOUSTIC_ATTEMPT_SAFETY_ESTABLISHED_MICROPHONE_DISABLED',
        **product['productExecutionProof'],'productExecutionProof':product['productExecutionProof'],
        'acousticSealSha256':product['acousticSealSha256'],'summaries':summaries,'rawDiagnostics':raw,
        'perSource':{source:{str(rate):summarize([r for r in rows if r['recordingId']==source and r['rate']==rate]) for rate in [44100,48000]} for source in sorted(set(r['recordingId'] for r in rows))},
        'byScenario':{name:{str(rate):summarize([r for r in rows if r['scenario']==name and r['rate']==rate]) for rate in [44100,48000]} for name in sorted(set(r['scenario'] for r in rows))},
        'rows':rows,'dangerousWitnesses':[w for r in rows for w in r['witnesses']],
        'missingFamilies':inventory['missingFamilies'],'usability':'MEASURED_NOT_YET_PRODUCT_SLO_QUALIFIED',
        'latencyScope':'source-domain causal replay availability plus measured Worker transaction duration; not real-device UX SLO',
        'truthGrouping':'fixed first-anchor 35ms from historical GT metadata rule; model output never changes truth',
        'opportunityCaveat':'overlapping clips, counterfactual scenarios and both rates repeat diagnostic opportunities; not independent statistical trials'}
    with (WORK/'scores.json').open('x') as f:json.dump(final,f,indent=2,allow_nan=False);f.write('\n')
    print(json.dumps({'disposition':final['disposition'],'summaries':summaries,'witnessCount':len(final['dangerousWitnesses'])}))

if __name__=='__main__':main()
