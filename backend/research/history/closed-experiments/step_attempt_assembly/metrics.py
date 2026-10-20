"""Development-only scoring of sealed observations. Never executes inference."""
from pathlib import Path
from collections import Counter
import json
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'backend/research/step_decoded_sufficiency'))
from metrics import score_scenario, summarize, assignment, gt_key, key, distribution


def score(result, case, rate):
    original = score_scenario(result, case, rate)
    groups, outcomes = case['truth'], result['outcomes']
    matches = [o for o in outcomes if o['verdict'] == 'MATCH']
    physical = assignment(matches, groups)
    counters = dict.fromkeys([
        'unsupportedMatch', 'subsetPhysicalChordMatch', 'doubleAdvanceFromOneTruthGesture',
        'busyPeriodCarryoverAdvance', 'latePublicationCarryoverAdvance', 'crossAttemptObservationReuse',
        'heldPedalAdvance', 'samePitchSustainAdvance', 'sameChordSustainAdvance', 'staleEqualWatermarkAdvance'], 0)
    witnesses = []
    for index, event in enumerate(matches):
        violations = []
        nearby = [g for g in groups if abs(g['time'] * 1000 - event['eventMs']) <= 100]
        nearest = min(nearby, key=lambda g: abs(g['time'] * 1000 - event['eventMs']), default=None)
        if index not in physical:
            violations.append('unsupportedMatch')
        if nearest and set(event['observedPitches']) < set(gt_key(nearest)):
            violations.append('subsetPhysicalChordMatch')
        priors = [o for o in outcomes if o['eventMs'] < event['eventMs']]
        if any(o['lockMs'] <= event['eventMs'] < o['verdictMs'] for o in priors):
            violations.append('busyPeriodCarryoverAdvance')
        if event['lateReceipt'] or any(o['rearmed'] and event['eventMs'] <= o['rearmWatermarkMs'] for o in priors):
            violations += ['latePublicationCarryoverAdvance', 'staleEqualWatermarkAdvance']
        guards = [g for g in case['negativeGuards'] if g['start'] * 1000 <= event['eventMs'] < g['end'] * 1000]
        if any('held' in g['tags'] or 'pedal_sustain' in g['tags'] for g in guards):
            violations.append('heldPedalAdvance')
        if guards:
            violations.append('samePitchSustainAdvance' if len(event['observedPitches']) == 1 else 'sameChordSustainAdvance')
        for v in violations:
            counters[v] += 1
        if violations:
            witnesses.append({'id': case['id'], 'recordingId': case['recordingId'], 'rate': rate,
                'scenario': result['scenario']['name'], 'widthMs': result['widthMs'], 'violations': violations,
                'outcome': event, 'nearestPhysicalTruth': nearest, 'nearbyPhysicalTruth': nearby,
                'boundaryConfounded': event['eventMs'] - case['ownedStartSeconds'] * 1000 < 120,
                'attribution': 'assembly/product counterfactual; boundary-confounded raw output is NOT proof of neural non-detection'})
    counters['doubleAdvanceFromOneTruthGesture'] = original['safety']['doubleAdvanceFromOneTruthGesture']
    counts = Counter(o for event in outcomes for o in event['observationIds'])
    counters['crossAttemptObservationReuse'] = sum(v - 1 for v in counts.values() if v > 1)
    if counters['crossAttemptObservationReuse'] or counters['doubleAdvanceFromOneTruthGesture']:
        witnesses.append({'id': case['id'], 'rate': rate, 'scenario': result['scenario']['name'],
            'violations': [k for k in ['crossAttemptObservationReuse', 'doubleAdvanceFromOneTruthGesture'] if counters[k]],
            'outcomes': outcomes})
    extra = []
    for event in outcomes:
        near = min(groups, key=lambda g: abs(g['time'] * 1000 - event['eventMs']), default=None)
        physical_pitches = set(gt_key(near)) if near and abs(near['time'] * 1000 - event['eventMs']) <= 100 else set()
        extra.append(len(event['observationIds']) - len(event['observedPitches'])
            + len(set(event['observedPitches']) - physical_pitches))
    return {**original, 'assemblySafety': counters, 'assemblyDangerousWitnesses': witnesses,
        'extraObservationsPerAttempt': extra}


def main():
    work = ROOT / 'backend/data/work/step_attempt_assembly/development-v1'
    evidence = json.loads((work / 'development-output.json').read_text())
    truth = json.loads((ROOT / 'backend/research/reports/step_decoded_sufficiency_v1/truth.json').read_text())
    plan = json.loads((ROOT / 'backend/research/step_attempt_assembly/development-plan.json').read_text())
    cases = {c['id']: c for c in truth['cases']}
    candidates = []
    for trial in evidence['trials']:
        rows = [score(s, cases[cell['id']], cell['rate']) for cell in trial['cells'] for s in cell['scenarios']]
        counters = {k: sum(r['assemblySafety'][k] for r in rows) for k in plan['safetyCounters']}
        summaries = {str(rate): summarize([r for r in rows if r['rate'] == rate]) for rate in [44100, 48000]}
        witnesses = [w for r in rows for w in r['assemblyDangerousWitnesses']]
        bach_probe = trial['mandatoryBachProbe']
        bach_unsafe = any(o['verdict'] == 'MATCH' for p in bach_probe for o in p['outcomes'])
        candidates.append({'widthMs': trial['widthMs'], 'baselineOnly': trial['widthMs'] == 35,
            'safety': counters, 'mandatoryBachProbe': bach_probe, 'mandatoryBachUnsafe': bach_unsafe,
            'assemblySafetyByRate': {str(rate): {k: sum(r['assemblySafety'][k] for r in rows if r['rate'] == rate) for k in plan['safetyCounters']} for rate in [44100, 48000]},
            'assemblySafetyBySource': {source: {k: sum(r['assemblySafety'][k] for r in rows if r['recordingId'] == source) for k in plan['safetyCounters']}
                for source in sorted(set(r['recordingId'] for r in rows))},
            'eligible': trial['widthMs'] != 35 and not any(counters.values()) and not bach_unsafe,
            'corroboratedIntendedAcceptances': sum(s['acceptedIntendedAttempts'] for s in summaries.values()),
            'summaries': summaries, 'perSource': {source: {str(rate): summarize([r for r in rows if r['recordingId'] == source and r['rate'] == rate])
                for rate in [44100, 48000]} for source in sorted(set(r['recordingId'] for r in rows))},
            'dangerousWitnesses': witnesses, 'rows': rows,
            'extraObservationsPerAttempt': distribution([v for r in rows for v in r['extraObservationsPerAttempt']])})
    eligible = sorted([c for c in candidates if c['eligible']], key=lambda c: (-c['corroboratedIntendedAcceptances'], c['widthMs']))
    selected = eligible[0]['widthMs'] if eligible else None
    result = {**evidence['developmentExecutionProof'], 'developmentExecutionProof': evidence['developmentExecutionProof'],
        'stage': 'EXPOSED_DEVELOPMENT_ONLY_NOT_HOLDOUT', 'candidateBudget': plan['candidateHsMs'], 'candidates': candidates,
        'selectedHMs': selected, 'selectionReason': 'lexicographic safety-zero, maximum corroborated intended acceptances, shortest H' if eligible else 'No declared non-baseline candidate satisfies every zero-danger development gate',
        'qualificationStatus': 'NOT_STARTED', 'actualNewStepNeuralModelRuns': 0,
        'disposition': 'DEVELOPMENT_CANDIDATE_SELECTED_PENDING_PROSPECTIVE_QUALIFICATION' if eligible else 'STEP_ACOUSTIC_ATTEMPT_ASSEMBLY_NOT_ESTABLISHED'}
    with (work / 'development-scores.json').open('x') as f:
        json.dump(result, f, indent=2, allow_nan=False)
        f.write('\n')
    print(json.dumps({'selectedHMs': selected, 'candidates': [{k: c[k] for k in ['widthMs', 'eligible', 'safety', 'corroboratedIntendedAcceptances']} for c in candidates]}))


if __name__ == '__main__':
    main()
