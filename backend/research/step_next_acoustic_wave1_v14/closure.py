"""Failure closure metadata only. Never repairs or resumes the blocked V14 preflight."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'backend/research/reports/step_next_acoustic_wave1_v14'
HERE = Path(__file__).resolve().parent
START = 'e15a449100294a00e4c3329efd5e7297cd4d260b'
BRANCH = 'codex/customer-web-delivery-boundary'
sys.path.insert(0, str(ROOT / 'backend/research/step_paced_lifecycle_v12'))
from audit import github

HISTORY = {f'v{n}': [f'backend/research/{p}step_waiting_h50_holdout_v{n}' for p in ('', 'reports/')]
           for n in range(3, 11)}
HISTORY.update({name: [f'backend/research/{p}{folder}' for p in ('', 'reports/')]
    for name, folder in [('v11', 'step_next_acoustic_wave1_v11'), ('v12', 'step_paced_lifecycle_v12'), ('v13', 'step_local_ownership_v13')]})


def now():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(name, value):
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as file:
        json.dump(value, file, indent=2, allow_nan=False)
        file.write('\n')


def integrity():
    if git('merge-base', START, 'HEAD') != START:
        raise RuntimeError('START_NOT_ANCESTOR')
    diffs = {name: git('diff', '--name-only', START, '--', *paths).splitlines() for name, paths in HISTORY.items()}
    production = git('diff', '--name-only', START, '--', 'apps/customer-web/src', 'apps/customer-web/public', 'backend/app').splitlines()
    if production or any(diffs.values()):
        raise RuntimeError('PROTECTED_HISTORY_OR_PRODUCTION_CHANGED')
    paths = git('ls-files', '--', *(p for rows in HISTORY.values() for p in rows)).splitlines()
    hashes = [{'path': p, 'sha256': sha256((ROOT / p).read_bytes()).hexdigest()} for p in paths]
    untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
    prefixes = [p for rows in HISTORY.values() for p in rows]
    if any(any(p.startswith(prefix + '/') for prefix in prefixes) for p in untracked):
        raise RuntimeError('HISTORICAL_NAMESPACE_ADDITION')
    return {'productionDiff': production, 'historicalDiffs': diffs, 'historicalFileCount': len(hashes), 'historicalRawHashes': hashes,
            'changedFilesAtClosure': sorted(set(git('diff', '--name-only', START).splitlines() + untracked))}


def assessment():
    failure = load(OUT / 'pre-freeze-tooling-failure.json')
    if any(failure['execution'].values()) or failure['exitCode'] != 1:
        raise RuntimeError('FAILURE_ACCOUNTING_INVALID')
    if (OUT / 'static-graph.json').stat().st_size != 0:
        raise RuntimeError('FAILED_STDOUT_ARTIFACT_CHANGED')
    checks = integrity()
    drafts = [{'path': p.relative_to(ROOT).as_posix(), 'sha256': sha256(p.read_bytes()).hexdigest(), 'status': 'DRAFT_NOT_FROZEN_NOT_AUTHORIZED_FOR_EXECUTION'}
              for p in (HERE / 'core.mjs', HERE / 'contract.json', HERE / 'inspect_onnx.py')]
    answers = {
        '1_startingRemoteExactV13Head': True,
        '2_v3ThroughV13HistoricalPathsUnchanged': True,
        '3_v11UntouchedNotExecuted': True,
        '4_protocolFrozenBeforeNeural': 'NO_FREEZE_CREATED_NO_NEURAL_EXECUTION',
        '5_outputsSealedBeforeScoring': 'NOT_STARTED_NO_OUTPUT_OR_SCORING',
        '6_robustAParity': 'NOT_STARTED',
        '7_sharedRawStreamAB': 'NOT_EXECUTED_ZERO_STREAMS_DRAFT_RULE_ONLY',
        '8_originalStaticAdmissibility': 'NOT_ESTABLISHED_STATIC_TOOLING_DEPENDENCY_BLOCKED',
        '9_correctChordRepairBothRates': 'NOT_MEASURED',
        '10_postReadyRepeatRepair': 'NOT_MEASURED',
        '11_nextTargetRepairWithV13Rearm': 'NOT_MEASURED',
        '12_positiveRegressions': 'NOT_MEASURED',
        '13_dangerousNegatives': 'NOT_MEASURED',
        '14_nonReadyInputIsolation': 'NOT_RUN_IN_V14_PRENEURAL_TESTS_NOT_REACHED',
        '15_oldBusyLateDenominators': 'Excluded from survivor gating in DRAFT only; no frozen/executed scoring and no 0/0 PASS.',
        '16_thresholdsAndH': 'UNCHANGED_PRODUCTION; declared .30/.05, .20/.10, H50 in unexecuted draft; no tuning.',
        '17_rmsFluxTransientSecondOnsetAdded': False,
        '18_broadMetrics': 'NOT_STARTED_NO_PRODUCT_PROXY_OR_METRIC_RENAMING',
        '19_survivorSet': 'NOT_EVALUATED',
        '20_winnerSelected': False,
        '21_freshHoldoutTouched': False,
        '22_capabilitiesClosed': True,
        '23_neuralWorkerSessionCounts': failure['execution'],
        '24_CI': 'Actual GitHub queried separately; no V14 local test PASS claimed.'}
    save('assessment.json', {'phase': 'STEP_ACOUSTIC_WAVE1_V14', 'label': 'DEVELOPMENT_ONLY_NOT_QUALIFICATION',
        'createdAt': now(), 'startingHead': START,
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START, 'ahead': 0, 'behind': 0,
            'cleanWorktreeBeforeEdits': True, 'fetchCompletedBeforeEdits': True, 'evidence': 'Initial pre-edit shell gate in task transcript.'},
        **checks, 'draftSources': drafts, 'failure': failure, 'requiredAnswers': answers,
        'v11Disposition': 'EVALUATION_INTEGRITY_BLOCKED',
        'developmentProtocolFreeze': 'NOT_CREATED', 'remoteFreezeProof': 'NOT_CREATED',
        'LayerA': {'declaredHistoricalJobs': 18, 'declaredHistoricalWindows': 228, 'verifiedInV14': 'NOT_STARTED', 'results': 'NOT_MEASURED'},
        'LayerB': {'declaredHistoricalTakes': 50, 'verifiedInV14': 'NOT_STARTED', 'commonInteriors': 'NOT_CREATED', 'metrics': 'NOT_MEASURED'},
        'plannedRunBudget': 'NOT_ESTABLISHED_NOT_FROZEN', 'actualRunAccounting': failure['execution'],
        'candidateAcousticSeals': 'NOT_CREATED', 'developmentSurvivorSet': 'NOT_EVALUATED',
        'localVerification': {'staticPreflight': 'FAIL_IMPORT_DEPENDENCY', 'v14PortablePathTests': 'NOT_STARTED',
            'v14IntegrityTests': 'NOT_STARTED', 'v13ProductRegression': 'NOT_RERUN_IN_V14', 'typecheck': 'NOT_RUN_IN_V14',
            'reason': 'Mandatory pre-freeze failure STOP takes precedence; no further harness preparation/test execution after failure. Metadata/Git closure only.'},
        'productionCapabilities': {'Continuous': 'MODEL_NOT_VALIDATED', 'STEP': 'ATTEMPT_ANALYZER_NOT_VALIDATED', 'productionMicrophone': False, 'D4': False},
        'scientificDispositionUnchanged': 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',
        'startingGitHub': github(START), 'disposition': failure['disposition'],
        'nextAllowedPhase': 'INDEPENDENT_AUDIT_OF_PREFREEZE_DEPENDENCY_BLOCKER_NEW_AUTHORIZATION_REQUIRED_NO_AUTOMATIC_REPAIR_OR_NEURAL_EXECUTION'})
    print(json.dumps({'disposition': failure['disposition'], 'historicalFiles': checks['historicalFileCount'], 'newNeuralRuns': 0}))


def receipt():
    checks = integrity()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if head != remote or git('rev-parse', 'origin/' + BRANCH) != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    save('remote-failure-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'verifiedRemoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': git('diff', '--name-only', START, head).splitlines(),
        'productionDiff': checks['productionDiff'], 'historicalDiffs': checks['historicalDiffs'],
        'assessmentSha256': sha256((OUT / 'assessment.json').read_bytes()).hexdigest(),
        'execution': load(OUT / 'pre-freeze-tooling-failure.json')['execution'], 'github': github(head),
        'receiptPlacement': 'Additive receipt follows verified failure evidence; final receipt HEAD is fetched and queried independently in task closeout.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assessment']:
        assessment()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    else:
        raise SystemExit('Only stopped-run metadata assessment / receipt allowed; no prepare, retry or execution command exists.')
