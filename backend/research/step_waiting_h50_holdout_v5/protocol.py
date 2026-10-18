"""Metadata protocol setup and immutable remote freeze handling; no audio decode."""
import json
import subprocess
import sys
from urllib.request import Request, urlopen
from contracts import *


def credentials():
    text = subprocess.check_output(['git', 'credential', 'fill'], cwd=ROOT, input='protocol=https\nhost=github.com\n\n', text=True)
    return next(line[9:] for line in text.splitlines() if line.startswith('password='))


def fetch(url, limit=50_000_000, api=False):
    headers = {'User-Agent': 'NoteVerse-DSP-only-preparation'}
    if api: headers |= {'Authorization': 'Bearer ' + credentials(), 'Accept': 'application/vnd.github+json'}
    with urlopen(Request(url, headers=headers), timeout=120) as response: data = response.read(limit + 1)
    if len(data) > limit: raise ValueError('DOWNLOAD_SIZE_LIMIT')
    return data


def github(head):
    base = 'https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'
    combined = json.loads(fetch(base + 'commits/' + head + '/status', api=True))
    statuses = json.loads(fetch(base + 'commits/' + head + '/statuses?per_page=100', api=True))
    runs = json.loads(fetch(base + 'actions/runs?head_sha=' + head + '&per_page=100', api=True))
    return {'queriedAt': now(), 'head': head, 'combinedState': combined['state'], 'statuses': statuses,
            'workflow_runs': runs['workflow_runs'], 'workflowRunTotalCount': runs['total_count'],
            'ciInterpretation': 'NOT CI PASS' if combined['state'] == 'pending' and not statuses and not runs['total_count'] else 'ACTUAL_GITHUB_RESULTS_ONLY_NOT_LOCAL_CI'}


def setup():
    remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if remote != START or git('rev-parse', 'HEAD') != START: raise ValueError('STARTING_HEAD_MISMATCH')
    dependencies, seal_sha = verify_dependencies()
    ahead, behind = git('rev-list', '--left-right', '--count', 'HEAD...origin/codex/customer-web-delivery-boundary').split()
    save(OUT / 'starting-gate.json', {'localHead': START, 'remoteHead': remote, 'mergeBase': git('merge-base', 'HEAD', remote),
        'ahead': int(ahead), 'behind': int(behind), 'completeCommitChain': [], 'productionDiff': '', 'github': github(START)})
    url = 'https://raw.githubusercontent.com/pymatchmaker/matchmaker_benchmark/1b8b3bf8c85e127d86d15e743d08ce6428b35832/docs/eval-protocol.md'
    data = fetch(url)
    normalized = ' '.join(data.decode().split())
    if 'audio that is synchronous with the MIDI by construction' not in normalized: raise ValueError('PUBLISHER_SYNC_EVIDENCE_UNAVAILABLE')
    WORK.mkdir(parents=True, exist_ok=True)
    with (WORK / 'publisher-eval-protocol.md').open('xb') as file: file.write(data)
    sync = {'repository': 'pymatchmaker/matchmaker_benchmark', 'commit': '1b8b3bf8c85e127d86d15e743d08ce6428b35832',
            'file': 'docs/eval-protocol.md', 'sha256': digest(data), 'url': url,
            'conclusion': 'PUBLISHER_ZERO_TRANSFORM_SYNCHRONIZATION_CONTRACT', 'alignmentTransformSeconds': 0,
            'independentSamplePerfectSynchronizationMeasured': False,
            'statementMeaning': 'Batik corpus performance MIDI replayed/recorded on JKU Disklavier, synchronous by construction; not the commercial pianist release.',
            'audioDownloaded': False}
    save(OUT / 'publisher-sync-evidence.json', sync)
    combined = read(V4 / 'combined-truth-topology.json')
    cases = combined['viennaCasesUnchanged'] | combined['batikGapFillCases']
    if len(cases) != 9: raise ValueError('FROZEN_CASE_COUNT_CHANGED')
    inventory = read(ROOT / 'backend/research/reports/step_waiting_h50_holdout_v3/source-inventory.json')
    sources = {}
    for family, case in cases.items():
        ident = case['recordingId']
        if case['dataset'] == 'batik':
            path, expected = SELECTED[ident]
            if case['sourceAudioIdentity']['path'] != path or case['sourceAudioIdentity']['gitBlobSha1'] != expected: raise ValueError('V4_SELECTED_OBJECT_CHANGED')
            sources[ident] = {'recordingId': ident, 'dataset': 'batik', 'path': path, 'expectedGitBlobSha1': expected,
                              'upstreamCommit': UPSTREAM, 'midiSha256': case['midiSha256']}
        else:
            row = next(r for r in inventory['recordings'] if r['dataset'] == 'vienna-4x22' and r['recordingId'] == ident)
            if row['audio']['sha256'] != case['audioSha256'] or row['midi']['sha256'] != case['midiSha256']: raise ValueError('VIENNA_IDENTITY_CHANGED')
            sources[ident] = {'recordingId': ident, 'dataset': 'vienna-4x22', 'audio': row['audio'], 'midi': row['midi'],
                              'midiSha256': case['midiSha256']}
    save(OUT / 'selected-truth-and-sources.json', {'v4TruthTopologySealSha256': seal_sha, 'cases': cases, 'sources': sources})
    save(HERE / 'selected-audio-acquisition-contract.json', {'role': 'SELECTED_AUDIO_ACQUISITION_PROTOCOL_FREEZE',
        'upstreamRepository': 'pymatchmaker/matchmaker-benchmark-data', 'upstreamCommit': UPSTREAM,
        'selected': sources, 'externalAudioObjectCount': 4, 'allOtherExternalAudioRequests': 'REJECT',
        'publisherSynchronizationEvidenceSha256': digest(canonical(sync)), 'publisherFileSha256': sync['sha256'],
        'v4TruthTopologySealSha256': seal_sha, 'v3Dependencies': dependencies, 'HMs': 50,
        'noNeuralExecution': True, 'noReselection': True, 'commercialScope': 'NONCOMMERCIAL_ENGINEERING_QUALIFICATION_SOURCE'})
    environment = read(OUT / 'decoder-environment.json')
    save(HERE / 'decoder-contract.json', {'implementation': 'python-soundfile/libsndfile', 'environment': environment,
        'read': {'dtype': 'float32', 'always_2d': True}, 'mono': 'numpy mean(axis=1,dtype=float32), float32-le bytes',
        'fullDecode': True, 'normalization': False, 'trim': False, 'denoise': False, 'fallback': False,
        'freshProcessTrialsPerSelectedMp3': 3, 'decodeWallTimeNeverChangesSourceTime': True, 'alignmentTransformSeconds': 0})
    save(HERE / 'input-preservation-contract.json', {'HMs': 50, 'rates': [44100, 48000],
        'sourcePreparation': 'Full recording float32 mono, native rate direct; otherwise existing scipy1.14.1 resample_poly(up=rate/gcd,down=native/gcd), default Kaiser5, float32 output, no gain.',
        'existingPreparationReference': 'backend/research/step_waiting_topology_v3/prepare_pcm.py',
        'clipStart': 'floor((first frozen gesture onsetMs - 4350)/20)*20 ms, original recording coordinates',
        'clipEnd': 'ceil((max(last frozen note onsetMs, guard endMs if any)+3000)/20)*20 ms; never clamp or replace',
        'minimumOnsetMs': 5000, 'minimumRemainingRealAudioMs': 3000, 'realPrefixMs': 4350,
        'regionStartAfterClipMs': 1200, 'firstCompleteOwnedCoverageAvailableAfterClipMs': 1970,
        'readiness': 'Source-only real-preroll sufficiency. Actual browser/Worker READY availability is not measured and must be verified next phase, never invented from timeout.',
        'adapter': 'Import production QualifiedSourceAdapter; no FIR copy',
        'windowPlanner': 'Import production planWindow; 29120 samples,600/1050/170 geometry unchanged',
        'identities': {'44100': '32e39d991c47f5dbe1f13d2f77cf2a652d6a5da34cb5051ff43c0155b91edca5',
                       '48000': '6003b89c69965259baf9b329be6faec19128e6e5743be952c23069fb8673da17'},
        'reference': 'Adapter from full recording source origin 0 through needed context; compare every full model window against same absolute window from real-context clip. Exact float32 bytes/SHA, no tolerance.',
        'scheduling': 'Same clip/model input for all causal product schedules; target/READY/publication rules do not enter DSP.',
        'sampleCoordinates': 'Keep original float MIDI times. Integer fixture coordinates floor(time*rate+0.5), never rewrite MIDI time.',
        'neuralExecution': False})
    print({'v4TruthTopologySealSha256': seal_sha, 'publisherFileSha256': sync['sha256'], 'selectedBatikAudioObjects': 4})


def freeze(mode):
    name = 'audio-acquisition-protocol-freeze' if mode == 'acquisition' else 'primary-acoustic-qualification-freeze'
    if git('status', '--porcelain'): raise ValueError('COMMIT_SOURCE_AND_EVIDENCE_BEFORE_FREEZE')
    if mode == 'acquisition':
        tests = read(OUT / 'focused-tests.json'); node = read(OUT / 'node-tests.json')
        if tests['failed'] or tests['errors'] or node['failed']: raise ValueError('FOCUSED_TESTS_FAILED')
    else:
        require_protocol()
        if not read(OUT / 'exact-byte-exposure-audit.json')['eligible']: raise ValueError('SOURCE_EXPOSURE_GATE_FAILED')
        if read(OUT / 'actual-audio-context.json')['invalidCases']: raise ValueError('REAL_CONTEXT_GATE_FAILED')
        inputs = read(OUT / 'input-preservation.json')
        if inputs['mismatches'] or inputs['totalCases'] != 9 or inputs['totalRateJobs'] != 18: raise ValueError('INPUT_PRESERVATION_GATE_FAILED')
        if read(OUT / 'scenario-manifest.json')['totalScenarios'] != 20: raise ValueError('SCENARIO_COVERAGE_INCOMPLETE')
    paths = git('ls-files', HERE.relative_to(ROOT).as_posix(), OUT.relative_to(ROOT).as_posix()).splitlines()
    paths += [r['path'] for r in verify_dependencies()[0]]
    paths += [str((V4 / 'truth-topology-seal.json').relative_to(ROOT)), str((V4 / 'combined-truth-topology.json').relative_to(ROOT))]
    paths += ['apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts',
              'apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts',
              'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json',
              'apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json',
              'apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts',
              'apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts',
              'apps/customer-web/public/model-assets/practice-acoustic/fir-160-441.f32',
              'apps/customer-web/public/model-assets/practice-acoustic/fir-1-3.f32']
    if mode == 'primary':
        paths += [r['localPath'] for r in read(OUT / 'audio-acquisition.json')['objects']]
        paths += [r['pcmPath'] for r in read(OUT / 'decoded-audio.json')['sources'].values()]
        trials = read(OUT / 'source-rate-trials.json')
        paths += [r['path'] for r in trials['sourceTrials'].values()]
        paths += [r['clipPath'] for r in trials['jobs']]
        paths += ['backend/data/work/step_waiting_h50_holdout_v5/audio_only/jobs.json']
    value = {'role': 'SELECTED_AUDIO_ACQUISITION_PROTOCOL_FREEZE' if mode == 'acquisition' else 'PRIMARY_ACOUSTIC_QUALIFICATION_FREEZE',
             'implementationCommit': git('rev-parse', 'HEAD'), 'files': [{'path': p, 'sha256': digest((ROOT / p).read_bytes())} for p in sorted(set(paths))],
             'HMs': 50, 'newNeuralRuns': 0, 'RobustSessionRuns': 0}
    value['freezeCanonicalSha256'] = digest(canonical(value))
    save(OUT / (name + '.json'), value); print(value['freezeCanonicalSha256'])


def verify(mode):
    name = 'audio-acquisition-protocol-freeze' if mode == 'acquisition' else 'primary-acoustic-qualification-freeze'
    file = OUT / (name + '.json'); value = read(file)
    commit = git('log', '-1', '--format=%H', '--', str(file.relative_to(ROOT)))
    subprocess.run(['git', 'fetch', 'origin', 'codex/customer-web-delivery-boundary'], cwd=ROOT, check=True)
    remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if commit != remote or git('rev-parse', 'HEAD') != commit: raise ValueError('REMOTE_FREEZE_MISMATCH_STOP')
    payload = dict(value); claimed = payload.pop('freezeCanonicalSha256')
    if digest(canonical(payload)) != claimed: raise ValueError('FREEZE_DIGEST_MISMATCH')
    for row in value['files']:
        if digest((ROOT / row['path']).read_bytes()) != row['sha256']: raise ValueError('FROZEN_INPUT_CHANGED')
    if git('diff', '--name-only', START, 'HEAD', '--', *PROTECTED): raise ValueError('PROTECTED_SOURCE_CHANGED')
    proof = {'freezeCommit': commit, 'remoteHead': remote, 'freezeSha256': claimed, 'remoteVerifiedAt': now(),
             'newNeuralRuns': 0, 'RobustSessionRuns': 0}
    save(OUT / ('pre-audio-remote-proof.json' if mode == 'acquisition' else 'primary-freeze-remote-proof.json'), proof)
    print(proof)


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'setup': setup()
    elif command == 'freeze': freeze(sys.argv[2])
    elif command == 'verify': verify(sys.argv[2])
