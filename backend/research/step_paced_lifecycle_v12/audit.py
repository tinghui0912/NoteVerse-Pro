"""Product-contract evidence only. No acoustic execution, PCM, model or decoder imports."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
from urllib.request import Request, urlopen
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'backend/research/reports/step_paced_lifecycle_v12'
START = '387149c974a782489a8a0780b6eb2c4f362ff3ca'
BRANCH = 'codex/customer-web-delivery-boundary'
HISTORICAL = {
    **{f'v{n}': [f'backend/research/{p}step_waiting_h50_holdout_v{n}' for p in ('', 'reports/')]
       for n in range(3, 11)},
    'v11': [f'backend/research/{p}step_next_acoustic_wave1_v11' for p in ('', 'reports/')],
}
PROTECTED = ['apps/customer-web/src/lib/practice/acoustic', 'apps/customer-web/src/lib/practice/continuous',
             'apps/customer-web/src/lib/practice/midi', 'apps/customer-web/src/lib/practice/input-capability.ts',
             'apps/customer-web/public', 'backend/app']


def now():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as file:
        json.dump(value, file, indent=2, ensure_ascii=True, allow_nan=False)
        file.write('\n')


def github(head):
    credential = subprocess.check_output(['git', 'credential', 'fill'], cwd=ROOT,
        input='protocol=https\nhost=github.com\n\n', text=True)
    token = next(line[9:] for line in credential.splitlines() if line.startswith('password='))
    def get(suffix):
        url = 'https://api.github.com/repos/tinghui0912/NoteVerse-Pro/' + suffix
        with urlopen(Request(url, headers={'User-Agent': 'NoteVerse-v12-product-audit',
            'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'}), timeout=60) as response:
            return json.load(response)
    combined = get('commits/' + head + '/status')
    statuses = get('commits/' + head + '/statuses?per_page=100')
    runs = get('actions/runs?head_sha=' + head + '&per_page=100')
    return {'head': head, 'queriedAt': now(), 'combinedState': combined['state'], 'statuses': statuses,
            'workflow_runs': runs['workflow_runs'], 'workflowRunTotalCount': runs['total_count'],
            'ciInterpretation': 'NOT CI PASS' if not statuses and not runs['total_count']
            else 'ACTUAL_GITHUB_RESULTS_ONLY_LOCAL_TESTS_ARE_NOT_CI'}


def audit():
    if git('merge-base', START, 'HEAD') != START:
        raise RuntimeError('START_NOT_ANCESTOR')
    diffs = {key: git('diff', '--name-only', START, '--', *paths).splitlines() for key, paths in HISTORICAL.items()}
    protected_diff = git('diff', '--name-only', START, '--', *PROTECTED).splitlines()
    if any(diffs.values()) or protected_diff:
        raise RuntimeError('HISTORICAL_OR_PROTECTED_PATH_CHANGED')
    untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
    if any(any(p.startswith(prefix + '/') for prefix in paths) for p in untracked for paths in HISTORICAL.values()):
        raise RuntimeError('HISTORICAL_NAMESPACE_ADDITION')
    history_files = git('ls-files', '--', *(p for paths in HISTORICAL.values() for p in paths)).splitlines()
    historical_hashes = [{'path': p, 'sha256': sha256((ROOT / p).read_bytes()).hexdigest()} for p in history_files]
    changed = sorted(set(git('diff', '--name-only', START).splitlines() + untracked))
    return {'historicalDiffs': diffs, 'protectedAcousticContinuousMidiCapabilityPublicBackendDiff': protected_diff,
            'historicalFileCount': len(historical_hashes), 'historicalFileRawHashes': historical_hashes,
            'changedFilesAtAssessment': changed,
            'productionChanges': [p for p in changed if p.startswith(('apps/customer-web/src/', 'apps/customer-web/public/', 'backend/app/'))]}


def assess():
    contract = load(HERE / 'product-contract.json')
    tests, lint, smoke = (load(OUT / name) for name in ('product-vitest.json', 'eslint.json', 'step-smoke.json'))
    if tests['numFailedTests'] or tests['numPendingTests'] or any(row['status'] != 'passed' for row in tests['testResults']):
        raise RuntimeError('PRODUCT_TESTS_NOT_PASS')
    if any(row['errorCount'] for row in lint) or smoke['stats']['unexpected'] or smoke['stats']['flaky'] or smoke['stats']['expected'] != 5:
        raise RuntimeError('STATIC_OR_SMOKE_NOT_PASS')
    if (OUT / 'typecheck.log').read_text(encoding='utf-8').strip():
        raise RuntimeError('TYPECHECK_NOT_PASS')
    build = (OUT / 'build.log').read_text(encoding='utf-8')
    if 'Compiled successfully' not in build or 'server-rendered on demand' not in build or 'Failed to compile' in build:
        raise RuntimeError('BUILD_NOT_PASS')
    v11 = load(ROOT / 'backend/research/reports/step_next_acoustic_wave1_v11/assessment.json')
    if v11['disposition'] != 'EVALUATION_INTEGRITY_BLOCKED':
        raise RuntimeError('V11_HISTORICAL_DISPOSITION_CHANGED')
    evidence = audit()
    assessment = {'phase': 'STEP_PACED_LIFECYCLE_V12', 'createdAt': now(), 'startingHead': START,
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START, 'ahead': 0, 'behind': 0,
            'cleanWorktreeBeforeEdits': True, 'fetchCompletedBeforeEdits': True,
            'observation': 'Initial shell gate in task transcript; subsequent files are V12 changes.'},
        **evidence, 'contract': contract, 'v11HistoricalDisposition': v11['disposition'],
        'localVerification': {'testFiles': len(tests['testResults']), 'testsPassed': tests['numPassedTests'],
            'testsFailed': tests['numFailedTests'], 'testsSkipped': tests['numPendingTests'],
            'typecheck': 'PASS', 'fullEslintErrors': sum(r['errorCount'] for r in lint),
            'fullEslintWarnings': sum(r['warningCount'] for r in lint),
            'fullNextWebpackProductionBuild': 'PASS', 'stepSmoke': smoke['stats'],
            'scope': 'Focused STEP/local-core/MIDI/hooks/presentation/architecture/capability tests, NOT full acoustic Vitest/research execution.',
            'warnings': ['Existing scripts/step-boundary/prepare-tooling.mjs:3 prefer-const warning retained.',
                'jsdom reports unimplemented HTMLMediaElement.pause/load in existing recording-preview tests.',
                'Initial build: native SWC blocked by Windows Application Control, Next used WASM bindings; final build uses cached WASM.',
                'Smoke: NO_COLOR/FORCE_COLOR warnings and Verovio encoded-break layout warnings retained in log.',
                'Git autocrlf LF-to-CRLF notices on edited text files.'],
            'docker': 'NOT_RUN_NOT_REQUIRED_FOR_PRODUCT_ONLY_CHANGE'},
        'startingGitHub': github(START),
        'disposition': 'STEP_PACED_LIFECYCLE_V12_PRODUCT_CONTRACT_ESTABLISHED_ACOUSTIC_BAKEOFF_NOT_STARTED',
        'nextAllowedPhase': 'INDEPENDENT_V12_PRODUCT_CONTRACT_AUDIT_ONLY_NO_AUTOMATIC_BAKEOFF'}
    save('assessment.json', assessment)
    print(json.dumps({'status': assessment['disposition'], 'tests': assessment['localVerification'],
        'historicalFiles': evidence['historicalFileCount']}, indent=2))


def receipt():
    audit()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if remote != head or git('rev-parse', 'origin/' + BRANCH) != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    save('remote-evidence-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'verifiedRemoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': git('diff', '--name-only', START, head).splitlines(),
        'assessmentSha256': sha256((OUT / 'assessment.json').read_bytes()).hexdigest(),
        'historicalDiffs': audit()['historicalDiffs'], 'github': github(head),
        'receiptPlacement': 'Additive receipt commit follows this remotely verified evidence commit. Final receipt HEAD is fetched and queried separately in task closeout.',
        'execution': load(HERE / 'product-contract.json')['execution']})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assess']:
        assess()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    else:
        raise SystemExit('Only product metadata assess / receipt commands are permitted.')
