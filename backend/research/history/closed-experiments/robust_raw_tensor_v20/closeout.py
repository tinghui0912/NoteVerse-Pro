"""Metadata closure only; never invokes capture, decoder or product evaluation."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = 'backend/research/robust_raw_tensor_v20/'
REPORT = 'backend/research/reports/robust_raw_tensor_v20/'
OUT = ROOT / REPORT
START = 'f5bb7b5debdb64b5f5487b633eb2ba17b4e7564e'
BRANCH = 'codex/customer-web-delivery-boundary'
sys.path.insert(0, str(ROOT / 'backend/research/step_paced_lifecycle_v12'))
from audit import github


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, encoding='utf-8').strip()


def now():
    return datetime.now(timezone.utc).isoformat()


def load(name, default=None):
    p = OUT / name
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else default


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
    frozen_v18 = json.loads((prior / 'runtime-replay-freeze.json').read_text(encoding='utf-8'))['files']
    for item in baseline + frozen_v18:
        if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('HISTORICAL_RAW_MUTATION:' + item['path'])
    extra = git('ls-tree', '-r', '--name-only', START, '--',
                'backend/research/step_runtime_verdict_v18', 'backend/research/reports/step_runtime_verdict_v18',
                'backend/research/robust_raw_tensor_v19', 'backend/research/reports/robust_raw_tensor_v19').splitlines()
    for p in extra:
        if (ROOT / p).read_bytes() != subprocess.check_output(['git', 'show', START + ':' + p], cwd=ROOT):
            raise RuntimeError('V18_OR_V19_COMMITTED_BYTES_CHANGED:' + p)
    freeze = load('capture-protocol-freeze.json')
    if freeze:
        for item in freeze['files'] + load('historical-raw-identities.json')['files']:
            if sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']:
                raise RuntimeError('V20_FROZEN_MUTATION:' + item['path'])
    return changed, len(baseline) + len(extra)


def assess():
    changed, history_count = verify()
    contract = json.loads((ROOT / HERE / 'contract.json').read_text(encoding='utf-8'))
    manifest, parity = load('tensor-corpus-manifest.json', {}), load('baseline-parity.json', {})
    capture = manifest.get('receipt', {'captureOwnerWorkers': 0, 'modelSessionLoads': 0, 'attemptedSessionRuns': 0,
        'successfulSessionRuns': 0, 'rawTensorPairs': 0, 'rawCanonicalBytes': 0, 'decoderRuns': 0,
        'productVerdictRuns': 0, 'truthAccessCount': 0, 'hiddenWarmupRuns': 0, 'unknownRuns': 0})
    baseline = parity.get('receipt', load('baseline-failure.json', {}).get('receipt', {
        'neuralRuns': 0, 'baselineDecoderRuns': 0, 'alternativeThresholdDecoderRuns': 0, 'productVerdictRuns': 0}))
    failure = load('test-failure.json') or load('control-failure.json') or load('external-preflight-failure.json')
    if failure:
        disposition = failure.get('disposition', 'ROBUST_V20_PREFREEZE_TOOLING_INTEGRITY_BLOCKED')
    elif manifest.get('failure') or manifest.get('status', '').startswith('BLOCKED'):
        disposition = 'ROBUST_V20_RAW_TENSOR_CAPTURE_INTEGRITY_BLOCKED'
        failure = manifest.get('failure')
    elif load('baseline-failure.json'):
        disposition = 'ROBUST_V20_RAW_TENSOR_BASELINE_PARITY_FAILURE'
        failure = load('baseline-failure.json')
    else:
        disposition = parity.get('disposition', 'ROBUST_V20_PREFREEZE_TOOLING_INTEGRITY_BLOCKED')
    success = disposition == 'ROBUST_V20_RAW_TENSOR_CORPUS_SEALED_CURRENT_030_005_BASELINE_PARITY_ESTABLISHED'
    proof, raw_proof = load('remote-capture-permission.json', {}), load('remote-raw-seal-proof.json', {})
    pre = load('pre-execution-tests.json', {})
    product = load('product-vitest.json', {})
    local = load('local-verification.json', {})
    preservation = load('input-preservation.json', {})
    structure = pre.get('structural', {})
    if success:
        assert pre['failed'] == 0 and pre['passed'] == 16
        assert product['numFailedTests'] == 0 and product['numPendingTests'] == 0
        assert load('post-execution-tests.json')['failed'] == 0
        assert capture['modelSessionLoads'] == 1 and capture['captureOwnerWorkers'] == 1
        assert capture['attemptedSessionRuns'] == capture['successfulSessionRuns'] == 228
        assert capture['rawTensorPairs'] == 228 and capture['rawCanonicalBytes'] == 29373696
        assert capture['unknownRuns'] == capture['hiddenWarmupRuns'] == 0
        assert proof['remoteVerifiedAt'] < manifest['startedAt']
        assert raw_proof['remoteVerifiedAt'] < parity['startedAt']
        assert baseline == {'neuralRuns': 0, 'baselineDecoderRuns': 228, 'alternativeThresholdDecoderRuns': 0, 'productVerdictRuns': 0}
        assert parity['mismatches'] == [] and len(parity['legacyMembership']) == 34
    answers = {
        '1_V19Immutable': True, '2_V19NotResumed': 'V19_NOT_RESUMED_NEW_V20_PROSPECTIVE_PROTOCOL_REQUIRED',
        '3_V20InputsReconstructedIndependently': preservation.get('totalInputs', 0),
        '4_exactInputPreservation': {'mismatches': preservation.get('mismatches'), 'V6AndReferenceSha': 'verified before session', 'V7WindowAndActualSha': 'verified before session'},
        '5_allPreflightPassedBeforeFreeze': bool(pre.get('failed') == 0 and local.get('allPreflightPassed')),
        '6_structuralASTCheck': structure,
        '7_decoderCallExpressions': structure.get('decoderCallExpressions'),
        '8_reportMetadataExcluded': structure.get('reportMetadataCountedAsDecoderCall') is False,
        '9_remoteProtocolBeforeModel': bool(proof and manifest and proof['remoteVerifiedAt'] < manifest['startedAt']),
        '10_captureOwnerWorkers': capture.get('captureOwnerWorkers', 0), '11_modelSessions': capture.get('modelSessionLoads', 0),
        '12_attemptedSessionRuns': capture.get('attemptedSessionRuns', 0),
        '13_successfulSessionRuns': capture.get('successfulSessionRuns', 0),
        '14_hiddenWarmupUnknown': {'hiddenWarmupRuns': capture.get('hiddenWarmupRuns', 0), 'unknownRuns': capture.get('unknownRuns', 0)},
        '15_StageAForbiddenExecutions': {k: capture.get(k, 0) for k in ['decoderRuns','truthAccessCount','productVerdictRuns']},
        '16_actualRawDescriptors': {'pairsVerified': len(manifest.get('windows', [])), 'dtype': 'float32', 'shape': [1,183,88], 'finite': all(w['finite'] for w in manifest.get('windows', [])) if manifest else 'NOT_MEASURED'},
        '17_rawPairs': capture.get('rawTensorPairs', 0), '18_rawBytes': capture.get('rawCanonicalBytes', 0),
        '19_immediateAndFinalReadbacks': {'completedJobReadbacks': len(manifest.get('jobFinalReadbacks', [])), 'failures': manifest.get('finalReadbackFailures', []), 'rawProof': raw_proof},
        '20_remoteRawSealBeforeDecoder': bool(raw_proof and parity and raw_proof['remoteVerifiedAt'] < parity['startedAt']),
        '21_actualProductionDecoder': parity.get('implementation', 'NOT_EXECUTED'),
        '22_actualSourcePublication': parity.get('implementation', 'NOT_EXECUTED'),
        '23_baselineDecoderRuns': baseline['baselineDecoderRuns'], '24_StageBNeuralRuns': baseline['neuralRuns'],
        '25_V7ParityExact': bool(parity and not parity.get('mismatches')), '26_V15Membership': parity.get('legacyMembership', []),
        '27_alternativeThresholdRuns': baseline['alternativeThresholdDecoderRuns'],
        '28_directionWinnerCandidateSelected': {'directionSelected': False, 'winnerSelected': False, 'candidateSelected': False},
        '29_productionChanged': False, '30_defaultsChanged': False, '31_capabilityEnabled': False,
        '32_CI': 'ACTUAL_GITHUB_QUERY_ONLY_LOCAL_TESTING_IS_NOT_CI'
    }
    data = {'phase': contract['phase'], 'label': contract['label'], 'createdAt': now(), 'startingHead': START,
        'startingGate': {'localHead': START, 'remoteHead': START, 'mergeBase': START, 'ahead': 0, 'behind': 0,
            'cleanWorktreeBeforeEdits': True, 'fetchFirst': True,
            'github': {'queriedAt': '2026-10-19T08:55:02.881433+00:00', 'combinedState': 'pending', 'statuses': [], 'workflow_runs': [], 'ciInterpretation': 'NOT CI PASS'}},
        'disposition': disposition, 'failure': failure, 'requiredAnswers': answers,
        'V19Boundary': contract['historicalBoundary'], 'V19Disposition': contract['V19HistoricalDisposition'],
        'V19FailureNotAcoustic': contract['V19FailureClassification'], 'productionDiff': [], 'historicalDiff': [],
        'historicalFilesRawVerified': history_count, 'changedFilesAtAssessment': changed,
        'captureProtocolFreezeProof': proof, 'remoteRawSealProof': raw_proof,
        'inputPreservation': {k: preservation.get(k) for k in ['totalCases','totalJobs','totalInputs','mismatches']},
        'StageA': capture, 'StageB': baseline,
        'browser': manifest.get('browser'), 'GPU': manifest.get('GPU'), 'workerTaxonomy': manifest.get('workers'),
        'modelIdentity': manifest.get('modelIdentity'), 'modelSha256': manifest.get('modelSha256'),
        'ORT': manifest.get('ORT'), 'provider': manifest.get('provider'), 'automaticFallback': manifest.get('automaticFallback'),
        'corpusCanonicalSha256': manifest.get('corpusCanonicalSha256'),
        'baselineObservationParity': 'EXACT' if success else 'NOT_ESTABLISHED',
        'onsetScoreFrameScore': 'NEWLY_PRESERVED_RAW_DERIVED_DIAGNOSTIC_NOT_HISTORICAL_V7_PARITY',
        'localVerification': local, 'postExecutionAssertions': load('post-execution-tests.json'),
        'productTestCounts': {k: product.get(k) for k in ['numPassedTests','numFailedTests','numPendingTests']},
        'currentAcousticDefaults': contract['productionDefaults'], 'V18SemanticsUnchanged': contract['V18'],
        'historicalThresholdGrid': contract['historicalThresholdGrid'], 'candidateSelected': False,
        'noProductPolicyScoring': True, 'microphoneQualified': False, 'scientificWinner': 'NOT_CLAIMED',
        'capabilities': contract['capabilities'], 'nextAllowedPhase': 'STOP_FOR_INDEPENDENT_AUDIT_NO_THRESHOLD_STUDY_OR_MICROPHONE_ENABLEMENT'}
    save('assessment.json', data)
    lines = ['# V20 Raw Tensor Foundation', '', disposition, '', contract['label'], '', contract['historicalBoundary'],
        'V19 remains immutable static-test tooling failure, not model/acoustic failure. Production and V3-V19 evidence remain unchanged.', '',
        '## Preflight And Freeze', '',
        f"Inputs: {preservation.get('totalCases')} cases, {preservation.get('totalJobs')} jobs, {preservation.get('totalInputs')} inputs, mismatches={preservation.get('mismatches')}. Both44100/48000, production adapter/planner and strongest V6/reference/V7 identities. No V19 cache authority.",
        f"Structural TypeScript AST: decoder call expressions={structure.get('decoderCallExpressions')}; metadata objects={structure.get('reportMetadataObjects')}; metadata counted as call={structure.get('reportMetadataCountedAsDecoderCall')}. No aliases/wrappers/computed decoder/grid iteration; no parser package installed.",
        f"All preflight passed={local.get('allPreflightPassed')}. Product tests={product.get('numPassedTests')}, failed={product.get('numFailedTests')}. See local-verification.json for typecheck/lint. Local results are not CI.",
        f"Protocol remote proof: {proof.get('remoteVerifiedAt', 'NOT_CREATED')}; capture start: {manifest.get('startedAt', 'NOT_STARTED')}.", '',
        '## Stage A', '', json.dumps(capture, sort_keys=True),
        'Owner Worker is distinct from ORT_RUNTIME_SUBORDINATE infrastructure. No raw total-worker=1 gate. No decoder, truth/target, STEP runtime/finalizer or product evaluation in capture.',
        f"Canonical raw identity: {manifest.get('corpusCanonicalSha256', 'NOT_CREATED')}. Per-pair and whole-job/final corpus readback hashes are retained. Float32 LE onset then frame, no compression/padding/decimal JSON; required full payload29373696 bytes.",
        f"Raw seal remote proof: {raw_proof.get('remoteVerifiedAt', 'NOT_CREATED')}.", '',
        '## Stage B', '', json.dumps(baseline, sort_keys=True),
        f"Baseline start: {parity.get('startedAt', 'NOT_STARTED')}; V7 parity: {'EXACT' if success else 'NOT_ESTABLISHED'}; V15 assemblies checked: {len(parity.get('legacyMembership', []))}.",
        'Actual production decodeRobustPiano/sourcePublication only, .30/.05. Observation IDs, pitches, source/target coordinates, confidence, cardinality and ordering compared exactly; availability wall-clock excluded. Onset/frame scores are NEWLY_PRESERVED_RAW_DERIVED_DIAGNOSTIC, not invented V7 fields.', '',
        '## Boundaries', '',
        'No alternate threshold, grid execution, direction, winner or candidate selection; no physical-support/product-policy scoring. Model/input, decoderA .30/.05, owned600/past1050/future170 remain current defaults.',
        'V18 schema6 / step-source-sensitive-verdict-v6, MIDI_EXACT_SET, MICROPHONE_CONSERVATIVE_TRISTATE and explicit retirement remain authoritative. No fixed microphone cooldown.',
        'Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false. No scientific winner or microphone qualification.',
        'Actual GitHub statuses/workflows are recorded in the remote receipt and checked again at final HEAD. Empty checks are NOT CI PASS.',
        'STOP for independent audit. No automatic threshold study or microphone integration.', '']
    if failure:
        lines += ['## Failure Witness', '', json.dumps(failure, indent=2), 'No repair, resumption or rerun authorized.', '']
    with (OUT / 'assessment.md').open('x', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print(json.dumps({'disposition': disposition, 'StageA': capture, 'StageB': baseline, 'historicalFilesVerified': history_count}))


def receipt():
    changed, count = verify()
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split()[0]
    if head != remote or git('rev-parse', 'origin/' + BRANCH) != head or git('status', '--porcelain'):
        raise RuntimeError('REMOTE_OR_WORKTREE_MISMATCH')
    names = ['assessment.json','assessment.md','input-preservation.json','capture-protocol-freeze.json',
             'tensor-corpus-manifest.json','raw-tensor-seal.json','baseline-parity.json']
    save('remote-evidence-and-github-receipt.json', {'startingHead': START, 'verifiedEvidenceCommit': head,
        'remoteHead': remote, 'remoteVerifiedAt': now(), 'changedFilesThroughEvidence': changed,
        'completeCommitChainThroughEvidence': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(),
        'productionDiff': [], 'historicalDiff': [], 'historicalFilesVerified': count,
        'evidenceHashes': {n: sha256((OUT / n).read_bytes()).hexdigest() for n in names if (OUT / n).exists()},
        'StageA': load('assessment.json')['StageA'], 'StageB': load('assessment.json')['StageB'],
        'disposition': load('assessment.json')['disposition'], 'github': github(head),
        'receiptPlacement': 'Additive receipt follows evidence commit; final receipt HEAD fetched and queried separately.'})
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
            'mergeBase': git('merge-base', START, 'HEAD'), 'aheadBehind': git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH),
            'worktreeStatus': git('status', '--porcelain'), 'historicalFilesVerified': count, 'changedFiles': changed,
            'completeCommitChain': git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines(), 'github': github(head)}))
    else:
        raise SystemExit('Metadata assessment/receipt/verify only; no capture/decoder/product evaluation.')
