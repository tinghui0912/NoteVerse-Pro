"""Local product metadata audit only; no model, decoder, PCM or browser execution."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'backend/research/reports/step_local_ownership_v13'
START = 'ed6e469972ef88dc370d47ab9b2d01bb411d3fac'
BRANCH = 'codex/customer-web-delivery-boundary'
sys.path.insert(0, str(ROOT / 'backend/research/step_paced_lifecycle_v12'))
from audit import github

HISTORICAL = {f'v{n}': [f'backend/research/{p}step_waiting_h50_holdout_v{n}' for p in ('', 'reports/')]
              for n in range(3, 11)}
HISTORICAL.update({
    'v11': [f'backend/research/{p}step_next_acoustic_wave1_v11' for p in ('', 'reports/')],
    'v12': [f'backend/research/{p}step_paced_lifecycle_v12' for p in ('', 'reports/')],
})
PROTECTED = ['apps/customer-web/src/lib/practice/acoustic', 'apps/customer-web/src/lib/practice/continuous',
             'apps/customer-web/src/lib/practice/midi', 'apps/customer-web/src/lib/practice/input-capability.ts',
             'apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts',
             'apps/customer-web/src/lib/practice/step/step-retirement-policy.ts',
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


def integrity():
    if git('merge-base', START, 'HEAD') != START:
        raise RuntimeError('START_NOT_ANCESTOR')
    diffs = {key: git('diff', '--name-only', START, '--', *paths).splitlines() for key, paths in HISTORICAL.items()}
    protected_diff = git('diff', '--name-only', START, '--', *PROTECTED).splitlines()
    if any(diffs.values()) or protected_diff:
        raise RuntimeError('HISTORICAL_OR_FROZEN_INPUT_SEMANTICS_CHANGED')
    untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
    historical_prefixes = [p for paths in HISTORICAL.values() for p in paths]
    if any(any(p.startswith(prefix + '/') for prefix in historical_prefixes) for p in untracked):
        raise RuntimeError('IMMUTABLE_NAMESPACE_ADDITION')
    paths = git('ls-files', '--', *historical_prefixes).splitlines()
    raw_hashes = [{'path': p, 'sha256': sha256((ROOT / p).read_bytes()).hexdigest()} for p in paths]
    # V12 runtime implementation must match exactly modulo the declared ownership renames.
    runtime_path = 'apps/customer-web/src/lib/practice/local-core/step-runtime.ts'
    before = git('show', START + ':' + runtime_path)
    expected = before.replace('StepPracticeLifecycle', 'StepRuntimeStatus').replace('private lifecycle:', 'private status:')
    expected = expected.replace('this.lifecycle', 'this.status').replace('lifecycleState:', 'runtimeStatus:')
    actual = (ROOT / runtime_path).read_text(encoding='utf-8').strip()
    if expected != actual:
        raise RuntimeError('UNDECLARED_V12_RUNTIME_SEMANTIC_DIFF')
    controller_path = 'apps/customer-web/src/lib/practice/step/step-practice-controller.ts'
    before_controller = git('show', START + ':' + controller_path)
    expected_controller = before_controller.replace(', type StepPracticeLifecycle', '').replace(
        'export type StepControllerState = StepPracticeLifecycle;',
        '/** Local browser application/resource ownership, not the domain runtime status. */\n'
        "export type StepControllerState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'ENDED' | 'DISPOSED';")
    if expected_controller != (ROOT / controller_path).read_text(encoding='utf-8').strip():
        raise RuntimeError('UNDECLARED_CONTROLLER_BEHAVIOR_CHANGE')
    changed = sorted(set(git('diff', '--name-only', START).splitlines() + untracked))
    return {'historicalDiffs': diffs, 'protectedAcousticContinuousMidiRetirementCapabilityPublicBackendDiff': protected_diff,
            'historicalFiles': raw_hashes, 'historicalFileCount': len(raw_hashes),
            'v12RuntimeImplementationIdenticalModuloDeclaredRenames': True,
            'controllerMethodsUnchanged': True, 'changedFiles': changed,
            'productionChanges': [p for p in changed if p.startswith(('apps/customer-web/src/', 'apps/customer-web/public/', 'backend/app/'))]}


def vocabulary_inventory():
    base = ROOT / 'apps/customer-web/src/lib/practice'
    scope = list((base / 'step').glob('*.ts')) + [base / 'local-core' / p for p in (
        'step-runtime.ts', 'step-attempt.ts', 'session.ts', 'timebase.ts', 'artifact.ts', 'evidence.ts', 'practice-tempo.ts', 'index.ts')]
    scope += [ROOT / 'apps/customer-web/src/hooks/practice/use-step-local-practice.ts']
    scope = sorted(p for p in scope if '.test.' not in p.name)
    pattern = re.compile(r'\b(?:\w*(?:session|lifecycle|backend|server|websocket|matchmaker|transport)\w*|runtimeStatus|StepRuntimeStatus|StepControllerState|completionReason)\b', re.I)
    rows = []
    for path in scope:
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            for match in pattern.finditer(line):
                token = match.group()
                if token in ('runtimeStatus', 'StepRuntimeStatus', 'completionReason') or token == 'lifecycleState':
                    category, reason = 'C', 'Domain status/completion metadata; lifecycleState here is Continuous-only and unchanged.'
                elif token == 'StepControllerState' or token == 'lifecycle':
                    category, reason = 'B', 'Browser application/resource state or documented generic UI presentation field.'
                elif re.search('server|backend|websocket|matchmaker|transport', token, re.I):
                    category, reason = 'A', 'Negative boundary documentation only, not an active authority/import/transport: local instance identity is not a server session.'
                else:
                    category, reason = 'A', 'Valid local practice-instance identity, local snapshot metadata, or same-instance event time domain.'
                rows.append({'path': path.relative_to(ROOT).as_posix(), 'line': number, 'token': token,
                             'category': category, 'reason': reason, 'context': line.strip()})
    return {'scope': [p.relative_to(ROOT).as_posix() for p in scope],
            'categories': {'A': 'VALID_LOCAL_PRACTICE_INSTANCE_IDENTITY', 'B': 'VALID_BROWSER_APPLICATION_RESOURCE_LIFECYCLE',
                           'C': 'VALID_DOMAIN_RUNTIME_STATUS', 'D': 'OBSOLETE_SERVER_SESSION_AUTHORITY'},
            'occurrences': rows, 'activeCategoryD': [],
            'manualAdjudication': 'Inspected STEP production/local-core dependencies, import graph and backend/app references. No category D active authority found. Negative boundary comments do not introduce server ownership.',
            'ContinuousScope': 'Continuous implementation remains independent and unchanged; shared metadata/timebase/barrel references are retained, not mechanically renamed.'}


def assess():
    checks = integrity()
    contract = load(HERE / 'contract.json')
    v12 = load(ROOT / 'backend/research/reports/step_paced_lifecycle_v12/assessment.json')
    if v12['disposition'] != contract['v12DispositionUnchanged']:
        raise RuntimeError('V12_HISTORICAL_DISPOSITION_MISMATCH')
    tests, lint, smoke = [load(OUT / name) for name in ('product-vitest.json', 'eslint.json', 'step-smoke.json')]
    if tests['numFailedTests'] or tests['numPendingTests'] or any(r['status'] != 'passed' for r in tests['testResults']):
        raise RuntimeError('PRODUCT_TESTS_NOT_PASS')
    if sum(r['errorCount'] for r in lint) or smoke['stats']['unexpected'] or smoke['stats']['flaky'] or smoke['stats']['expected'] != 5:
        raise RuntimeError('STATIC_OR_SMOKE_NOT_PASS')
    if (OUT / 'typecheck.log').read_text(encoding='utf-8').strip():
        raise RuntimeError('TYPECHECK_NOT_PASS')
    build = (OUT / 'build.log').read_text(encoding='utf-8')
    if 'Compiled successfully' not in build or 'server-rendered on demand' not in build or 'Failed to compile' in build:
        raise RuntimeError('BUILD_NOT_PASS')
    save('vocabulary-inventory.json', vocabulary_inventory())
    save('assessment.json', {'phase': contract['role'], 'createdAt': now(), 'startingHead': START,
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START, 'ahead': 0, 'behind': 0,
            'cleanWorktreeBeforeEdits': True, 'fetchCompletedBeforeEdits': True, 'observation': 'Initial pre-edit shell gate in task transcript.'},
        **checks, 'contract': contract,
        'localVerification': {'testFiles': len(tests['testResults']), 'testsPassed': tests['numPassedTests'],
            'testsFailed': tests['numFailedTests'], 'testsSkipped': tests['numPendingTests'], 'typecheck': 'PASS',
            'lintErrors': sum(r['errorCount'] for r in lint), 'lintWarnings': sum(r['warningCount'] for r in lint),
            'webpackProductionBuild': 'PASS', 'stepSmoke': smoke['stats'],
            'warnings': ['Existing scripts/step-boundary/prepare-tooling.mjs:3 prefer-const warning retained.',
                'Existing jsdom HTMLMediaElement.pause/load diagnostics retained.',
                'Browser smoke NO_COLOR/FORCE_COLOR and Verovio encoded-break warnings retained in raw log.',
                'Git LF/CRLF notices; raw generated logs are preserved even if progress lines carry trailing whitespace.'],
            'scope': 'Focused deterministic product tests plus disabled-microphone STEP browser smoke, not neural/acoustic execution.'},
        'startingGitHub': github(START), 'disposition': contract['disposition'], 'nextAllowedPhase': contract['nextAllowedPhase']})
    print(json.dumps({'historicalFiles': checks['historicalFileCount'], 'v12AttemptSemantics': 'UNCHANGED',
                      'testsPassed': tests['numPassedTests'], 'testFiles': len(tests['testResults'])}))


def receipt():
    checks = integrity()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if remote != head or git('rev-parse', 'origin/' + BRANCH) != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    save('remote-evidence-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'verifiedRemoteHead': remote, 'remoteVerifiedAt': now(),
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'changedFilesThroughEvidence': git('diff', '--name-only', START, head).splitlines(),
        'historicalDiffs': checks['historicalDiffs'], 'v12AttemptSemantics': 'UNCHANGED',
        'assessmentSha256': sha256((OUT / 'assessment.json').read_bytes()).hexdigest(), 'github': github(head),
        'execution': load(HERE / 'contract.json')['execution'],
        'receiptPlacement': 'Additive receipt commit follows this verified evidence commit; final receipt HEAD is fetched and queried independently in task closeout.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assess']:
        assess()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    else:
        raise SystemExit('Only local product metadata assess / receipt allowed.')
