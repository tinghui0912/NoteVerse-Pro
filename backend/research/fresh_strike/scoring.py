"""Stage B only. Candidate seals are checked BEFORE truth is opened."""
import hashlib
import json
from collections import defaultdict
import numpy as np
from scipy.optimize import linear_sum_assignment
from audit import ROOT, WORK, save

def match(anchors,truth,tolerance=.1):
    if not truth: return []
    cost = np.full((len(truth),len(anchors)+len(truth)),1e6,dtype=np.float64)
    for g,t in enumerate(truth):
        for c,a in enumerate(anchors):
            if abs(a-t)<=tolerance: cost[g,c]=abs(a-t)
    rows,cols = linear_sum_assignment(cost)
    return [(int(g),int(c)) for g,c in zip(rows,cols) if c<len(anchors) and cost[g,c]<1e6]

def distribution(values):
    return {'count':len(values),'median':float(np.median(values)) if values else None,
        'p95':float(np.percentile(values,95)) if values else None,'max':max(values) if values else None,
        'min':min(values) if values else None}

def summarize(cells):
    positive = [g for c in cells for g in c['gestures']]
    tokens = sum(c['tokens'] for c in cells)
    missed = [g for g in positive if not g['matched']]
    families = {}
    for family in ['single','chord','same_note_retrigger','soft_after_loud','rapid_retrigger','repeated_chord','key_held_retrigger']:
        subset=[g for g in positive if family in g['tags']]
        families[family]={'matched':sum(g['matched'] for g in subset),'total':len(subset),
            'recall':sum(g['matched'] for g in subset)/len(subset) if subset else None}
    seconds=sum(c['scoredSeconds'] for c in cells)
    by_guard={}
    for tag in ['all_note_on_free','held','pedal_sustain','release_or_pedal_change']:
        guards=[g for c in cells for g in c['guards'] if tag in g['tags']]
        by_guard[tag]={'intervals':len(guards),'seconds':sum(g['end']-g['start'] for g in guards),
                       'falseTokens':sum(len(g['falseCandidates']) for g in guards)}
    matched=[g for g in positive if g['matched']]
    return {'truthGestures':len(positive),'matched':len(matched),'missed':len(missed),
        'recall':len(matched)/len(positive) if positive else None,'tokens':tokens,
        'families':families,'negativeGuards':by_guard,
        'duplicates':sum(c['duplicates'] for c in cells),'unmatchedCandidates':sum(len(c['unmatched']) for c in cells),
        'candidatePressurePerMinute':tokens*60/seconds if seconds else None,
        'unmatchedPerMinute':sum(len(c['unmatched']) for c in cells)*60/seconds if seconds else None,
        'anchorAbsoluteErrorMs':distribution([abs(g['errorMs']) for g in matched]),
        'anchorSignedErrorMs':distribution([g['errorMs'] for g in matched]),
        'evidenceAvailabilityDelayMs':distribution([g['availabilityDelayMs'] for g in matched]),
        'minimumObservedRetriggerSpacingMs':min((g['minimumRetriggerGapSeconds']*1000 for g in positive if 'minimumRetriggerGapSeconds' in g),default=None),
        'exposure':'DEVELOPMENT_ONLY; overlapping clips count repeated diagnostic opportunities, not independent trials'}

def eligible(metrics):
    return (metrics['recall'] is not None and metrics['recall']>=.9 and metrics['duplicates']==0
        and metrics['negativeGuards']['all_note_on_free']['falseTokens']==0
        and all(metrics['families'][f]['recall'] is not None and metrics['families'][f]['recall']>=.9
                for f in ['same_note_retrigger','chord']))

def main():
    proof=json.loads((WORK/'development/scoringExecutionProof.json').read_text())
    seal_path=WORK/'development/candidate-stream-seal.json'
    seal=json.loads(seal_path.read_text())
    for item in seal['files']:
        assert hashlib.sha256((ROOT/item['path']).read_bytes()).hexdigest()==item['sha256']
    browser=json.loads((WORK/'development/browser.json').read_text())
    baseline=json.loads((WORK/'development/baseline.json').read_text())
    # This is the first Stage B truth access, after complete candidate stream seal verification.
    truth=json.loads((WORK/'development/truth.json').read_text())
    cases={c['id']:c for c in truth['cases']}
    baselines={(c['id'],c['rate']):c['tokens'] for c in baseline['results']}
    all_cells=[]
    for cell in browser['result']['results']:
        case=cases[cell['id']]
        for name,tokens in {**cell['outputs'],'historical':baselines[(cell['id'],cell['rate'])]}.items():
            anchors=[t['sourceAnchorSample']/cell['rate'] for t in tokens]
            pairs=match(anchors,[g['time'] for g in case['groups']])
            matched=dict(pairs); used={c for _,c in pairs}; gestures=[]
            for index,g in enumerate(case['groups']):
                hit=index in matched
                item={**g,'caseId':case['id'],'recordingId':case['recordingId'],'matched':hit}
                if hit:
                    token=tokens[matched[index]]
                    item.update({'candidateId':token['candidateId'],'errorMs':(anchors[matched[index]]-g['time'])*1000,
                        'availabilityDelayMs':(token['evidenceAvailableThroughSourceSample']-token['sourceAnchorSample'])/cell['rate']*1000})
                gestures.append(item)
            guards=[{**g,'falseCandidates':[t['candidateId'] for t,a in zip(tokens,anchors) if g['start']<=a<g['end']]} for g in case['negativeGuards']]
            unmatched=[{**tokens[i],'sourceTimeSeconds':a} for i,a in enumerate(anchors) if i not in used]
            duplicates=sum(any(abs(item['sourceTimeSeconds']-g['time'])<=.1 for g in case['groups']) for item in unmatched)
            all_cells.append({'id':case['id'],'recordingId':case['recordingId'],'rate':cell['rate'],'detector':name,
                'tokens':len(tokens),'scoredSeconds':3,'gestures':gestures,'guards':guards,'unmatched':unmatched,'duplicates':duplicates})
    metrics={}
    for name in ['decoded','historical','rise','support']:
        metrics[name]={str(rate):summarize([c for c in all_cells if c['detector']==name and c['rate']==rate]) for rate in [44100,48000]}
    selected=next((name for name in ['rise','support'] if all(eligible(m) for m in metrics[name].values())),None)
    per_source={}
    for source in sorted(set(c['recordingId'] for c in all_cells)):
        per_source[source]={name:{str(rate):summarize([c for c in all_cells if c['recordingId']==source and c['detector']==name and c['rate']==rate]) for rate in [44100,48000]} for name in metrics}
    parity={}
    for name in metrics:
        differences=[]
        for ident in cases:
            a=next(c for c in all_cells if c['id']==ident and c['rate']==44100 and c['detector']==name)
            b=next(c for c in all_cells if c['id']==ident and c['rate']==48000 and c['detector']==name)
            differences.append({'id':ident,'tokenCount44100':a['tokens'],'tokenCount48000':b['tokens'],
                'matchedParity':[g['matched'] for g in a['gestures']]==[g['matched'] for g in b['gestures']],
                'falseGuard44100':sum(len(g['falseCandidates']) for g in a['guards']),
                'falseGuard48000':sum(len(g['falseCandidates']) for g in b['guards']),
                'matchedAnchorTimingDeltaMs':[(x['errorMs']-y['errorMs']) for x,y in zip(a['gestures'],b['gestures']) if x['matched'] and y['matched']]})
        parity[name]=differences
    save(WORK/'development/scores.json',{**proof,'developmentExecutionProof':proof,
        'candidateStreamSealSha256':hashlib.sha256(seal_path.read_bytes()).hexdigest(),
        'metrics':metrics,'perSource':per_source,'cells':all_cells,'sourceRateParity':parity,
        'selectedCandidate':selected,'qualificationStatus':'NOT_EXECUTED',
        'stopReason':None if selected else 'NO_DEVELOPMENT_CANDIDATE_PASSES_FIXED_SAFETY_AND_RECALL_GATES',
        'actualNeuralRuns':browser['result']['actualSessionRunCount'],'truthUsedToModifyCandidates':False})
    print(json.dumps({'selected':selected,'metrics':{name:{rate:{k:m[k] for k in ['truthGestures','matched','recall','duplicates','negativeGuards']} for rate,m in rates.items()} for name,rates in metrics.items()}}))

if __name__=='__main__': main()
