"""Append-only XC4 convergence. No media, model execution, or dataset networking."""
import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / 'backend/research/reports'
WORK = ROOT / 'backend/data/work/xc4_convergence'
START = 'c9c6777cfde677fc6cef72cbbc92bfb2febeca51'
PHASE = 'PHASE_9G_XC4_EVIDENCE_CONVERGENCE_AND_ENGINEERING_DEFAULT_FREEZE'
PREFIX = 'phase9g_xc4_'
STAMP = '2026-10-16'
RUNTIME = 'backend/research/browser_runtime/'
AUTHORITATIVE = 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts'
FIR = 'backend/data/work/xc2_r1_bounded_runtime/audio_only/fir_160_441.f32'
ONNX = 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx'
ORT = RUNTIME + 'xc1_ort120_runtime/'
SOURCES = [AUTHORITATIVE, RUNTIME + 'xc1_robust_decoder.mjs', RUNTIME + 'xc2_decoders.mjs',
           RUNTIME + 'xc2_r1_streaming_resampler.mjs', RUNTIME + 'xc2_r1_browser_acoustic.mjs',
           RUNTIME + 'xc2_r1_runtime.mjs', 'backend/research/xc4_engineering_default.py',
           'backend/research/test_xc4_engineering_default.py', 'backend/research/run_xc4_regressions.ps1',
           'backend/research/xc3_maps_provenance.py']
EVIDENCE = {
    'd3': 'phase9g_d3_robust_browser_v1_identity_2026-10-13.json',
    'calibration': 'phase9g_a32_challenger_qualification_report_2026-10-10.json',
    'f5': 'phase9g_xc1_r3d_f5_full_scientific_result_2026-10-15.json',
    'r4': 'robust_runtime_sustainability_qualification_result_2026-10-15.json',
    'xc2': 'phase9g_xc2_product_verdict_latency_final_2026-10-16.json',
    'decoderDevelopment': 'phase9g_xc2_stage_a_decoder_resampler_development_2026-10-15.json',
    'fir': 'phase9g_xc2_r1_audio_and_fir_identity_2026-10-16.json',
    'firParity': 'phase9g_xc2_r1_browser_streaming_resampler_parity_2026-10-16.json',
    'r1Runtime': 'phase9g_xc2_r1_causal_runtime_receipts_2026-10-16.json',
    'r1': 'phase9g_xc2_r1_bounded_runtime_final_2026-10-16.json',
    'r2': 'phase9g_xc2_r2_direct_conflict_final_2026-10-16.json',
    'parameterProvenance': 'phase9g_xc2_r2_parameter_provenance_2026-10-16.json',
    'xc3': 'phase9g_xc3_maps_provenance_gate_2026-10-16.json',
    'xc3r1': 'phase9g_xc3_r1_zenodo_provenance_determination_2026-10-16.json',
    'xc3r2Provenance': 'phase9g_xc3_r2_institutional_provenance_2026-10-16.json',
    'xc3r2Closure': 'phase9g_xc3_r2_acquisition_closure_2026-10-16.json',
}
COUNTERS = dict(newNeuralInferenceCount=0, newExternalDatasetDownloads=0,
                newMidiTruthReads=0, newAudioContentReads=0, newBenchmarkExecutions=0)
SCOPE = {
    'F5': 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', '9G-B': 'STATISTICAL_TIE', 'winner': None,
    'R4': 'ROBUST_CADENCE_SUSTAINABLE', 'R4Headroom': 'ROBUST_20_PERCENT_HEADROOM_FAIL',
    'R4Scope': 'Finite measured sessions, not proof of indefinite stability.',
    'XC2': 'ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES',
    'R1': 'BOUNDED_FINALIZATION_HAS_SAFETY_TRADEOFF',
    'R2': 'DIRECT_CONFLICT_RESERVATION_PARTIALLY_RECOVERS_SAFETY',
    'viennaP15P22InferenceIncrease': 0, 'productionMicrophone': False, 'D4': False,
    'productionWinner': None, 'practiceWebSocket': False, 'backendPracticeInference': False,
    'serverAcousticInference': False, 'scoreFollowing': False, 'expectedScoreEntersAcousticInference': False,
    'commercialQualificationStatus': 'NOT_PERFORMED', 'scientificUse': 'SCIENTIFIC_RESEARCH_ONLY',
    'productLatencySlo': 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN', 'NO_OPTIMAL_PROFILE_CLAIM': True,
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                      allow_nan=False).encode('ascii')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    return sha(canonical(value))


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def file_identity(path):
    path = ROOT / path
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
            'sha256': h.hexdigest()}


def git(*args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + str(ROOT),
                                   '-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false',
                                   *args], cwd=ROOT, text=True).strip()


def report_path(kind):
    return REPORTS / f'{PREFIX}{kind}_{STAMP}.json'


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False)
        f.write('\n')
    return file_identity(path)


def history_proof():
    changed = git('diff', '--name-status', START).splitlines()
    for row in changed:
        status, path = row.split('\t', 1)
        if status != 'A' or not (path.startswith('backend/research/') and
                                 (path.split('/')[-1].startswith(PREFIX) or
                                  path.split('/')[-1] in {'xc4_engineering_default.py',
                                     'test_xc4_engineering_default.py', 'run_xc4_regressions.ps1'})):
            raise RuntimeError('HISTORICAL_CONTENT_CHANGED:' + row)
    if git('diff', '--name-only') or git('diff', '--cached', '--name-only'):
        raise RuntimeError('UNCOMMITTED_TRACKED_CONTENT')
    return {'startingTree': git('rev-parse', START + '^{tree}'),
            'trackedChangesSinceStart': changed, 'allPreExistingTrackedFilesUnchanged': True,
            'method': 'Git diff against exact starting commit permits only new XC4 files; no historical source/report modifications.'}


def build_identity():
    d3 = load(REPORTS / EVIDENCE['d3'])['identity']
    model = file_identity(ONNX)
    if model['sha256'] != d3['onnxSha256'] or model['bytes'] != d3['onnxBytes']:
        raise RuntimeError('FROZEN_ONNX_IDENTITY_DRIFT')
    coefficients = file_identity(FIR)
    if coefficients['sha256'] != 'd54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620' or coefficients['bytes'] != 35284:
        raise RuntimeError('FROZEN_FIR_IDENTITY_DRIFT')
    lock = file_identity(ORT + 'package-lock.json')
    if lock['sha256'] != '7268737984b6c01ca800a3512a69c7656215fc7f19dede78b43f40752bc4f449':
        raise RuntimeError('ORT_LOCK_IDENTITY_DRIFT')
    if load(ROOT / (ORT + 'node_modules/onnxruntime-web/package.json'))['version'] != '1.20.1':
        raise RuntimeError('ORT_VERSION_DRIFT')
    return {
        'identityName': 'robust-browser-engineering-default-xc4-v1',
        'model': {'candidateId': d3['sourceCandidateId'], 'checkpointSha256': d3['checkpointSha256'],
                  'checkpointBytes': d3['checkpointBytes'], 'onnxSha256': model['sha256'],
                  'onnxBytes': model['bytes'], 'sourceConfigurationSha256': d3['sourceConfigurationSha256']},
        'runtime': {'ortWebVersion': '1.20.1', 'provider': 'webgpu', 'automaticFallback': False,
                    'graphOptimizationLevel': 'disabled', 'packageLock': lock,
                    'browserLibrary': file_identity(ORT + 'node_modules/onnxruntime-web/dist/ort.webgpu.min.js')},
        'input': {'sampleRateHz': 16000, 'modelInputMs': 1820, 'modelInputSamples': 29120,
                  'dtype': 'float32', 'shape': [1, 29120]},
        'resampler': {'default': 'BAND_LIMITED', 'sourceRateHz': 44100, 'targetRateHz': 16000,
                      'up': 160, 'down': 441, 'tapCount': 8821, 'coefficients': coefficients,
                      'source': file_identity(RUNTIME + 'xc2_r1_streaming_resampler.mjs'),
                      'algorithm': 'Frozen SciPy 1.14.1 firwin(8821,1/441,kaiser beta=5); float32 coefficients multiplied by160; float32 products/accumulation.',
                      'lookaheadSourceSamples': 27.5625, 'conservativeReadyLookaheadSamples': 28,
                      'conservativeReadyLookaheadMs': 28 / 44100 * 1000,
                      'timeMapping': 'Output m represents source m*441/160; wait for real source floor((m*441+4410)/160). No fitted shift or gain normalization.',
                      'boundary': 'Preserve state across chunks. Zero only at stream origin or explicit finish; padded finish cannot qualify real-context owned observations.'},
        'decoder': {'default': 'A', 'function': 'decodeByteDanceRawOutputs',
                    'authoritativeSource': file_identity(AUTHORITATIVE),
                    'researchParitySource': file_identity(RUNTIME + 'xc1_robust_decoder.mjs'),
                    'onsetThreshold': 0.30, 'frameThreshold': 0.05, 'outputFrameRateHz': 100,
                    'semantics': 'Contiguous >=onset threshold region; first maximum peak; reject peak if frame support <threshold; confidence=min(onset,frame); piano MIDI21..108; sort by time,pitch,stable ID.',
                    'timeMapping': 'inputWindowStartMs + round(peakFrame/100*16000)/16000*1000'},
        'ownership': {'ownedMs': 600, 'futureContextMs': 170, 'fullWindowPastMs': 1050,
                      'rule': '[ownedStartMs,ownedEndMs)',
                      'input': 'inputEnd=ownedEnd+170ms; inputStart=inputEnd-1820ms; exactly29120 real samples; final partial ownership shifts full input without padding.',
                      'plannerSource': file_identity(RUNTIME + 'xc2_decoders.mjs'),
                      'plannerFunction': 'planXc2Windows; selected parameters ownedMs=600,futureMs=170; historical common clip guard remains historical, not a new live startup specification.'},
        'acousticPublication': {
            'executorSource': file_identity(RUNTIME + 'xc2_r1_browser_acoustic.mjs'),
            'publicationReferenceSource': file_identity(RUNTIME + 'xc2_r1_runtime.mjs'),
            'semantics': 'One session per execution, sequential windows, all-pitch decoder A, half-open ownership, stable observation ID, immutable performanceTimeMs and confidence; availabilityTimeMs uses actual acoustic publication on performance-origin clock; analyzed-through frontier is preceding float64 of ownedEnd. No score, labels, final verdicts or expected pitch in acoustic execution.',
            'scope': 'Acoustic semantics only; reference runtime downstream finalizer is explicitly excluded from default. No production wiring.'},
    }


def interpretation():
    return {
        'CURRENT_ENGINEERING_ACOUSTIC_MODEL': 'ROBUST', 'CURRENT_ENGINEERING_DECODER_DEFAULT': 'A',
        'CURRENT_ENGINEERING_RESAMPLER_DEFAULT': 'BAND_LIMITED',
        'CURRENT_ENGINEERING_STREAMING_GEOMETRY_DEFAULT': 'OWNED_600_FUTURE_170',
        'CURRENT_ENGINEERING_ORT_WEB_VERSION': '1.20.1',
        'PROFILE_CLASSIFICATION': 'CURRENT_FROZEN_REPRESENTATIVE_ROBUST_PROFILE',
        'profileProvenance': {'profilesEvaluated': 80, 'correctedGate1Survivors': 25,
                              'selection': 'NON_PERFORMANCE_NEUTRAL_HASH',
                              'profileId': 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05'},
        'NO_OPTIMAL_PROFILE_CLAIM': True,
        'decoderB': 'RESEARCH_CHALLENGER_NOT_DEFAULT',
        'decoderC': 'NO_DEMONSTRATED_ENGINEERING_ADVANTAGE_ON_EXISTING_EVIDENCE',
        'LINEAR': 'REGRESSION_CONTROL',
        'BAND_LIMITED_A_600_120': 'STRONGEST_UNPROMOTED_GEOMETRY_CHALLENGER',
        'MAPS': 'OPTIONAL_FUTURE_EXTERNAL_CONFIRMATION_NOT_CURRENT_ENGINEERING_BLOCKER',
        'PRODUCT_FINALIZATION_POLICY': 'STILL_PRODUCT_CRITICAL',
        'R2': 'R2_RESEARCH_POLICY_NOT_PRODUCTION_QUALIFIED',
        'answers': {'robustCapableEnough': 'YES_CURRENT_ENGINEERING_EVIDENCE_SUPPORTS_CONTINUED_PRODUCT_DEVELOPMENT',
                    'globallyBestDecoderResamplerProfileProven': 'NO',
                    'externalAcquisitionNecessary': 'NO_NOT_CURRENTLY_DECISION_CRITICAL'},
    }


def policy():
    return {
        'stoppingRule': 'No new dataset/candidate/decoder/resampler/geometry/parameter sweep unless at least one enumerated trigger is documented.',
        'sufficientReasons': ['Existing evidence is materially contradictory.',
                              'An actual browser/microphone integration failure cannot be explained by existing evidence.',
                              'A specific unresolved safety question could plausibly reverse this engineering decision.',
                              'An explicit production/legal/commercial requirement requires new evidence.'],
        'insufficientReasons': ['More confidence would be nice.', 'A more impressive sample count.'],
        'futureTestTriggers': ['Unexpected real-microphone failure.', 'New browser/runtime regression.',
                               'Material decoder/resampler failure on actual product recordings.',
                               'Materially changed model/runtime implementation.',
                               'Publication-grade external generalization requirement.',
                               'Explicit commercial/legal qualification requirement.'],
        'scorerFollowUp': 'Only narrow mechanistic hypotheses tied to existing R2 causal witnesses. No grace-window sweep, heuristic grid, or optimization against all seen EVALUATION targets.',
        'maps': {'priorXC3': 'FRESH_COMPONENT_SELECTION_BLOCKED_DATASET_PROVENANCE',
                 'priorXC3R1': 'ZENODO_ARCHIVE_PROVENANCE_NOT_SUFFICIENTLY_LINKED',
                 'priorXC3R2Provenance': 'INSTITUTIONALLY_AFFILIATED_ARCHIVAL_REDISTRIBUTION',
                 'priorXC3R2Acquisition': 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED',
                 'actualObservedBlocker': 'TLS_EOF_AND_HANDSHAKE_TIMEOUT_DURING_BOUNDED_DISCOVERY',
                 'rangeCapability': 'Precise HTTP206 responses observed; historical label does NOT prove full download technically necessary.',
                 'networkRetryAuthorizedByThisPhase': False,
                 'currentStatus': 'OPTIONAL_FUTURE_EXTERNAL_CONFIRMATION_NOT_CURRENT_ENGINEERING_BLOCKER'},
    }


def matrix():
    def row(item, support, against, limitation, relevance, refs):
        return dict(item=item, evidenceSupportingDefault=support, evidenceAgainstOrChallenging=against,
                    knownLimitation=limitation, additionalEvidenceDecisionRelevance=relevance,
                    evidenceReferences=refs)
    return [
        row('Acoustic model: Robust / Online-AMT / Basic Pitch',
            'Stored F5 50ms macro F1: Robust0.9703531318, Online0.9258142889, Basic0.7551883847; paired F1 CIs favor Robust, no FP/min or missed-rate regression. Later finite-session cadence support.',
            'F5 Robust failed prospectively frozen480ms reserve gate; F5 remains NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER.',
            'SMD scientific/non-commercial acoustic transcription, not natural product verdict or microphone qualification.',
            'CLOSED_FOR_CURRENT_ENGINEERING', ['f5:/aggregateMetricsByTolerance/50', 'f5:/pairedBootstrap', 'r4:/conclusions']),
        row('Decoder A / B / C',
            'A authoritative customer-web parity, deterministic region dedupe and conservative frame support. StageA same-geometry development A produced220 LINEAR/342 BAND extras vs B341/527. C matched A aggregate counts without demonstrated engineering gain.',
            'B BAND development target agreement slightly higher than A; no universal A dominance claimed. C agreement aggregate equality is not event-by-event equivalence.',
            'Already-seen XC2 counterfactual evidence, no fresh external confirmation; B remains research challenger, C not justified as default complexity.',
            'REOPEN_ONLY_ON_TRIGGER', ['decoderDevelopment:/candidates', 'xc2:/stageADecoderResampler']),
        row('Resampler LINEAR / BAND_LIMITED',
            'All seven original observational XC2 Pareto candidates BAND_LIMITED. Pinned R1 streaming FIR exactly matched frozen fixtures and guarded real clips; chunk vs single exact, conservative lookahead0.6349206349ms.',
            'StageA BAND A had342 residual extras vs LINEAR A220; not uniformly superior on all finite metrics. LINEAR retained regression control.',
            'Parity limited to pinned44.1k->16k FIR, tested fixtures/clips; not AudioWorklet,48k/device-clock qualification or global optimum.',
            'REOPEN_ONLY_ON_TRIGGER', ['xc2:/ort120Main/paretoIds', 'firParity:/fixtures', 'firParity:/clips', 'decoderDevelopment:/candidates']),
        row('Geometry owned320/400/500/600; future120/170/220',
            '600 accumulated strongest cadence evidence; BAND_A_600_170 R1 9/9 bounded sessions and R2 directly exercised.170 reduces future wait50ms vs220 and remains original Pareto.',
            '600/120 strongest unpromoted challenger: original EVAL target334/342 (97.66%), strike recall97.42%, no observed critical false acceptance and lower several logical latencies.500ms BAND R1 only7/9 bounded.320/400 historical runtime weak.',
            'Engineering convergence, not performance rank; historical logical latencies affected by transitive finalizer, finite sessions and seen clips. No new120vs170 study.',
            'REOPEN_ONLY_ON_TRIGGER', ['xc2:/fiveVerdictTables', 'xc2:/developmentGeometryAndFuture', 'r1Runtime:/groups', 'r2:/metrics']),
        row('Runtime F5 / R4 / R1 and ORT1.20.1 /1.30.0',
            'R4 finite600ms cadence sustainable despite20% reserve failure. R1 LINEAR600220 and BAND600170 each9/9 bounded; measured production-like acoustic path excludes research raw export. ORT1.20.1 chosen.',
            'F5 long-take P95~552.84ms >480ms; R1 BAND5002207/9. ORT1.30 control P951224.605ms and sustained backlog for this export/machine.',
            'Do not transfer long baseline sessions into proof of indefinite BAND stability; no product UX SLO or current hardware retest.',
            'REOPEN_ONLY_ON_TRIGGER', ['f5:/runtimeEvidence', 'r4:/conclusions', 'r1Runtime:/groups', 'xc2:/ort130Control']),
        row('Product scoring XC2 / R1 / R2',
            'Separate acoustic choice from unresolved verdict policy. R2 recovered nine MISSING->WRONG and four INCOMPLETE->WRONG regressions with one-hop bounded horizon.',
            'Original transitive policy very safe but10-27s tails. R1 material safety regression. R2 retains smaller WRONG/EXTRA tradeoffs and incomplete recovery of other cases.',
            'R2 research only, diagnostic seen EVALUATION, not production qualified. Needs causal-witness targeted repair, natural early/late fixed-BPM corpus and explicit latency SLO.',
            'STILL_PRODUCT_CRITICAL', ['r1', 'r2:/exactRecoveryBaselineEvaluation', 'r2:/conclusion']),
    ]


def integration_plan():
    return {
        'status': 'INACTIVE_PLAN_ONLY_NO_PRODUCTION_SOURCE_CHANGES', 'productionMicrophone': False,
        'pipeline': ['Mic PCM interface (disabled)', 'Frozen BAND_LIMITED streaming FIR',
                     'Robust ORT1.20.1 hardware WebGPU', 'Decoder A', 'Score-blind acoustic publications'],
        'unresolvedProductCritical': ['Finalizer/scorer safety-latency tradeoff; no R2 production promotion.',
                                      'Real microphone / AudioWorklet / device-clock integration.',
                                      'Product latency SLO.', 'UI/perceptual latency.',
                                      'Natural early/late behavior against an independent fixed-BPM clock.'],
        'integrationGates': ['Do not connect research fixed-size clip buffer as an unbounded live stream.',
                             'Preserve real future FIR/model context; no finish padding counted as real acoustic future.',
                             'Qualify sample-rate/device handling separately; current FIR only44.1k->16k.',
                             'Separate immutable event time, causal availability and analysis frontier.',
                             'No user-visible production verdicts until finalizer is independently qualified.'],
        'geometryInterpretation': '600ms is acoustic ownership/inference cadence, NOT semantic verdict commit width. Full600/170 window has1050ms past; a shorter terminal region increases past context. Live startup/tail/device-clock contract is not qualified by historical clip guards.',
        'latencyInterpretation': 'Acoustic model quality, product finalization, production-like compute, UI/perception are separate evidence layers. No UX threshold or readiness PASS invented.',
    }


def verify_existing_evidence():
    data = {k: load(REPORTS / p) for k, p in EVIDENCE.items()}
    calibration = data['calibration']['challengers']['bytedanceRobustAugmented']
    assert (calibration['totalProfilesEvaluated'], calibration['gate1RemainingCount'],
            calibration['selectionMethod']) == (80, 25, 'NON_PERFORMANCE_NEUTRAL_HASH')
    assert data['f5']['scientificDisposition'] == SCOPE['F5']
    assert data['xc2']['finalDisposition'] == SCOPE['XC2']
    assert data['r2']['conclusion'] == SCOPE['R2']
    pareto = data['xc2']['ort120Main']['paretoIds']
    assert len(pareto) == 7 and all(p.startswith('BAND_LIMITED_') for p in pareto)
    assert 'BAND_LIMITED_A_600_170' in pareto and 'BAND_LIMITED_A_600_120' in pareto
    parity = data['firParity']
    assert parity['pass']
    for fixture in parity['fixtures']:
        for key in ('vsScipy', 'continuousChunkVsSingle'):
            assert fixture[key]['countIdentity'] and fixture[key]['maxAbs'] == fixture[key]['rms'] == 0
    for clip in parity['clips']:
        p = clip['vsExistingXc2BandPcm']
        assert p['countIdentity'] and p['maxAbs'] == p['rms'] == 0
    assert data['xc3r2Closure']['technicalBlocker'] == policy()['maps']['actualObservedBlocker']
    return {'evidenceFiles': {k: file_identity(REPORTS / p) for k, p in EVIDENCE.items()},
            'storedOriginalParetoIds': pareto,
            'storedF5Aggregate50ms': data['f5']['aggregateMetricsByTolerance']['50'],
            'storedR4Conclusions': data['r4']['conclusions'],
            'storedR1RuntimeGroups': data['r1Runtime']['groups'],
            'storedOrt130Control': data['xc2']['ort130Control'],
            'firParityObservedExact': {'fixtureCount': len(parity['fixtures']), 'guardedRealClipCount': len(parity['clips']),
                                      'allRecordedMaxAbsAndRms': 0, 'newParityExperimentRun': False},
            'interpretation': 'Stored report fields only; no replay, model run, listening, truth read, metrics recomputation or new benchmark.'}


def freeze():
    history = history_proof()
    identity = build_identity()
    evidence = verify_existing_evidence()
    payload = {'phase': PHASE, 'startingRemoteHead': START, 'implementationCommit': git('rev-parse', 'HEAD'),
               'engineeringDefaultIdentity': identity, 'engineeringDefaultIdentitySha256': digest(identity),
               'identityDigestDefinition': 'SHA256 of ASCII canonical JSON: sorted keys, compact separators, finite numbers; identity object only (not enclosing report).',
               'identityClassification': 'ENGINEERING_DEFAULT_ONLY_NOT_D4_NOT_PRODUCTION_WINNER',
               'defaults': interpretation(), 'evidenceConvergenceMatrix': matrix(), 'researchPolicy': policy(),
               'inactiveIntegrationPlan': integration_plan(), 'evidenceAudit': evidence,
               'sourceHashBoundary': [file_identity(p) for p in SOURCES], 'historyUnchangedProof': history,
               'counters': COUNTERS, 'scopeProtections': SCOPE,
               'commitReferenceConvention': 'Freeze commit is exact Git commit containing this report, resolved by git log at finalization; no self-referential commit hash.'}
    payload['freezeCanonicalSha256'] = digest(payload)
    print(json.dumps(write_new(report_path('engineering_default_freeze'), payload)))


def verify_freeze():
    frozen = load(report_path('engineering_default_freeze'))
    body = {k: v for k, v in frozen.items() if k != 'freezeCanonicalSha256'}
    if digest(body) != frozen['freezeCanonicalSha256'] or digest(frozen['engineeringDefaultIdentity']) != frozen['engineeringDefaultIdentitySha256']:
        raise RuntimeError('XC4_FREEZE_DIGEST_DRIFT')
    for row in frozen['sourceHashBoundary'] + list(frozen['evidenceAudit']['evidenceFiles'].values()):
        if file_identity(row['path']) != row:
            raise RuntimeError('XC4_SOURCE_OR_HISTORICAL_EVIDENCE_DRIFT:' + row['path'])
    if build_identity() != frozen['engineeringDefaultIdentity']:
        raise RuntimeError('XC4_DEPLOYMENT_IDENTITY_DRIFT')
    history_proof()
    return frozen


def final():
    frozen = verify_freeze()
    tests = load(WORK / 'regression_receipt.json')
    if tests['phase'] != PHASE or len(tests['runs']) != 3 or any(r['exitCode'] != 0 for r in tests['runs']):
        raise RuntimeError('REGRESSIONS_NOT_PASS')
    for row in tests['sourceHashBoundary']:
        if row['sha256'] != file_identity(row['path'])['sha256']:
            raise RuntimeError('REGRESSION_RUNNER_IDENTITY_DRIFT')
    relative = report_path('engineering_default_freeze').relative_to(ROOT).as_posix()
    freeze_commit = git('log', '-1', '--format=%H', '--', relative)
    report = {'phase': PHASE, 'startingRemoteHead': START,
              'implementationCommit': frozen['implementationCommit'], 'engineeringDefaultFreezeCommit': freeze_commit,
              'engineeringDefaultIdentity': frozen['engineeringDefaultIdentity'],
              'engineeringDefaultIdentitySha256': frozen['engineeringDefaultIdentitySha256'],
              'freezeReport': file_identity(relative), 'freezeCanonicalSha256': frozen['freezeCanonicalSha256'],
              'defaults': frozen['defaults'], 'evidenceConvergenceMatrix': frozen['evidenceConvergenceMatrix'],
              'researchStoppingAndTriggerPolicy': frozen['researchPolicy'],
              'inactiveIntegrationPlan': frozen['inactiveIntegrationPlan'],
              'tests': tests, 'historyUnchangedProof': history_proof(), 'counters': COUNTERS,
              'scopeProtections': SCOPE, 'scientificResultReinterpretation': False,
              'engineeringDisposition': 'CURRENT_ENGINEERING_DEFAULT_FROZEN_FOR_CONTINUED_PRODUCT_DEVELOPMENT',
              'knownLimitations': ['Evidence convergence, not a new blind selection or external generalization experiment.',
                                  'No global optimum; no production readiness or microphone/device/AudioWorklet qualification.',
                                  'R2 scorer unresolved; no live user-visible verdict migration.',
                                  'Finite-session runtime, historically seen counterfactual clips and unfrozen UX SLO remain limitations.'],
              'evidenceCommit': 'Exact containing evidence-only commit; returned after push, not self-referential.',
              'githubEvidence': 'Actual post-push API snapshot generated by versioned github command, then committed in append-only administrative receipt. Empty statuses/workflows are not CI PASS.'}
    print(json.dumps(write_new(report_path('engineering_default_final'), report)))
    files = [file_identity(p) for p in sorted(REPORTS.glob(PREFIX + '*.json'))]
    print(json.dumps(write_new(report_path('evidence_manifest'), {'phase': PHASE, 'files': files,
                      'manifestScope': 'Post-packaging hashes, excludes this manifest and later append-only GitHub administrative receipt.'})))


def github(current_only=False):
    # Administrative network only: no dataset URLs or acquisition commands.
    from xc3_maps_provenance import github_state
    verify_freeze()
    head = git('rev-parse', 'HEAD')
    state = github_state(head)
    by_kind = {row['kind']: row['body'] for row in state['requests']}
    if by_kind['branch']['commit']['sha'] != head:
        raise RuntimeError('EVIDENCE_HEAD_NOT_REMOTE')
    receipt = {'phase': PHASE, 'queriedEvidenceCommit': head, 'actualApiState': state,
               'combinedState': by_kind['combinedStatus']['state'],
               'statuses': by_kind['combinedStatus']['statuses'],
               'workflowRuns': by_kind['workflowRuns']['workflow_runs'],
               'ciInterpretation': 'Empty arrays and pending state do not establish CI PASS.',
               'note': 'Snapshot refers to pushed evidence commit explicitly; containing append-only administrative commit is distinct.'}
    path = WORK / f'github_post_push_{head}.json' if current_only else report_path('github_post_evidence')
    print(json.dumps(write_new(path, receipt)))
    print(json.dumps({'queriedCommit': head, 'combinedState': receipt['combinedState'],
                      'statuses': receipt['statuses'], 'workflowRuns': receipt['workflowRuns']}))


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['freeze', 'verify', 'final', 'github', 'github-current'])
    command = parser.parse_args().command
    {'freeze': freeze, 'verify': lambda: print(json.dumps({'identitySha256': verify_freeze()['engineeringDefaultIdentitySha256'], 'status': 'PASS'})),
     'final': final, 'github': github, 'github-current': lambda: github(True)}[command]()


if __name__ == '__main__':
    main()
