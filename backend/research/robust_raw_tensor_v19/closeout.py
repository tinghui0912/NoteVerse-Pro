"""Blocked V19 metadata closure only. No capture, decoder, model or product execution."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = 'backend/research/robust_raw_tensor_v19/'
REPORT = 'backend/research/reports/robust_raw_tensor_v19/'
OUT = ROOT / REPORT
START = '29eb87a05832618cb3dea6fbadebc7822ef1a3eb'
BRANCH = 'codex/customer-web-delivery-boundary'
sys.path.insert(0, str(ROOT / 'backend/research/step_paced_lifecycle_v12'))
from audit import github


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()


def load(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def now():
    return datetime.now(timezone.utc).isoformat()


def save(name, value):
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')


def verify():
    if git('merge-base', START, 'HEAD') != START:
        raise RuntimeError('START_NOT_ANCESTOR')
    changed = sorted(set(git('diff', '--name-only', START).splitlines()
                         + git('ls-files', '--others', '--exclude-standard').splitlines()))
    if any(not p.startswith((HERE, REPORT)) for p in changed):
        raise RuntimeError('PRODUCTION_OR_HISTORICAL_CHANGE')
    prior = ROOT / 'backend/research/reports/step_runtime_verdict_v18'
    baseline = json.loads((prior / 'historical-raw-identities.json').read_text(encoding='utf-8'))['files']
    for item in baseline + json.loads((prior / 'runtime-replay-freeze.json').read_text(encoding='utf-8'))['files']:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('V18_OR_HISTORICAL_RAW_HASH_CHANGED:' + item['path'])
    extra = git('ls-tree', '-r', '--name-only', START, '--',
                'backend/research/step_runtime_verdict_v18',
                'backend/research/reports/step_runtime_verdict_v18').splitlines()
    for p in extra:
        committed = subprocess.check_output(['git', 'show', START + ':' + p], cwd=ROOT)
        if (ROOT / p).read_bytes() != committed:
            raise RuntimeError('V18_BYTES_CHANGED:' + p)
    forbidden = ['capture-protocol-freeze.json', 'remote-capture-permission.json', 'capture-started.json',
                 'tensor-corpus-manifest.json', 'raw-tensor-seal.json', 'baseline-started.json', 'baseline-parity.json']
    if any((OUT / p).exists() for p in forbidden):
        raise RuntimeError('UNEXPECTED_EXECUTION_OR_FREEZE_ARTIFACT')
    return changed, len(baseline), len(extra)


def assessment():
    changed, history, v18 = verify()
    failed = load('pre-freeze-tooling-failure.json')
    preservation = load('input-preservation.json')
    lint = load('research-eslint.json')
    if preservation['totalInputs'] != 228 or preservation['mismatches']:
        raise RuntimeError('INPUT_PRESERVATION_METADATA_FAILURE')
    answers = {
        '1_V18Immutable': True,
        '2_productionUnchanged': True,
        '3_inputsReproducedExactly': {'count': 228, 'mismatches': 0, 'beforeAnyModelLoad': True},
        '4_rates': [44100, 48000], '5_sourceRateJobs': 18,
        '6_modelIdentity': 'Exact size/SHA verified during static asset build; never loaded into ONNX session.',
        '7_runtime': 'ORT1.20.1/WebGPU/no-fallback assets verified and specified in draft; NOT_EXECUTED.',
        '8_ONNXSessionLoads': 0, '9_neuralSessionRuns': 0, '10_hiddenWarmupRuns': 0,
        '11_StageAScoreBlind': 'Raw-only graph checks passed, but StageA NOT_STARTED; no blind execution claim.',
        '12_StageADecoderFree': 'Graph checks passed; decoder calls=0; StageA NOT_STARTED.',
        '13_rawOutputDescriptors': 'NOT_MEASURED_NO_MODEL_OUTPUTS. Synthetic validation covered Float32 shape/finite rejection.',
        '14_canonicalPairBytes': {'specified': 128832, 'syntheticTest': 'PASS', 'actualPairs': 0},
        '15_canonicalCorpusBytes': {'specified': 29373696, 'actual': 0},
        '16_LEIdentities': 'All228 model-input canonical LE hashes recorded; no actual raw tensor hashes exist.',
        '17_remoteRawSealBeforeDecoder': 'NO_RAW_CORPUS_OR_REMOTE_SEAL_CREATED; no decoder access occurred.',
        '18_StageBNeuralRuns': 0, '19_actualProductionDecoderUsed': 'NOT_EXECUTED; draft module imports production implementation.',
        '20_baselineThresholdsExecuted': 'NONE; .30/.05 only specified, not executed.',
        '21_baselineParity': 'NOT_STARTED_NOT_ESTABLISHED',
        '22_alternateThresholdsExecuted': False, '23_directionOrWinnerSelected': False,
        '24_currentDefaults': {'onset': 0.30, 'frame': 0.05, 'unchanged': True},
        '25_geometry': {'owned': 600, 'past': 1050, 'future': 170, 'unchanged': True},
        '26_capabilityEnabled': False, '27_CI': 'ACTUAL_GITHUB_QUERY_ONLY_NOT_LOCAL_TESTING'
    }
    data = {'phase': failed['phase'], 'label': 'EXPOSED_DEVELOPMENT_FOUNDATION_BLOCKED_BEFORE_FREEZE_NOT_QUALIFICATION',
        'createdAt': now(), 'startingHead': START,
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START, 'ahead': 0, 'behind': 0,
            'cleanWorktreeBeforeEdits': True, 'fetchFirst': True,
            'github': {'queriedAt': '2026-10-19T08:29:20.475333+00:00', 'combinedState': 'pending',
                'statuses': [], 'workflow_runs': [], 'ciInterpretation': 'NOT CI PASS'}},
        'disposition': failed['disposition'], 'failure': failed, 'requiredAnswers': answers,
        'historicalPriorToV18RawFilesVerified': history, 'V18FilesExactCommittedBytesVerified': v18,
        'historicalDiff': [], 'productionDiff': [], 'changedFilesAtAssessment': changed,
        'inputPreservation': {'totalCases': 9, 'totalJobs': 18, 'totalInputs': 228, 'mismatches': 0,
            'artifactSha256': sha256((OUT / 'input-preservation.json').read_bytes()).hexdigest()},
        'localVerification': {'preExecutionTests': load('pre-execution-tests.json'),
            'researchTypecheckExitCode': 0, 'researchLintFiles': len(lint),
            'researchLintErrors': sum(r['errorCount'] for r in lint),
            'researchLintWarnings': sum(r['warningCount'] for r in lint),
            'productTests': 'NOT_RUN_STOP_ON_FAILED_PRE_EXECUTION_GATE',
            'localTestingIsNotCI': True},
        'StageA': failed['StageA'], 'StageB': failed['StageB'], 'pcmCodecDecodeRuns': 0,
        'V18DispositionPreserved': 'STEP_V18_RUNTIME_OWNED_SOURCE_SENSITIVE_VERDICT_ESTABLISHED_V17_PARITY_PRESERVED',
        'V18Semantics': {'schemaVersion': 6, 'runtimeVersion': 'step-source-sensitive-verdict-v6',
            'MIDI': 'MIDI_EXACT_SET', 'MICROPHONE': 'MICROPHONE_CONSERVATIVE_TRISTATE',
            'retirement': 'REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY', 'microphoneCooldownSelected': False},
        'currentAcousticDefaultsUnchanged': True, 'historicalThresholdGrid': json.loads((ROOT / HERE / 'contract.json').read_text())['historicalThresholdGrid'],
        'capabilities': {'Continuous': 'MODEL_NOT_VALIDATED', 'STEP': 'ATTEMPT_ANALYZER_NOT_VALIDATED', 'productionMicrophone': False, 'D4': False},
        'freshHoldoutAccess': 0, 'thresholdStudyStarted': False, 'candidateCreated': False,
        'nextAllowedPhase': failed['nextAllowedPhase']}
    save('assessment.json', data)
    text = '''# V19 Raw Tensor Foundation: Blocked Before Freeze

ROBUST_V19_RAW_TENSOR_CAPTURE_INTEGRITY_BLOCKED

## Stop Witness

The pre-execution static test at tests.mjs:79 expected one occurrence of the literal `onsetThreshold: 0.30, frameThreshold: 0.05` in baseline.mjs. It found two: the actual decoder call argument and the result-report metadata field. This is a source-text proxy/test defect, not evidence of two decoder executions.

The failed gate was not bypassed or repaired. Under the requested any-failure STOP rule, V19 stops before protocol freeze, browser creation, model/session loading or any decoder call. All draft harness sources are NOT_ADMITTED_FOR_EXECUTION, not a successful protocol. No V19 rerun is authorized by this report.

## Established Input Facts

All nine frozen cases, both 44100/48000 rates, 18 jobs and 228 inputs were reconstructed using current production QualifiedSourceAdapter and planWindow. Each input is 29120 finite Float32 samples; canonical little-endian SHA matched both V6 input/reference identities and V7 input/window metadata, with zero mismatches. Existing prepared PCM was read; no audio codec decode occurred.

Exact model size/SHA and pinned ORT asset bytes were statically verified. This is not an ONNX session-load or neural execution claim. The raw-only browser/Worker and production baseline decoder import graphs passed their completed checks.

## Not Established

Capture protocol freeze: NOT_CREATED. Raw tensor corpus/seal: NOT_CREATED. Stage A: NOT_STARTED. Stage B: NOT_STARTED. Baseline parity: NOT_ESTABLISHED. Actual raw pairs/bytes: 0/0, not the planned 228/29373696. No reusable current-lineage tensor corpus was produced.

Stage A counters: session loads=0; model runs=0; capture Workers=0; input count executed=0; raw pairs=0; canonical raw bytes=0; decoder runs=0; product verdict runs=0; truth access=0; hidden warmups=0; unknown runs=0.

Stage B counters: neural runs=0; baseline decoder runs=0; alternative-threshold decoder runs=0; product verdict runs=0. No threshold grid, direction, metrics, scoring or winner selection.

## Verification And Boundaries

Pre-execution research tests: 12 passed before the failure, 1 failed, 2 not run. Research TypeScript and lint completed successfully in the same already-issued preflight batch. Product tests were not run after the STOP. Local checks are not CI and the preflight is not PASS.

Production and historical V3-V18 evidence remain unchanged, including runtime schema6 / step-source-sensitive-verdict-v6. MIDI_EXACT_SET, MICROPHONE_CONSERVATIVE_TRISTATE and explicit rearm remain authoritative. No microphone cooldown selected. Continuous and acoustic defaults/model/FIR/ORT/geometry were not modified.

Current decoder A .30/.05 and owned600/past1050/future170 remain defaults. Historical threshold grid remains metadata only, not executed. Capabilities remain Continuous MODEL_NOT_VALIDATED, STEP ATTEMPT_ANALYZER_NOT_VALIDATED, productionMicrophone=false, D4=false. No fresh holdout access.

Actual GitHub statuses/workflows and remote evidence identity are recorded in the additive receipt. No empty checks are called CI PASS.

STOP for independent audit and explicit authorization of a new prospective tooling phase. Do not silently repair/resume V19 or start threshold research.
'''
    with (OUT / 'assessment.md').open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(json.dumps({'disposition': data['disposition'], 'historicalRawFiles': history,
                      'V18Files': v18, 'newNeuralRuns': 0}))


def receipt():
    changed, history, v18 = verify()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if head != remote or git('rev-parse', 'origin/' + BRANCH) != head or git('status', '--porcelain'):
        raise RuntimeError('REMOTE_OR_WORKTREE_MISMATCH')
    save('remote-failure-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'remoteHead': remote, 'remoteVerifiedAt': now(), 'changedFilesThroughEvidence': changed,
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'productionDiff': [], 'historicalDiff': [], 'priorHistoricalRawFilesVerified': history, 'V18CommittedFilesVerified': v18,
        'evidenceHashes': {n: sha256((OUT / n).read_bytes()).hexdigest() for n in
            ['assessment.json', 'assessment.md', 'pre-freeze-tooling-failure.json', 'pre-execution-tests.json', 'input-preservation.json']},
        'github': github(head), 'disposition': 'ROBUST_V19_RAW_TENSOR_CAPTURE_INTEGRITY_BLOCKED',
        'newNeuralRuns': 0, 'decoderRuns': 0,
        'receiptPlacement': 'Additive receipt follows failure-evidence commit; final receipt HEAD fetched and queried independently.'})
    print(head)


if __name__ == '__main__':
    if sys.argv[1:] == ['assessment']:
        assessment()
    elif sys.argv[1:] == ['receipt']:
        receipt()
    elif sys.argv[1:] == ['verify']:
        changed, history, v18 = verify()
        head = git('rev-parse', 'HEAD')
        print(json.dumps({'head': head, 'remoteHead': git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0],
            'mergeBase': git('merge-base', START, 'HEAD'), 'aheadBehind': git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH),
            'worktreeStatus': git('status', '--porcelain'), 'changedFiles': changed,
            'priorHistoricalRawFilesVerified': history, 'V18CommittedFilesVerified': v18,
            'completeCommitChain': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(), 'github': github(head)}))
    else:
        raise SystemExit('Blocked metadata assessment/receipt/verify only; never capture, decode or execute models.')
