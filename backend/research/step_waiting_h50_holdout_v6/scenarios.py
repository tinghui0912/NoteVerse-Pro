"""Freeze only the already-declared v3 target/counterfactual and causal rules."""
from contracts import *


def counterfactual(pitches, kind):
    values = sorted(set(pitches)); highest = values[-1]
    if kind == 'extra_chord_tone': return values[:-1]
    if kind == 'missing_chord_tone': return sorted(values + [next(p for p in range(21,109) if p not in values)])
    distance = 1 if kind == 'wrong_semitone' else 12
    replacement = next(p for p in sorted([highest-distance, highest+distance]) if 21 <= p <=108 and p not in values)
    return sorted(values[:-1] + [replacement])


def main():
    require_protocol()
    cases = read(OUT / 'audio-bound-cases.json')['cases']; scenarios = []
    def add(name, family, targets, expectation, control=None, empirical=True):
        case = cases[family]; source = case['originalTruthCase']; first = source['gestures'][0]['onsetMs']
        item = {'scenarioId': name, 'family': family, 'audioBoundCaseId': case['audioBoundCaseId'],
            'targetPitchSets': targets, 'expectation': expectation, 'physicalTruthGestureIds': [g['gestureId'] for g in source['gestures']],
            'inputEligibleAfterOriginalSourceMs': source['guard']['startMs'] if 'guard' in source else first-150,
            'schedule': control or {'kind': 'ordinary'}, 'HMs': 50,
            'physicalMetadataOpportunities': 1 if empirical else None,
            'actualValidCausalDenominator': 'NOT_MEASURED',
            'causalValidityGate': 'Actual READY and event > exclusive watermark required; busy/late lifecycle facts must be established from real production trace. No fabricated READY or changed physical times.',
            'sourcePcmMayChange': False, 'physicalTimesMayChange': False,
            'futureTraceOwner': 'ACTUAL_PRODUCTION_StepPracticeRuntime_ONLY'}
        scenarios.append(item)
    pitch = lambda f: cases[f]['originalTruthCase']['gestures'][0]['normalizedPitchSet']
    add('correct_single', 'correct_single', [pitch('correct_single')], 'MATCH_ON_FULL_PHYSICAL_SUPPORT')
    add('correct_chord', 'correct_chord', [pitch('correct_chord')], 'MATCH_ON_FULL_PHYSICAL_SUPPORT')
    for kind in ('wrong_semitone','wrong_octave','missing_chord_tone','extra_chord_tone'):
        add(kind, 'correct_chord', [counterfactual(pitch('correct_chord'), kind)], 'MUST_NOT_MATCH')
    for family in ('same_pitch_sustain','same_chord_sustain'):
        add(family, family, [pitch(family)], 'NO_NEW_NOTE_ON_NO_MATCH_IN_FROZEN_GUARD')
    for family in ('single_busy_retrigger','chord_busy_retrigger'):
        add(family, family, [pitch(family),pitch(family)], 'SECOND_PHYSICAL_GESTURE_MUST_NOT_QUEUE_OR_ADVANCE',
            {'kind': 'busy', 'analysisHoldMs': 1000, 'inheritedResearchHoldContract': 'step_waiting_topology_v3/prepare_pcm.py',
             'mandatoryPrecondition': 'Second physical gesture occurs while actual attempt is CAPTURING/ANALYZING/RESET; otherwise topology NOT_EVALUABLE, not PASS.'})
    for name in ('post_ready_repeat', 'match_followed_by_next_target'):
        add(name, 'post_ready_repeat', [pitch('post_ready_repeat')]*2, 'DISTINCT_POST_READY_ATTEMPTS_DISTINCT_MATCHES',
            {'kind':'ordinary','precondition':'Second physical gesture strictly after actual next READY; otherwise NOT_EVALUABLE.'})
    triple = cases['multiple_wrong_then_correct']['originalTruthCase']['gestures']
    add('multiple_wrong_then_correct', 'multiple_wrong_then_correct', [triple[-1]['normalizedPitchSet']]*3,
        'MISMATCH_MISMATCH_MATCH_ONLY_IF_ALL_THREE_ACTUALLY_READY_ELIGIBLE')
    full = cases['partial_then_full']['originalTruthCase']['gestures'][-1]['normalizedPitchSet']
    add('partial_then_full', 'partial_then_full', [full]*2, 'MISMATCH_THEN_MATCH_FRESH_POST_READY_ATTEMPT')
    add('mismatch_same_target_rearm', 'partial_then_full', [full]*2, 'NO_CROSS_ATTEMPT_ACCUMULATION')
    for name in ('busy_period_physical_input','late_publication'):
        add(name, 'single_busy_retrigger', [pitch('single_busy_retrigger')]*2, 'NO_RETIRED_INPUT_CARRYOVER',
            {'kind':name, 'analysisHoldMs':1000, 'publicationDelayMs':1000 if name=='late_publication' else 0,
             'retirement':'Use actual physically captured-through watermark at rearm; event identity unchanged.'})
    add('rearm_equality', 'correct_single', [pitch('correct_single')], 'EQUALITY_IS_INELIGIBLE',
        {'kind':'exclusive_boundary','watermarkOriginalSourceMs':cases['correct_single']['originalTruthCase']['gestures'][0]['onsetMs'],
         'tier':'Architecture boundary witness; never counts as independent empirical physical safety denominator.'}, False)
    add('pre_ready_ignored', 'correct_single', [pitch('correct_single')], 'PRE_WATERMARK_INPUT_NEVER_REBINDS',
        {'kind':'pre_ready','armOriginalSourceMs':cases['correct_single']['originalTruthCase']['gestures'][0]['onsetMs']+1000})
    add('post_ready_eligible', 'correct_single', [pitch('correct_single')], 'STRICTLY_POST_READY_CAN_OPEN', {'kind':'ordinary'})
    scorer_path = ROOT / 'backend/research/step_waiting_h50_holdout_v3/scorer-contract.json'; scorer = read(scorer_path)
    value = {'source': 'EXACT_V3_COUNTERFACTUALS_AND_SCORER_NO_ACOUSTIC_OUTPUT_USED', 'scorerContractSha256':digest(scorer_path.read_bytes()),
        'HMs':50, 'capacity':1, 'attemptAssembly':scorer['assembly'], 'eligibility':scorer['eligibility'],
        'scenarios':scenarios, 'totalScenarios':len(scenarios), 'qualifiedSourceRates':[44100,48000],
        'safetyCounters':scorer['safetyCounters'], 'safetyGate':scorer['safetyGate'],
        'denominatorDefinitions': 'For each mandatory family count only actual valid causal trials with unambiguous independent physical support. Metadata opportunities alone never PASS; 0/0 NOT_EVALUABLE.',
        'usabilityDefinitions':scorer['usability'], 'latencyDefinitions':scorer['latencies'], 'uxSlo':'NOT_DEFINED',
        'retryClassifier':'RETRY_CLASSIFIER_NOT_IMPLEMENTED_NO_TOO_QUIET_INVENTION',
        'StageAAccess':'Only opaque audio_only/jobs.json plus PCM/FIR/model/ORT. This truth/target/scenario file is Stage B only after acoustic seal verification.',
        'safetyCountersMeasured':'NOT_MEASURED', 'usabilityMetrics':'NOT_MEASURED', 'latencyMetrics':'NOT_MEASURED',
        'newNeuralRuns':0}
    save(OUT / 'scenario-manifest.json', value)
    print({'scenarios':len(scenarios),'safetyCounters':'NOT_MEASURED','newNeuralRuns':0})


if __name__ == '__main__': main()
