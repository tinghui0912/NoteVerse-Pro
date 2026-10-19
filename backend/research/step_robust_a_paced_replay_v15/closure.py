"""Metadata closure only: no model, decoder, audio or historical scoring execution."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'backend/research/reports/step_robust_a_paced_replay_v15'
START = 'a7a49041b88af250272cdec710e0108d6f9bdd63'
BRANCH = 'codex/customer-web-delivery-boundary'
sys.path.insert(0, str(ROOT / 'backend/research/step_paced_lifecycle_v12'))
from audit import github


def now():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()


def load(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def save(name, value):
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as file:
        json.dump(value, file, indent=2, allow_nan=False)
        file.write('\n')


def verify():
    baseline = load('starting-gate-and-integrity.json')
    if git('merge-base', START, 'HEAD') != START:
        raise RuntimeError('START_NOT_ANCESTOR')
    diffs = git('diff', '--name-only', START).splitlines()
    allowed = ('backend/research/step_robust_a_paced_replay_v15/',
               'backend/research/reports/step_robust_a_paced_replay_v15/')
    untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
    if any(not p.startswith(allowed) for p in diffs + untracked):
        raise RuntimeError('OUT_OF_SCOPE_CHANGE')
    for item in baseline['historicalFiles'] + baseline['fixed']:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('HISTORICAL_RAW_BYTES_CHANGED:' + item['path'])
    freeze = load('replay-protocol-freeze.json')
    for item in freeze['files']:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('REPLAY_FREEZE_MUTATION')
    return baseline, sorted(set(diffs + untracked))


def assess():
    baseline, changed = verify()
    results, tests, product = (load(n) for n in ('paced-replay-results.json', 'replay-tests.json', 'product-vitest.json'))
    if tests['failed'] or product['numFailedTests'] or product['numPendingTests']:
        raise RuntimeError('LOCAL_TEST_FAILURE')
    if results['cellsCompleted'] != 22:
        raise RuntimeError('MISSING_REPLAY_CELL')
    negatives = ['wrong_semitone', 'wrong_octave', 'missing_chord_tone', 'extra_chord_tone']
    negative_cells = [c for c in results['cells'] if c['scenarioId'] in negatives]
    answers = {
        '1_v14ImmutableNotResumed': True,
        '2_originalCompletelyExcluded': True,
        '3_decoderBUnexecuted': True,
        '4_allNeuralSessionWorkerCountsZero': results['execution'],
        '5_actualV13Runtime': results['actualRuntime'],
        '6_verdictsRecomputedNotV9Reused': not results['v9VerdictsRead'],
        '7_correctChord': [dict(rate=c['sourceRateHz'], expected=c['expectedSequence'], actual=c['actualSequence'])
                          for c in results['cells'] if c['scenarioId'] == 'correct_chord'],
        '8_correctChordExactAcousticSets': [dict(rate=c['sourceRateHz'], observed=c['traces'][0]['observedMidiPitchSet'])
                          for c in results['cells'] if c['scenarioId'] == 'correct_chord'],
        '9_pacedPostReadyRepeat': [dict(rate=c['sourceRateHz'], sequence=c['actualSequence'])
                          for c in results['cells'] if c['scenarioId'] == 'post_ready_repeat'],
        '10_matchFollowedByNextTarget': [dict(rate=c['sourceRateHz'], classification=c['classification'],
            rearmAdvancements=[t['advancementAtRearm'] for t in c['traces']])
                          for c in results['cells'] if c['scenarioId'] == 'match_followed_by_next_target'],
        '11_lifecycleReframing': 'Old rapid busy/late topology lacked denominators, not observed dangerous failures. V13 deterministic paced isolation and atomic rearm are separate product properties; synthetic pacing supplies READY, not physical causality evidence.',
        '12_remainingRecognitionFailures': results['failedCells'],
        '13_V13_NON_READY_INPUT_ISOLATION': 'LOCAL_DETERMINISTIC_PASS_SEPARATE_FROM_RECOGNITION',
        '14_oldDenominators': results['oldBusyLateDenominators'],
        '15_decoderBNewExecution': load('decoder-b-decision.json')['conclusion'],
        '16_newDecoderOrTuning': False,
        '17_microphoneCooldownSelected': False,
        '18_freshHoldoutTouched': False,
        '19_capabilitiesClosed': True,
        '20_CI': 'LOCAL_TESTING_IS_NOT_CI_QUERY_ACTUAL_GITHUB_SEPARATELY'
    }
    assessment = {
        'phase': 'STEP_ROBUST_A_PACED_REPLAY_V15', 'label': 'DEVELOPMENT_ONLY_NOT_QUALIFICATION',
        'createdAt': now(), 'startingHead': START, 'requiredAnswers': answers,
        'productionDiff': [], 'v3ThroughV14Diffs': [], 'historicalFilesRawUnchanged': len(baseline['historicalFiles']),
        'changedFilesAtAssessment': changed, 'historicalCheckoutNote': 'Git-filter identity plus explicitly pinned raw hashes checked before replay; all recorded raw checkout hashes rechecked unchanged at closure. No normalization/writes to history.',
        'replayProtocolFreeze': load('replay-remote-proof.json'),
        'sourceIdentityEvidence': baseline['fixed'], 'v14': 'V14_NOT_RESUMED_PROTOCOL_DRAFT_SUPERSEDED_BEFORE_FREEZE',
        'v14HistoricalDisposition': 'STEP_ACOUSTIC_WAVE1_V14_EVALUATION_INTEGRITY_BLOCKED',
        'productModelPolicy': 'SHARED_ROBUST_NEURAL_MODEL_FOR_CONTINUOUS_AND_STEP',
        'onlyEvaluatedInterpretation': 'ROBUST_A_CURRENT_CONTROL', 'challengers': [],
        'recognitionReplay': {'scenarios': 11, 'rates': [44100, 48000], 'cells': 22,
            'attempts': sum(len(c['traces']) for c in results['cells']),
            'expectedSequenceCellsSatisfied': sum(c['expectedBehaviorSatisfied'] for c in results['cells']),
            'failedCells': results['failedCells'], 'unsupportedMatchWitnesses': results['unsupportedMatchWitnesses']},
        'negativeExactSetRegression': {'cells': len(negative_cells), 'expectedMismatchesObserved': sum(c['expectedBehaviorSatisfied'] for c in negative_cells),
            'notAGlobalPhysicalSafetyQualification': True},
        'V13_NON_READY_INPUT_ISOLATION': {'status': 'LOCAL_DETERMINISTIC_PASS', 'source': 'product-vitest.json and replay-tests.json',
            'notAcousticRecognitionAccuracy': True},
        'localVerification': {'replayTests': tests['passed'], 'productTestsPassed': product['numPassedTests'],
            'productTestsFailed': product['numFailedTests'], 'productFiles': len(product['testResults']),
            'staticChecks': load('static-verification.json'), 'prefreezeFailuresPreserved': 'prefreeze-tooling-observations.json'},
        'latency': {'productLatency': 'NOT_MEASURED', 'syntheticEpochs': 'REPLAY_DEVICE_ONLY_NOT_MICROPHONE_COOLDOWN_OR_UX_LATENCY',
            'sourceVsPerformanceClockAlignment': 'NOT_CREATED', 'microphoneCooldown': 'NOT_SELECTED'},
        'execution': results['execution'], 'candidateSelected': False, 'developmentSurvivorSelection': 'NOT_PERFORMED',
        'qualificationStarted': False, 'scientificWinner': 'NOT_CLAIMED',
        'capabilities': {'Continuous': 'MODEL_NOT_VALIDATED', 'STEP': 'ATTEMPT_ANALYZER_NOT_VALIDATED',
            'productionMicrophone': False, 'D4': False},
        'nextRecommendationOnly': 'NEW_SCORE_BLIND_ROBUST_READOUT_CANDIDATE_REQUIRED' if results['failedCells'] else 'FRESH_MICROPHONE_QUALIFICATION_DESIGN_REQUIRES_NEW_AUTHORIZATION',
        'futureReadoutConstraints': ['same Robust ONNX/model asset', 'same Worker/session topology', 'same raw onset/frame tensors',
            'no target or score input', 'improve polyphonic/octave exact-set precision without sacrificing legitimate octave/chord pitches',
            'new candidate identity and preregistered mechanism required; no mechanism or thresholds chosen in V15'],
        'disposition': results['disposition'], 'nextAllowedPhase': 'INDEPENDENT_AUDIT_ONLY_NO_AUTOMATIC_READOUT_IMPLEMENTATION_OR_MICROPHONE_INTEGRATION'
    }
    save('assessment.json', assessment)
    lines = ['# V15 Robust A / V13 Paced Recognition Replay', '',
        '`DEVELOPMENT_ONLY_NOT_QUALIFICATION`', '', assessment['disposition'], '',
        'Immutable V7 acoustic evidence only; actual V13 schema5 runtime recomputes all verdicts. No V9 verdicts used.', '',
        '| Scenario | Rate | Actual sequence | Expected satisfied |', '|---|---:|---|---|']
    for c in results['cells']:
        lines.append(f"| {c['scenarioId']} | {c['sourceRateHz']} | {' / '.join(c['actualSequence'])} | {c['expectedBehaviorSatisfied']} |")
    lines += ['', '## Key Diagnosis', '',
        'Lifecycle isolation and atomic MATCH/rearm are independently tested product properties, not recognition repairs.',
        'Old busy/late 0/0 denominators are excluded, never called PASS. Synthetic epochs are not microphone cooldown or device/UX latency.',
        'Incorrect full acoustic sets remain MISMATCH under paced READY. Extras are not filtered; no target-conditioned repair is applied.', '',
        '## Acoustic Witnesses', '']
    for c in results['cells']:
        if c['scenarioId'] in ['correct_chord', 'post_ready_repeat', 'match_followed_by_next_target']:
            lines.append(f"### {c['scenarioId']} / {c['sourceRateHz']}")
            for t in c['traces']:
                lines.append(f"Attempt {t['ordinal'] + 1}: target {t['activeTarget']['attackPitches']}; observed {t['observedMidiPitchSet']}; {t['verdict']}; rearm advancement={t['advancementAtRearm']}.")
            lines.append('')
    lines += ['## Boundaries', '',
        'V14 untouched, not resumed. Original excluded. Decoder A/B execution, model/session/Worker/PCM decode/fresh-holdout counts all zero.',
        'Existing XC2 evidence does not justify decoder B specifically as an extra-pitch repair; not a universal quality claim and geometry differs.',
        'Recommendation only: a new score-blind Robust readout candidate, with a new preregistered exposed-development protocol. No mechanism selected here.',
        'Capabilities remain closed. No qualification or microphone integration. Actual GitHub evidence is separate; local tests are not CI.', '']
    (OUT / 'assessment.md').write_text('\n'.join(lines), encoding='utf-8', newline='\n')
    print(json.dumps({'disposition': results['disposition'], 'historicalFilesUnchanged': len(baseline['historicalFiles'])}))


def receipt():
    verify()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if head != remote or git('rev-parse', 'origin/' + BRANCH) != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    save('remote-evidence-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'verifiedRemoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': git('diff', '--name-only', START, head).splitlines(),
        'productionDiff': [], 'historicalDiff': [],
        'assessmentSha256': sha256((OUT / 'assessment.json').read_bytes()).hexdigest(),
        'replayResultsSha256': sha256((OUT / 'paced-replay-results.json').read_bytes()).hexdigest(),
        'acousticOutputStillExact': '61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1',
        'execution': load('paced-replay-results.json')['execution'], 'github': github(head),
        'receiptPlacement': 'Additive receipt follows evidence commit; final receipt HEAD is independently fetched and queried in closeout.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assessment']:
        assess()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    elif sys.argv[1:] == ['verify']:
        baseline, changed = verify()
        print(json.dumps({'historicalFilesUnchanged': len(baseline['historicalFiles']), 'changedFiles': changed,
                          'productionDiff': [], 'github': github(git('rev-parse', 'HEAD'))}))
    else:
        raise SystemExit('Only assessment/receipt/verify metadata commands exist; no acoustic execution.')
