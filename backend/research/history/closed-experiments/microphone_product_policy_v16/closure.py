"""V16 metadata closure only; does not execute counterfactual policy functions."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = 'backend/research/microphone_product_policy_v16/'
OUT = ROOT / 'backend/research/reports/microphone_product_policy_v16'
REPORT = 'backend/research/reports/microphone_product_policy_v16/'
START = '2384dbb79895c23c7aaf4725fcadac8a6ebb4649'
BRANCH = 'codex/customer-web-delivery-boundary'
sys.path.insert(0, str(ROOT / 'backend/research/step_paced_lifecycle_v12'))
from audit import github


def now():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()


def load(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def save(name, value):
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as file:
        json.dump(value, file, indent=2, allow_nan=False)
        file.write('\n')


def verify():
    if git('merge-base', START, 'HEAD') != START:
        raise RuntimeError('START_NOT_ANCESTOR')
    changed = sorted(set(git('diff', '--name-only', START).splitlines()
                         + git('ls-files', '--others', '--exclude-standard').splitlines()))
    if any(not p.startswith((HERE, REPORT)) for p in changed):
        raise RuntimeError('OUT_OF_SCOPE_CHANGE')
    baseline = load('historical-raw-identities.json')['files']
    frozen = load('policy-research-freeze.json')
    for item in baseline + frozen['files']:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('HISTORICAL_OR_FROZEN_MUTATION:' + item['path'])
    return changed, len(baseline)


def assess():
    changed, history_count = verify()
    step, continuous, complete = (load(n) for n in ('step-policy-results.json', 'continuous-projection-results.json', 'analysis-complete.json'))
    product, research = (load(n) for n in ('product-vitest.json', 'research-tests-v2.json'))
    if product['numFailedTests'] or product['numPendingTests'] or research['failed']:
        raise RuntimeError('LOCAL_TEST_FAILURE')
    if complete['analysisExecutions'] != 1 or any(complete['execution'].values()):
        raise RuntimeError('EXECUTION_ACCOUNTING')
    def scenario_rows(name):
        return [{'rate': r['rate'], 'ordinal': r['attemptOrdinal'], 'target': r['expected'],
                 'physicalTruth': r['physicalTruth'], 'observed': r['acousticObserved'], 'P0': r['P0'], 'P1': r['P1']}
                for r in step['attempts'] if r['scenarioId'] == name]
    answers = {
        '1_V15Immutable': True,
        '2_zeroExecution': complete['execution'],
        '3_P0ReproducesV15': step['P0V15Parity'],
        '4_P1CorrectChord': scenario_rows('correct_chord'),
        '5_P1PostReadyRepeat': scenario_rows('post_ready_repeat'),
        '6_P1ExtraChordTone': {'meaning': 'MICROPHONE_EXTRA_NONBLOCKING_BY_DESIGN', 'rows': scenario_rows('extra_chord_tone')},
        '7_P1MissingChordTone': scenario_rows('missing_chord_tone'),
        '8_P1WrongSemitone': scenario_rows('wrong_semitone'),
        '9_P1WrongOctave': step['P1FalseAccepts'],
        '10_everyP1MatchPhysicallySupported': not bool(step['P1FalseAccepts']),
        '11_unconditionalSubsetSafe': not bool(step['P1FalseAccepts']),
        '12_P2ThresholdOrOctaveHeuristicInvented': False,
        '13_rearmStillRequired': 'YES: source timestamps at/before retirement cannot become a second C4 attempt despite late callbacks, repeated IDs or coverage MATCH. Old generation cannot complete new attempt. Synthetic actual-runtime tests independently verify temporal fencing; immutable source identity is a producer contract, not a newly implemented runtime ID ledger.',
        '14_fixedMicrophoneCooldownSelected': False,
        '15_ContinuousExtraOwnership': 'Residual observations must be finalized and owned as EXTRA; completion rejects unresolved reservations/residuals. No finalizer rerun or rewrite.',
        '16_currentWrongExtraPaths': {'live': 'Only finalized MATCHED/MISSING expected-note green/red. WRONG groups may carry red MISSING strikes. No direct WRONG/EXTRA observation badge or live counter.',
            'completionDialog': 'No evaluation/count/numeric score props',
            'review': 'Final extras.length shown as Extra playing; target/MATCHED/MISSING/NOT_REACHED counts and expected-note colors. No separate wrong-observation count.',
            'score': 'No current deterministic overall performance score or numerical accuracy formula found in inspected path; NOT_COMPARABLE.',
            'savedPerformance': 'In-memory completed evaluation; durable saved-media API does not upload/persist that evaluation or scores.'},
        '17_microphoneExtraReliableForStrongPhysicalErrorClaim': 'NOT_ESTABLISHED. Ownership/finality is deterministic, acoustic physical-key inference is not. Public microphone capability remains closed.',
        '18_existingCompletedAcousticEvidenceSufficient': 'YES_FOR_CATEGORY_ONLY_PROJECTION: all 36 correlated counterfactual ledgers from 3 clips x 2 rates, sealed provenance checked. Controller completion is inventoried but excluded before analysis: full publication array was not retained, only count 11.',
        '19_C1Changes': continuous['overall'],
        '20_remainingEvidenceRequirements': continuous['futureEvidenceNeeded'],
        '21_internalModelQualityMetricsPreserved': continuous['modelQuality'],
        '22_productionModified': False,
        '23_freshHoldoutTouched': False,
        '24_capabilitiesClosed': True,
        '25_CI': 'ACTUAL_GITHUB_QUERY_ONLY_LOCAL_TESTS_ARE_NOT_CI'
    }
    assessment = {
        'phase': 'MICROPHONE_PRODUCT_POLICY_V16_ZERO_NEURAL', 'createdAt': now(), 'startingHead': START,
        'label': 'EXPOSED_PRODUCT_POLICY_RESEARCH_ONLY_NOT_QUALIFICATION',
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START, 'ahead': 0, 'behind': 0,
            'cleanWorktreeBeforeEdits': True, 'fetchFirst': True},
        'requiredAnswers': answers, 'historicalResearchFilesRawUnchanged': history_count,
        'productionDiff': [], 'historicalDiff': [], 'changedFilesAtAssessment': changed,
        'freezeProof': load('remote-policy-freeze-proof.json'), 'analysisBoundary': complete,
        'V15HistoricalDisposition': 'STEP_ROBUST_A_V15_V13_PACED_REPLAY_COMPLETE_EXACT_SET_RECOGNITION_BLOCKER_REMAINS',
        'prospectiveCorrection': 'V15_EXACT_SET_BLOCKER_DOES_NOT_BY_ITSELF_PROVE_NEW_ACOUSTIC_READOUT_IS_REQUIRED',
        'stepOverall': step['overall'], 'stepByRate': step['byRate'], 'wrongOctaveFalseAccepts': step['P1FalseAccepts'],
        'stepDisposition': step['disposition'], 'unconditionalCoveragePolicy': step['unconditionalCoveragePolicy'],
        'continuousOverall': continuous['overall'], 'continuousByRate': continuous['byRate'], 'continuousDisposition': continuous['disposition'],
        'continuousInterpretationLimitation': 'Diagnostic category-item reduction is not implemented score improvement, lower model FP, physical-user-error validation, or acoustic qualification.',
        'retirement': 'REARM_REQUIRED_FIXED_COOLDOWN_DURATION_NOT_YET_ESTABLISHED',
        'productionStepMicrophonePolicy': 'NOT_YET_FROZEN_NOT_QUALIFIED',
        'newModelOrReadoutRequired': 'NOT_PROVEN_BY_EXACT_SET_BLOCKER_ALONE',
        'localVerification': {'productFiles': len(product['testResults']), 'productTestsPassed': product['numPassedTests'],
            'productTestsFailed': product['numFailedTests'], 'researchTestsPassed': research['passed'],
            'staticVerification': load('local-verification.json')},
        'execution': complete['execution'],
        'capabilities': {'Continuous': 'MODEL_NOT_VALIDATED', 'STEP': 'ATTEMPT_ANALYZER_NOT_VALIDATED', 'productionMicrophone': False, 'D4': False},
        'scientificWinner': 'NOT_CLAIMED', 'candidateSelected': False, 'qualificationStarted': False,
        'nextAllowedPhase': 'INDEPENDENT_AUDIT_ONLY_NEW_AUTHORIZATION_REQUIRED_FOR_POLICY_OR_READOUT_DEVELOPMENT'
    }
    save('assessment.json', assessment)
    lines = ['# V16 Microphone Product Policy Research', '', assessment['label'], '',
        '## STEP', '', step['disposition'], '',
        'P0 reproduces actual V15/V13 exact-set verdicts on all 34 frozen attempts. P1 changes only set coverage; no production runtime or later target progression is changed.', '',
        '| Policy / rate | True accept | False reject | True reject | False accept |', '|---|---:|---:|---:|---:|']
    for rate in step['byRate']:
        for policy in ('P0', 'P1'):
            row = rate[policy]
            lines.append(f"| {policy} / {rate['rate']} | {row['TRUE_ACCEPT']} | {row['FALSE_REJECT']} | {row['TRUE_REJECT']} | {row['FALSE_ACCEPT']} |")
    lines += ['', 'Truth criterion here is required-target physical support (subset), not MIDI exact-key-set ground truth.',
        'P1 recovers correct chords and paced repeats, and intentionally accepts physical/acoustic extras. But wrong-octave target [52,56] is not supported by physical [56,64] even though acoustic [52,56,64,68] covers it.',
        'This first-class wrong-octave false accept blocks unconditional microphone coverage MATCH. No production microphone verdict policy is qualified; no P2 or uncertainty classifier is invented.', '',
        '## Temporal Identity', '',
        'Rearm remains required independently of pitch leniency. Same-target C4 tests reject old/equal timestamps, delayed duplicate receipts and old target-generation identities. No fixed microphone cooldown is selected.', '',
        '## Continuous', '', continuous['disposition'], '',
        'All 36 fully publication-linked completed acoustic counterfactual ledgers are projected, over three clips/two rates. A controller completion is inventoried but prospectively excluded because only publication count 11, not the publication array, was retained. No replacement data or inference is used.',
        'C0/C1 preserve all owners, finality, matched/missing strikes and stored timing. C1 maps finalized WRONG/EXTRA to POSSIBLE_UNMATCHED_ACOUSTIC only for microphone.', '',
        f"Diagnostic strong-negative category items: {continuous['overall']['C0StrongNegativeCategoryItems']} -> {continuous['overall']['C1StrongNegativeCategoryItems']}. This is not a unique user-error count, score formula or evidence of improved model precision.",
        'Target strike recall, expected-chord completeness and matched timing are exactly unchanged. Overall numerical score is NOT_COMPARABLE: no current deterministic score/accuracy formula exists in the inspected completion/review/save path.',
        'Current live annotations are finalized MATCHED green and MISSING red. WRONG contributes indirectly through missing expected strikes; no direct live WRONG/EXTRA observation badge is wired. Review displays extras.length as Extra playing. Completion dialog has no evaluation/score input. Durable media-take saving does not save the completed evaluation.',
        'Keep internal EXTRA: it closes residual ownership/finality. Downgrade acoustic physical-key claims rather than deleting ownership. Current exposed evidence supports projection mechanics, not real-device reliability or a production policy.', '',
        '## Boundaries', '',
        'All neural/model/session/Worker/decoder/PCM/acoustic-rerun/fresh-holdout counters are zero. V3-V15 and historical Continuous evidence remain unchanged. No production changes.',
        'V15 exact-set blocker remains historically valid, but does not alone prove a new acoustic readout is required. Shared Robust remains shared.',
        'No P2, tuning, cooldown duration, uncertainty classifier, new model, production policy, UI change or microphone enablement.',
        'Local tests are not GitHub CI; actual remote status is recorded separately. STOP for independent audit.', '']
    with (OUT / 'assessment.md').open('x', encoding='utf-8', newline='\n') as file:
        file.write('\n'.join(lines))
    print(json.dumps({'step': step['disposition'], 'continuous': continuous['disposition'], 'historicalFiles': history_count}))


def receipt():
    _, history_count = verify()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if head != remote or git('rev-parse', 'origin/' + BRANCH) != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    save('remote-evidence-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'remoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': git('diff', '--name-only', START, head).splitlines(),
        'productionDiff': [], 'historicalDiff': [], 'historicalResearchFilesRawUnchanged': history_count,
        'evidenceHashes': {n: sha256((OUT / n).read_bytes()).hexdigest() for n in
            ('policy-research-freeze.json', 'step-policy-results.json', 'continuous-projection-results.json', 'assessment.json')},
        'execution': load('analysis-complete.json')['execution'], 'github': github(head),
        'receiptPlacement': 'Additive receipt follows evidence commit; final receipt HEAD fetched and queried separately in closeout.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assessment']:
        assess()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    elif sys.argv[1:] == ['verify']:
        changed, count = verify()
        print(json.dumps({'historicalFilesUnchanged': count, 'productionDiff': [], 'changedFiles': changed,
                          'github': github(git('rev-parse', 'HEAD'))}))
    else:
        raise SystemExit('Only metadata assessment/receipt/verify; no analysis, model, decoder or PCM execution.')
