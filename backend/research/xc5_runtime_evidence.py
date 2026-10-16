"""XC5 local-only preparation/freeze/evidence. No audio, MIDI or dataset acquisition."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / 'backend/research/reports'
WORK = ROOT / 'backend/data/work/xc5_runtime'
START = '51aee066f510d186ebbf6d9eeb8e238f976e8a07'
PHASE = 'PHASE_9G_XC5_XC4_ALIGNED_DISABLED_BROWSER_ACOUSTIC_RUNTIME'
EXPECTED = '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443'
PREFIX = 'phase9g_xc5_'
ACOUSTIC = ROOT / 'apps/customer-web/src/lib/practice/acoustic-inference'
FREEZE = REPORTS / (PREFIX + 'runtime_source_freeze_2026-10-16.json')
HISTORICAL = ['bytedance-contract.ts', 'bytedance-preprocess.ts', 'bytedance-decoder.ts',
              'bytedance-worker-protocol.ts', 'bytedance-onnx-provider.ts']


def sha(b):
    return hashlib.sha256(b).hexdigest()


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('ascii')


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def git(*args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + str(ROOT), '-c', 'core.autocrlf=true',
                                   '-c', 'core.safecrlf=false', *args], cwd=ROOT, text=True).strip()


def file_id(p):
    p = ROOT / p
    return dict(path=p.relative_to(ROOT).as_posix(), bytes=p.stat().st_size, sha256=sha(p.read_bytes()))


def new_json(p, v):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(v, f, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False); f.write('\n')
    print(json.dumps(file_id(p)))


def xc4_identity():
    path = 'backend/research/reports/phase9g_xc4_engineering_default_freeze_2026-10-16.json'
    committed = json.loads(git('show', START + ':' + path))
    value = committed['engineeringDefaultIdentity']
    if sha(canonical(value)) != EXPECTED or committed['engineeringDefaultIdentitySha256'] != EXPECTED:
        raise RuntimeError('COMMITTED_XC4_IDENTITY_DRIFT')
    return value


def prepare():
    value = xc4_identity()
    new_json(ACOUSTIC / 'xc4-robust-identity.json', value)
    coefficients = ROOT / value['resampler']['coefficients']['path']
    b = coefficients.read_bytes()
    if sha(b) != value['resampler']['coefficients']['sha256'] or len(b) != 35284:
        raise RuntimeError('FIR_IDENTITY_DRIFT')
    dest = ROOT / 'apps/customer-web/public/engineering/xc4/fir-160-441.f32'
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open('xb') as f:
        f.write(b)
    print(json.dumps(file_id(dest)))


def sources():
    paths = [*ACOUSTIC.glob('xc4-*.ts'), *ACOUSTIC.glob('xc4-*.json'),
             ROOT / 'apps/customer-web/public/engineering/xc4/fir-160-441.f32',
             *ROOT.glob('apps/customer-web/scripts/xc5-*'), ACOUSTIC / 'xc4-runtime.md',
             Path(__file__), ROOT / 'backend/research/run_xc5_checks.ps1']
    return [file_id(p) for p in sorted(paths)]


def history():
    changes = git('diff', '--name-status', START).splitlines()
    for row in changes:
        status, p = row.split('\t', 1)
        if status != 'A' or not (p.split('/')[-1].startswith(('xc4-', 'xc5-', 'xc5_', 'run_xc5_', PREFIX))
                                or p == 'apps/customer-web/public/engineering/xc4/fir-160-441.f32'):
            raise RuntimeError('HISTORICAL_FILE_CHANGED:' + row)
    return {'allPreExistingTrackedFilesUnchanged': True, 'changes': changes,
            'historicalPrimitives': [file_id(ACOUSTIC / p) for p in HISTORICAL],
            'capabilitySource': file_id('apps/customer-web/src/lib/practice/input-capability.ts'),
            'timelineSource': file_id('apps/customer-web/src/lib/practice/audio-analysis/capture/performance-pcm-timeline.ts')}


def freeze():
    identity = xc4_identity()
    if git('status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('COMMIT_IMPLEMENTATION_BEFORE_FREEZE')
    checks = load(WORK / 'checks.json')
    if any(r['exitCode'] != 0 for r in checks['runs']):
        raise RuntimeError('XC5_CHECKS_NOT_PASS')
    b = {'phase': PHASE, 'startingRemoteHead': START, 'implementationCommit': git('rev-parse', 'HEAD'),
         'engineeringIdentityName': identity['identityName'], 'engineeringIdentitySha256': EXPECTED,
         'committedXc4IdentityRecomputed': True, 'runtimeContract': identity,
         'sources': sources(), 'history': history(), 'preFreezeChecks': checks,
         'engineeringSmokePlan': {'fixture': 'One deterministic synthetic44.1k mono PCM stream; no external media.',
                                  'preRollMs': 1200, 'performanceMs': 1200, 'tailMs': 180,
                                  'headedChrome': True, 'provider': 'webgpu', 'ort': '1.20.1',
                                  'expectedRuntimeWindows': 2, 'expectedReferenceRuns': 2,
                                  'reference': 'Frozen research FIR and decoder A, same PCM/windows/ONNX; reference session separate, no accuracy scoring.',
                                  'eventTimeToleranceMs': 1e-6, 'confidenceTolerance': 1e-5},
         'realMicrophoneDeviceProbe': 'REAL_MICROPHONE_DEVICE_PROBE_NOT_PERFORMED',
         'productionMicrophone': False, 'productFinalizer': 'R2_RESEARCH_POLICY_NOT_PRODUCTION_QUALIFIED',
         'productLatencySlo': 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN', 'NO_OPTIMAL_PROFILE_CLAIM': True}
    b['freezeCanonicalSha256'] = sha(canonical(b)); new_json(FREEZE, b)


def verify():
    f = load(FREEZE)
    if sha(canonical({k:v for k,v in f.items() if k != 'freezeCanonicalSha256'})) != f['freezeCanonicalSha256']:
        raise RuntimeError('XC5_FREEZE_DIGEST_DRIFT')
    if sources() != f['sources']:
        raise RuntimeError('XC5_RUNTIME_SOURCE_CHANGED_AFTER_FREEZE')
    if xc4_identity() != load(ACOUSTIC / 'xc4-robust-identity.json'):
        raise RuntimeError('XC4_BOUND_IDENTITY_DRIFT')
    history()
    return f


def final():
    f = verify()
    smoke = load(WORK / 'browser_smoke.json')
    if smoke['status'] != 'XC5_BOUNDED_BROWSER_ENGINEERING_SMOKE_PASS':
        raise RuntimeError('XC5_SMOKE_NOT_PASS')
    result = {'phase': PHASE, 'startingRemoteHead': START,
              'implementationCommit': f['implementationCommit'],
              'runtimeFreezeCommit': git('log', '-1', '--format=%H', '--', str(FREEZE.relative_to(ROOT))),
              'freeze': file_id(FREEZE), 'engineeringIdentityName': f['engineeringIdentityName'],
              'engineeringIdentitySha256': EXPECTED, 'runtimeContract': f['runtimeContract'],
              'runtimeSourceHashBoundary': f['sources'], 'historyUnchangedProof': history(),
              'focusedChecks': f['preFreezeChecks'], 'browserSmoke': smoke,
              'startup': 'External source boundary anchors performance0; >=1050ms fully real filtered past. First10 FIR origin-boundary outputs never qualify model context. No clock setters or startup padding.',
              'tail': 'Stop freezes performance source end; appendContextTail retains only real context. Seal requires every owned window completed. Final partial uses shifted full real input. Very short performances may require more pre-roll and fail closed if unavailable.',
              'reset': 'resetPreRoll only before performance; SEALED reuse requires dispose and newly loaded worker/session. No per-chunk or per-window FIR reset.',
              'captureRates': {'44100': 'XC4_SUPPORTED_ENGINEERING_PATH', '16000': 'ALREADY_16K_TEST_INJECTION_ONLY',
                               '48000AndOther': 'SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED'},
              'realMicrophoneDeviceProbe': 'REAL_MICROPHONE_DEVICE_PROBE_NOT_PERFORMED',
              'historicalVsXc4Gap': [
                  {'item':'future', 'historical':'220ms', 'xc4':'170ms'},
                  {'item':'thresholds', 'historical':'0.2/0.2 default unchanged', 'xc4':'explicit0.30/0.05 decoder A'},
                  {'item':'planner', 'historical':'fixed anchor1600ms', 'xc4':'sequential600ms half-open ownership,1820ms full real inputs'},
                  {'item':'startup', 'historical':'zero-padding permitted', 'xc4':'real pre-roll and FIR origin guard'},
                  {'item':'resampler', 'historical':'no qualified live band-limited FIR', 'xc4':'stateful frozen44.1k->16k FIR'},
                  {'item':'sourceRates', 'historical':'legacy input assumptions', 'xc4':'explicit44.1k capture or16k test boundary; other rates fail, no LINEAR fallback'}],
              'scoreBlindProof': 'New acoustic modules import no score, finalizer or ContinuousEvaluationSession. Strict allowed fields at construction, source blocks and worker messages; score-shaped inputs rejected. Smoke synthetic audio only.',
              'productMicrophoneCapability': 'MODEL_NOT_VALIDATED_UNAVAILABLE', 'productionMicrophone': False,
              'productFinalizer': 'R2_RESEARCH_POLICY_NOT_PRODUCTION_QUALIFIED',
              'disposition': 'XC4_BROWSER_ACOUSTIC_RUNTIME_INTEGRATION_READY_DISABLED',
              'counters': {'newExternalDatasetDownloads':0,'newScientificBenchmarkRuns':0,'newParameterSweeps':0,
                           'newMidiTruthReads':0, 'engineeringNeuralSessionRunCount':smoke['actualSessionRunCount']},
              'scopeProtections': load(REPORTS / 'phase9g_xc4_engineering_default_final_2026-10-16.json')['scopeProtections'],
              'limitations': ['Disabled engineering integration, not production readiness, accuracy qualification or user-visible verdicts.',
                              'Single synthetic causal smoke is not sustained-runtime or UX SLO evidence.',
                              'No real device probe;48k capture not qualified. Existing PerformancePcmTimeline retains session source PCM; long-session retention/privacy policy remains integration work.',
                              'Exact identity is unchanged; new adapter/source identities are separately bound by XC5 freeze.'],
              'evidenceCommit': 'Exact containing evidence-only commit returned after push; no self-reference.'}
    result['githubEvidence'] = 'Versioned github-report command appends actual pushed evidence-commit API state; final HEAD queried again by github command. Empty statuses/runs are not CI PASS.'
    new_json(REPORTS / (PREFIX + 'disabled_runtime_final_2026-10-16.json'), result)


def github(report=False):
    from xc3_maps_provenance import github_state
    state = github_state(git('rev-parse','HEAD'))
    branch = next(r['body'] for r in state['requests'] if r['kind'] == 'branch')
    if branch['commit']['sha'] != state['commit']: raise RuntimeError('REMOTE_EVIDENCE_HEAD_MISMATCH')
    new_json(REPORTS / (PREFIX + 'github_post_evidence_2026-10-16.json') if report
             else WORK / ('github_' + state['commit'] + '.json'), state)
    print(json.dumps({r['kind']: r['body'].get('state', r['body'].get('workflow_runs', [])) for r in state['requests'][:2]}))


if __name__ == '__main__':
    if not Path('/.dockerenv').exists(): raise RuntimeError('DOCKER_ONLY')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare','freeze','verify','final','github','github-report'])
    command = parser.parse_args().command
    {'prepare':prepare, 'freeze':freeze, 'verify':lambda: print(verify()['freezeCanonicalSha256']),
     'final':final, 'github':github,'github-report':lambda:github(True)}[command]()
