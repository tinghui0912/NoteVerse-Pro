"""Metadata closure only. Never invokes policy analysis or acoustic execution."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = 'backend/research/step_microphone_tristate_v17/'
REPORT = 'backend/research/reports/step_microphone_tristate_v17/'
OUT = ROOT / REPORT
START = 'e7b98f302431e61b19f3b6886b51ce4f50bb01e7'
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
    history = load('historical-raw-identities.json')['files']
    freeze = load('tristate-policy-freeze.json')
    for item in history + freeze['files']:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('HISTORICAL_OR_FROZEN_MUTATION:' + item['path'])
    proof = load('remote-freeze-proof.json')
    frozen_at_commit = subprocess.check_output(
        ['git', 'show', proof['freezeCommit'] + ':' + REPORT + 'tristate-policy-freeze.json'], cwd=ROOT)
    if sha256(frozen_at_commit).hexdigest() != proof['freezeSha256']:
        raise RuntimeError('COMMITTED_FREEZE_IDENTITY_MISMATCH')
    if proof['freezeSha256'] != sha256((OUT / 'tristate-policy-freeze.json').read_bytes()).hexdigest():
        raise RuntimeError('REMOTE_PROOF_IDENTITY_MISMATCH')
    return changed, len(history)


def assess():
    changed, history_count = verify()
    result, complete, proof = (load(n) for n in ('tristate-results.json', 'analysis-complete.json', 'remote-freeze-proof.json'))
    product, research = (load(n) for n in ('product-vitest.json', 'research-tests.json'))
    if product['numFailedTests'] or product['numPendingTests'] or research['failed']:
        raise RuntimeError('LOCAL_TEST_FAILURE')
    if complete['analysisExecutions'] != 1 or any(complete['execution'].values()):
        raise RuntimeError('EXECUTION_ACCOUNTING')
    if not proof['remoteVerifiedAt'] < complete['startedAt']:
        raise RuntimeError('ANALYSIS_BOUNDARY_FAILURE')
    if result['overall']['classifications']['DANGEROUS_FALSE_MATCH']:
        raise RuntimeError('SAFETY_FAILURE')

    def witnesses(scenario):
        return [{key: r[key] for key in ('rowId', 'rate', 'ordinal', 'expected', 'physicalTruth',
                                         'acousticObserved', 'P0', 'P1', 'P2', 'classification',
                                         'identity', 'productRecord', 'domainTrace')}
                for r in result['rows'] if r['scenarioId'] == scenario]

    burden = result['supportedUniqueUnitBurden']
    answers = {
        '1_V16Immutable': True,
        '2_zeroExecution': complete['execution'],
        '3_productionAlreadySupportsRetryUncertain': True,
        '4_existingVerdictUsedNotInvented': 'Actual schema5 step-paced-attempt-v5 runtime finalized RETRY/UNCERTAIN; no fourth verdict or production change.',
        '5_P2VerdictRows': result['overall']['verdicts'],
        '6_wrongOctave': witnesses('wrong_octave'),
        '7_correctChord': witnesses('correct_chord'),
        '8_postReadyRepeat': witnesses('post_ready_repeat'),
        '9_missingChordTone': witnesses('missing_chord_tone'),
        '10_wrongSemitone': witnesses('wrong_semitone'),
        '11_correctSingle': witnesses('correct_single'),
        '12_dangerousAutomaticMatches': result['overall']['classifications']['DANGEROUS_FALSE_MATCH'],
        '13_uniquePhysicalEvidence': {'units': result['uniquePhysicalEvidenceUnits'],
            'physicalGesturesIgnoringRate': result['distinctPhysicalGesturesIgnoringRate'],
            'recordingIds': result['distinctRecordingIds'], 'multiplicitySum': result['multiplicitySum']},
        '14_supportedUniqueUnitBurden': burden,
        '15_rateGeneralizability': 'NOT_GENERALIZABLE_PRODUCT_RATE',
        '16_persistentRetryRisk': {'classification': result['persistentRetry'], 'decision': result['reopenDecision'],
            'limitation': result['persistentRetryLimitation']},
        '17_automaticNthRetryPromotionInvented': False,
        '18_rearmRequired': result['retirement'],
        '19_fixedMicrophoneCooldownSelected': False,
        '20_modelInputContract': result['modelInputContract'],
        '21_thresholdDefaults': {'onset': 0.30, 'frame': 0.05, 'current': True, 'mutated': False},
        '22_geometryDefaults': {'owned': 600, 'past': 1050, 'future': 170, 'current': True, 'mutated': False},
        '23_reopenRecommendation': result['reopenDecision'],
        '24_futureObjective': load('tristate-policy-freeze.json')['contract']['futureObjective'],
        '25_Continuous': result['Continuous'],
        '26_capabilitiesClosed': True,
        '27_CI': 'ACTUAL_GITHUB_QUERY_ONLY_LOCAL_TESTS_ARE_NOT_CI'
    }
    assessment = {
        'phase': 'STEP_MICROPHONE_CONSERVATIVE_TRISTATE_V17', 'createdAt': now(), 'startingHead': START,
        'label': result['label'], 'disposition': result['disposition'],
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START,
            'ahead': 0, 'behind': 0, 'cleanWorktreeBeforeEdits': True, 'fetchFirst': True},
        'historicalResearchFilesRawUnchanged': history_count, 'productionDiff': [], 'historicalDiff': [],
        'changedFilesAtAssessment': changed, 'freezeProof': proof, 'analysisBoundary': complete,
        'remoteVerifiedBeforeAnalysis': proof['remoteVerifiedAt'] < complete['startedAt'],
        'V16HistoricalDispositions': [
            'STEP_MICROPHONE_V16_NAIVE_REQUIRED_PITCH_COVERAGE_UNSAFE_WRONG_OCTAVE_FALSE_ACCEPT',
            'CONTINUOUS_MICROPHONE_SOURCE_SENSITIVE_PRODUCT_INTERPRETATION_SUPPORTED_FOR_FURTHER_DEVELOPMENT'],
        'prospectiveCorrectionPreserved': 'V15_EXACT_SET_BLOCKER_DOES_NOT_BY_ITSELF_PROVE_NEW_ACOUSTIC_READOUT_IS_REQUIRED',
        'requiredAnswers': answers, 'overall': result['overall'], 'byRate': result['byRate'],
        'counterfactualAttempts': result['counterfactualAttempts'], 'scenarioRateCells': result['scenarioRateCells'],
        'uniquePhysicalEvidenceUnits': result['uniquePhysicalEvidenceUnits'],
        'supportedUniqueUnitBurden': burden, 'burdenByRate': result['burdenByRate'],
        'productRelevantOperatingPointDiagnostics': result['productRelevantOperatingPointDiagnostics'],
        'reopenDecision': result['reopenDecision'], 'currentDefaults': result['baselineUnchanged'],
        'defaultMutation': False, 'modelInputContract': result['modelInputContract'],
        'sharedModelPolicy': 'SHARED_ROBUST_NEURAL_MODEL_FOR_CONTINUOUS_AND_STEP',
        'futureStudyOrder': load('tristate-policy-freeze.json')['contract']['prospectiveStudyOrder'],
        'tuningDirectionSelected': False, 'studyExecutionAuthorized': False,
        'manualEscape': 'Design only: explicit READY-only Continue/Skip remains a user override and skip record, never automatic MATCH. No production copy or control change.',
        'Continuous': result['Continuous'], 'modelQualityDiagnosticsPreserved': True,
        'localVerification': load('local-verification.json'), 'execution': complete['execution'],
        'capabilities': load('tristate-policy-freeze.json')['contract']['capabilities'],
        'productionMicrophonePolicy': 'NOT_QUALIFIED_NOT_IMPLEMENTED', 'scientificClaim': 'NONE',
        'candidateSelected': False, 'qualificationStarted': False, 'freshHoldoutTouched': False,
        'nextAllowedPhase': 'INDEPENDENT_AUDIT_ONLY_SEPARATE_AUTHORIZATION_AND_FREEZE_REQUIRED_FOR_ANY_ACOUSTIC_STUDY'
    }
    save('assessment.json', assessment)
    lines = ['# V17 Conservative Tristate Policy', '', result['disposition'], '', result['label'], '',
        '## Policy And Runtime', '',
        'P2 uses existing MATCH / MISMATCH / RETRY domain semantics: exact set -> MATCH; proper target coverage with extras -> RETRY/UNCERTAIN; missing target -> MISMATCH. No confidence, octave, timing or decoder heuristic.',
        'Actual current StepPracticeRuntime schema5 / step-paced-attempt-v5 finalized every attempt. RETRY enters POST_VERDICT, retains target/generation and needs explicit rearm. Original observations are retained in sidecars; product RETRY records intentionally assert no observed set.', '',
        '## Counterfactual Rows', '',
        '| Rate | MATCH | RETRY | MISMATCH | Dangerous MATCH |', '|---|---:|---:|---:|---:|']
    for row in result['byRate']:
        v = row['verdicts']
        lines.append(f"| {row['rate']} | {v['MATCH']} | {v['RETRY']} | {v['MISMATCH']} | {row['classifications']['DANGEROUS_FALSE_MATCH']} |")
    lines += ['', 'Correct chord [56,64] with observed [52,56,64,68] becomes RETRY, not a false MISMATCH or automatic MATCH. Both legitimate octave-chord repeats [46,58] also become separate RETRY attempts, with POST_VERDICT and explicit rearm.',
        'Wrong-octave target [52,56] is unsupported by physical [56,64]; P2 returns UNSUPPORTED_RETRY instead of the unsafe P1 MATCH. Missing chord tone and wrong semitone remain MISMATCH; correct single remains MATCH.',
        'Zero dangerous automatic MATCH here is exposed-development support, not universal safety or microphone qualification. Acoustic target hallucination still exists and remains in the diagnostics.', '',
        '## Physical Evidence And Burden', '',
        f"{result['counterfactualAttempts']} counterfactual attempts reduce to {result['uniquePhysicalEvidenceUnits']} exact physical/acoustic rate units, {result['distinctPhysicalGesturesIgnoringRate']} physical gestures ignoring rate, from {len(result['distinctRecordingIds'])} recordings. Full grouping, target views and multiplicities remain in tristate-results.json.",
        f"Among {burden['supportedUniquePhysicalUnits']} supported unique units: MATCH {burden['counts']['MATCH']}, RETRY {burden['counts']['RETRY']}, MISMATCH {burden['counts']['MISMATCH']}. SAFE_AUTO_MATCH_COVERAGE={burden['SAFE_AUTO_MATCH_COVERAGE']}; SUPPORTED_AMBIGUITY_RETRY_RATE={burden['SUPPORTED_AMBIGUITY_RETRY_RATE']}.",
        'NOT_GENERALIZABLE_PRODUCT_RATE: scenario counterfactuals and rate variants are correlated, not independent performances. These are descriptive diagnostics, not population retry rates.',
        result['persistentRetry'], result['persistentRetryLimitation'],
        'Never auto-pass the Nth retry, majority-vote, accumulate/union across attempts or auto-skip. A future manual Continue/Skip must be a distinct user action after READY, not MATCH. No UI changed.', '',
        '## Future Operating Point', '', result['reopenDecision']['recommendation'],
        'The recurrence decision uses the prospectively frozen cross-recording/two-rate rule, not a post-result success threshold. It authorizes a recommendation to design research only, not execution.',
        'Objective: maximize SAFE_AUTO_MATCH_COVERAGE subject to DANGEROUS_TARGET_HALLUCINATION safety, required-target recall, runtime stability and latency.',
        'Prospective order: decoder operating point .30/.05; then owned600/future170 versus historical owned600/future120; new readout only if separately shown necessary. No tuning direction, parameter grid or new mechanism selected.',
        'MODEL_INPUT_CONTRACT_NOT_REOPENED. 16k mono, 29120/1820ms, Robust ONNX and shared model remain unchanged. Decoder A, onset .30, frame .05 and owned600/past1050/future170 all remain current defaults, not a global optimum claim.', '',
        '## Temporal Identity And Continuous', '',
        'REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY. Strict newer-than-watermark eligibility, old identity rejection and no carryover remain intact. No microphone cooldown duration chosen.',
        'V16 Continuous inventory hashes still match. No projection or Continuous acoustic replay was rerun. Internal MATCHED/WRONG/EXTRA ownership/finality remains authoritative. Acoustic WRONG/EXTRA are not physical-key facts. Final review exposes Extra playing; no direct live WRONG/EXTRA badge or deterministic overall score formula exists in the inspected path.',
        'CONTINUOUS_SOURCE_SENSITIVE_PRESENTATION_READY_FOR_SEPARATE_PRODUCT_REFACTOR is a design note only. Raw precision/recall/F1, false-positive onsets/minute, extras and decoder diagnostics must remain; product leniency is not model improvement.', '',
        '## Verification And Stop', '',
        f"Historical research files raw-hash verified unchanged: {history_count}. Production diff empty; all execution counters zero. Freeze remote proof {proof['remoteVerifiedAt']} precedes analysis {complete['startedAt']}.",
        'Local: 24 research tests and 315 product tests across 30 files passed; research typecheck/lint passed. jsdom emitted media pause/load not-implemented notices. Local tests are not GitHub CI; actual status evidence is recorded separately.',
        'V3-V16 historical conclusions remain unchanged. No neural/model/session/Worker/decoder/PCM execution, Continuous projection rerun, fresh holdout, production modification, qualification or microphone enablement.',
        'Capabilities remain Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.',
        'STOP for independent audit. Any future acoustic study requires separate authorization and prospective freeze.', '']
    with (OUT / 'assessment.md').open('x', encoding='utf-8', newline='\n') as file:
        file.write('\n'.join(lines))
    print(json.dumps({'disposition': result['disposition'], 'historicalFiles': history_count,
                      'reopen': result['reopenDecision']['recommendation']}))


def receipt():
    _, count = verify()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if head != remote or git('rev-parse', 'origin/' + BRANCH) != head or git('status', '--porcelain'):
        raise RuntimeError('REMOTE_OR_CLEAN_WORKTREE_MISMATCH')
    save('remote-evidence-and-github-receipt.json', {
        'startingHead': START, 'verifiedEvidenceCommit': head, 'remoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': git('diff', '--name-only', START, head).splitlines(),
        'productionDiff': [], 'historicalDiff': [], 'historicalResearchFilesRawUnchanged': count,
        'evidenceHashes': {n: sha256((OUT / n).read_bytes()).hexdigest() for n in
            ('tristate-policy-freeze.json', 'tristate-results.json', 'assessment.json', 'assessment.md')},
        'execution': load('analysis-complete.json')['execution'], 'github': github(head),
        'receiptPlacement': 'Additive receipt follows evidence commit; final receipt HEAD is fetched and queried independently at closeout.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assessment']:
        assess()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    elif sys.argv[1:] == ['verify']:
        changed, count = verify()
        head = git('rev-parse', 'HEAD')
        print(json.dumps({'head': head, 'remoteHead': git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0],
            'mergeBase': git('merge-base', START, 'HEAD'),
            'aheadBehind': git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH),
            'worktreeStatus': git('status', '--porcelain'), 'historicalFilesUnchanged': count,
            'productionDiff': [], 'changedFiles': changed,
            'completeCommitChain': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
            'github': github(head)}))
    else:
        raise SystemExit('Only metadata assessment/receipt/verify; no policy/model/decoder/PCM execution.')
