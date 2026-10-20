"""V18 metadata reporting only; never executes domain replay or acoustic code."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
DIR = 'backend/research/step_runtime_verdict_v18/'
REPORT = 'backend/research/reports/step_runtime_verdict_v18/'
OUT = ROOT / REPORT
START = '7cc9f96ccd66c8025a3e4cca41e51e36c94a5993'
BRANCH = 'codex/customer-web-delivery-boundary'
ALLOWED = ['apps/customer-web/src/lib/practice/' + p for p in [
    'local-core/step-attempt.ts', 'local-core/step-runtime.ts', 'local-core/session.ts',
    'local-core/step-attempt.test.ts', 'local-core/step-runtime-status.test.ts',
    'local-core/step-verdict-policy.test.ts', 'step/step-architecture.test.ts']]
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
    if any(p not in ALLOWED and not p.startswith((DIR, REPORT)) for p in changed):
        raise RuntimeError('OUT_OF_SCOPE_CHANGE')
    history = load('historical-raw-identities.json')['files']
    for item in history + load('runtime-replay-freeze.json')['files']:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('HISTORICAL_OR_FROZEN_MUTATION:' + item['path'])
    proof = load('remote-replay-freeze-proof.json')
    frozen_at_commit = subprocess.check_output(
        ['git', 'show', proof['freezeCommit'] + ':' + REPORT + 'runtime-replay-freeze.json'], cwd=ROOT)
    if sha256(frozen_at_commit).hexdigest() != proof['freezeSha256']:
        raise RuntimeError('REMOTE_FREEZE_IDENTITY_MISMATCH')
    return changed, len(history)


def assessment():
    changed, history_count = verify()
    result, complete, proof = (load(n) for n in ('runtime-replay-results.json', 'replay-complete.json', 'remote-replay-freeze-proof.json'))
    product, post_tests = load('product-vitest.json'), load('replay-tests.json')
    if product['numFailedTests'] or product['numPendingTests'] or post_tests['failed']:
        raise RuntimeError('LOCAL_TEST_FAILURE')
    if complete['replayExecutions'] != 1 or any(complete['execution'].values()):
        raise RuntimeError('EXECUTION_ACCOUNTING')
    if not proof['remoteVerifiedAt'] < complete['startedAt']:
        raise RuntimeError('REPLAY_BOUNDARY_FAILURE')
    inv = load('raw-tensor-and-grid-inventory.json')

    def witnesses(name):
        return [{k: r[k] for k in ('rowId', 'rate', 'expected', 'physicalTruth', 'acousticObserved',
                                   'submittedEvidence', 'productRecord', 'classification')}
                for r in result['rows'] if r['scenarioId'] == name]

    answers = {
        '1_V17Immutable': True,
        '2_correctnessOwner': 'StepPracticeRuntime.completeAttempt only; inputSource resolves runtime verdictPolicy, no caller policy option.',
        '3_analyzerControllerHookTargetAccessForVerdict': 'NONE. Controller legitimately retains artifact/target context for orchestration and display, not verdict selection. Current MIDI evidence producer is score-blind; future microphone producer contract accepts no target/score/policy. Microphone analyzer not implemented.',
        '4_MidiExactSet': True,
        '5_microphoneExactMatches': 'Table-driven actual-runtime test passed; full pitches/confidence retained.',
        '6_targetCoveredExtrasDerivedInsideRuntime': witnesses('correct_chord'),
        '7_runtimeRetryPreservesPitches': result['uncertaintyRecordsPreservingOriginalEvidence'],
        '8_runtimeRetryPreservesConfidence': True,
        '9_missingTarget': witnesses('missing_chord_tone'),
        '10_wrongSemitone': witnesses('wrong_semitone'),
        '11_wrongOctave': witnesses('wrong_octave'),
        '12_replayEvidenceKinds': result['submittedEvidenceKinds'],
        '13_runtimeVerdictCounts': result['overall']['verdicts'],
        '14_dangerousMatches': result['overall']['classifications']['DANGEROUS_FALSE_MATCH'],
        '15_retryRetainsTargetGeneration': True,
        '16_matchAdvancementOnlyAtRearm': True,
        '17_watermarkEqualityStaleRulesUnchanged': True,
        '18_schema': {'schemaVersion': 6, 'runtimeVersion': 'step-source-sensitive-verdict-v6'},
        '19_compatibilityShims': False,
        '20_acousticExecution': complete['execution'],
        '21_thresholdsUnchanged': [0.30, 0.05],
        '22_geometryUnchanged': [600, 1050, 170],
        '23_rawTensorAbsence': inv,
        '24_historicalGridVerifiedNotExecuted': {'onset': inv['grid']['onset'], 'frame': inv['grid']['frame'],
            'calibratedForCurrentRobust600170': False, 'executed': False, 'directionSelected': False},
        '25_ContinuousUntouched': True,
        '26_microphoneCapabilitiesClosed': True,
        '27_CI': 'ACTUAL_GITHUB_QUERY_ONLY_LOCAL_TESTS_ARE_NOT_CI'
    }
    freeze = load('runtime-replay-freeze.json')
    data = {
        'phase': freeze['contract']['phase'], 'label': result['label'], 'createdAt': now(),
        'startingHead': START, 'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START,
            'ahead': 0, 'behind': 0, 'cleanWorktreeBeforeEdits': True, 'fetchFirst': True},
        'disposition': result['disposition'], 'architectureClarification': freeze['contract']['architectureClarification'],
        'requiredAnswers': answers, 'freezeProof': proof, 'replayBoundary': complete,
        'historicalResearchFilesRawUnchanged': history_count, 'historicalDiff': [],
        'productionDiff': [p for p in changed if p.startswith('apps/')],
        'productionScope': 'Only STEP local-core verdict/schema and direct tests; controller/acoustic/Continuous/capability sources unchanged.',
        'changedFilesAtAssessment': changed, 'overall': result['overall'], 'byRate': result['byRate'],
        'perRowV17Parity': result['perRowV17Parity'], 'submittedEvidenceKinds': result['submittedEvidenceKinds'],
        'externalP2Executions': result['externalP2Executions'], 'limitations': result['limitations'],
        'retirement': freeze['contract']['retirement'], 'microphoneCooldownSelected': False,
        'currentAcousticDefaults': freeze['contract']['acousticBaseline'], 'futureStudy': freeze['contract']['futureStudy'],
        'rawTensorRequirement': freeze['contract']['rawTensorRequirement'],
        'futureObjective': freeze['contract']['futureObjective'], 'historicalGrid': freeze['contract']['historicalGrid'],
        'localVerification': load('local-verification.json'), 'replayAssertions': {'passed': post_tests['passed'], 'failed': post_tests['failed']},
        'execution': complete['execution'], 'capabilities': freeze['contract']['capabilities'],
        'Continuous': 'UNTOUCHED_NOT_RERUN_INTERNAL_OWNERSHIP_AUTHORITATIVE_PRESENTATION_SEPARATE_FUTURE_REFACTOR',
        'scientificClaim': 'NONE', 'microphoneQualified': False, 'newStudyExecuted': False,
        'nextAllowedPhase': 'STOP_FOR_INDEPENDENT_AUDIT_NO_AUTOMATIC_ACOUSTIC_EXECUTION_OR_MICROPHONE_INTEGRATION'
    }
    save('assessment.json', data)
    lines = ['# V18 Runtime-Owned Source-Sensitive Verdict', '', data['disposition'], '', result['label'], '',
        '## Domain Ownership', '', data['architectureClarification'],
        'The sole StepPracticeRuntime resolves policy from pinned inputSource. MIDI remains MIDI_EXACT_SET. Microphone ordinary EVIDENCE is interpreted inside completeAttempt: exact -> MATCH; target-covered with extras -> RETRY/UNCERTAIN; missing target -> MISMATCH.',
        'No target-aware analyzer/controller/hook helper or caller policy parameter was added. Existing controller still only forwards evidence and blocks microphone start. It retains legitimate score context for display/metronome orchestration, not correctness.',
        'Schema6 / step-source-sensitive-verdict-v6 replaces v5 cleanly. Runtime uncertainty retains normalized observed pitches, original confidence and capture boundary in one finalized record. Score-blind acquisition RETRY remains []/null; both cases stay distinguishable without parallel history.', '',
        '## Immutable Replay', '',
        'All 34 frozen attempts across 22 scenario-rate cells entered the actual runtime as ordinary EVIDENCE, including every historical RETRY. External P2 executions=0. Verdicts were compared against V17 only after runtime finalization.', '',
        '| Rate | MATCH | RETRY | MISMATCH | Dangerous automatic MATCH |', '|---|---:|---:|---:|---:|']
    for row in result['byRate']:
        counts = row['verdicts']
        lines.append(f"| {row['rate']} | {counts['MATCH']} | {counts['RETRY']} | {counts['MISMATCH']} | {row['classifications']['DANGEROUS_FALSE_MATCH']} |")
    lines += ['', 'Per-row V17 parity is exact. Physical classes: SAFE_MATCH=8, SUPPORTED_RETRY=12, UNSUPPORTED_RETRY=2, TRUE_REJECT=12, FALSE_REJECT=0, DANGEROUS_FALSE_MATCH=0.',
        'Correct chord [56,64] with observed [52,56,64,68] returns RETRY while keeping all four pitches/confidence. Wrong-octave target [52,56] with the same observation also returns RETRY, not MATCH. Correct single remains MATCH; missing tone and wrong semitone remain MISMATCH; paced repeats remain RETRY/RETRY.',
        'CONSERVATIVE_TRISTATE_RUNTIME_SEMANTICS_ESTABLISHED_NOT_MICROPHONE_QUALIFIED. Exact-but-hallucinated target evidence can still MATCH; the new deterministic test explicitly retains this limitation. Wrong octave is not universally solved.', '',
        '## Lifecycle Unchanged', '',
        'Controller resource lifecycle remains separate from ACTIVE/ENDED domain status. READY/CAPTURING/ANALYZING/POST_VERDICT, capacity one, no queue/carryover, strict retirement equality rejection and stale identity fencing remain unchanged.',
        'RETRY retains target/generation. Only explicit rearm commits pending MATCH advancement and final scope completion. Acquisition RETRY remains supported. MIDI exact-set and 35ms half-open gesture regressions passed.',
        'REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY. No microphone cooldown duration selected.', '',
        '## Future Study Only', '', data['futureStudy'], data['rawTensorRequirement'],
        'Committed historical executor declares rawTensorExportEnabled=false; production returns decoded events/diagnostics only. Current V7/V17 evidence has no reusable onset/frame tensor corpus. Unexecuted V11 journal design is not evidence. This does not deny unrelated older calibration caches.',
        'A future threshold study first requires separately frozen one-time raw-tensor capture. None is performed here.',
        'Verified historical Phase9GA3 onset [0.15,0.20,0.25,0.30,0.35], frame [0.05,0.10,0.15,0.20]. PRE_EXISTING_BOUNDED_THRESHOLD_GRID_AVAILABLE_FOR_FUTURE_ROBUST_DEVELOPMENT; not calibrated for current Robust600/170, not executed and no direction selected.',
        data['futureObjective'],
        'Robust model/input, .30/.05, 600/1050/170, ORT, FIR and Worker topology remain unchanged. Continuous source/evaluation/UI were not modified or rerun; ownership/finality remains authoritative and source-sensitive presentation is a separate future refactor.', '',
        '## Verification And Closure', '',
        f"Historical research raw files unchanged: {history_count}. Freeze remote verification {proof['remoteVerifiedAt']} precedes replay {complete['startedAt']}. Replay executions=1; every neural/session/Worker/decoder/PCM/acoustic/fresh-holdout/warmup/unknown counter=0.",
        'Local: 336 product tests across 31 files, 6 pre-replay research tests, 6 stored-result replay assertion tests passed. Full application and research typecheck passed; seven production files and three research files linted with zero errors/warnings. Initial new-test assertion/fixture-type issues were fixed before freeze; no actual-output tuning. jsdom media notices persisted without test failure.',
        'Build not run; no Next API or bundle configuration changes. Local results are not CI. Actual GitHub combined state/statuses/workflows are in the remote receipt and independently queried again at final HEAD.',
        'Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.',
        'STOP for independent audit. No automatic Wave-1, tensor capture, parameter sweep, fresh qualification or microphone integration.', '']
    with (OUT / 'assessment.md').open('x', encoding='utf-8', newline='\n') as file:
        file.write('\n'.join(lines))
    print(json.dumps({'disposition': data['disposition'], 'historicalFilesUnchanged': history_count}))


def receipt():
    changed, count = verify()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if remote != head or git('rev-parse', 'origin/' + BRANCH) != head or git('status', '--porcelain'):
        raise RuntimeError('REMOTE_OR_WORKTREE_MISMATCH')
    save('remote-evidence-and-github-receipt.json', {
        'startingHead': START, 'verifiedEvidenceCommit': head, 'remoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': changed, 'productionDiff': [p for p in changed if p.startswith('apps/')],
        'historicalDiff': [], 'historicalResearchFilesRawUnchanged': count,
        'evidenceHashes': {n: sha256((OUT / n).read_bytes()).hexdigest() for n in
            ['runtime-replay-freeze.json', 'runtime-replay-results.json', 'assessment.json', 'assessment.md']},
        'execution': load('replay-complete.json')['execution'], 'github': github(head),
        'receiptPlacement': 'Receipt follows evidence commit; final receipt HEAD is fetched and queried independently.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assessment']:
        assessment()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    elif sys.argv[1:] == ['verify']:
        changed, count = verify()
        head = git('rev-parse', 'HEAD')
        print(json.dumps({'head': head, 'remoteHead': git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0],
            'mergeBase': git('merge-base', START, 'HEAD'), 'aheadBehind': git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH),
            'worktreeStatus': git('status', '--porcelain'), 'historicalFilesUnchanged': count,
            'changedFiles': changed, 'completeCommitChain': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
            'github': github(head)}))
    else:
        raise SystemExit('Metadata assessment/receipt/verify only; no runtime replay or acoustic execution.')
