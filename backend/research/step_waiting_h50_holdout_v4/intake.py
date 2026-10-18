"""Bounded metadata/MIDI byte acquisition; never requests an audio object."""
import csv
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
from urllib.request import Request, urlopen
from contracts import ROOT, OUT, WORK, HERE, START, read, save


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def credential():
    result = subprocess.check_output(['git', 'credential', 'fill'], cwd=ROOT,
                                     input='protocol=https\nhost=github.com\n\n', text=True)
    return next(line[9:] for line in result.splitlines() if line.startswith('password='))


def request(url, limit=4_000_000, token=None):
    headers = {'User-Agent': 'NoteVerse-truth-metadata-only'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
        headers['Accept'] = 'application/vnd.github+json'
    with urlopen(Request(url, headers=headers), timeout=90) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('METADATA_OR_MIDI_SIZE_LIMIT')
    return data


def api(path, token):
    return json.loads(request('https://api.github.com/' + path, token=token))


def github_snapshot(head):
    token = credential()
    base = 'repos/tinghui0912/NoteVerse-Pro/'
    combined = api(base + 'commits/' + head + '/status', token)
    statuses = api(base + 'commits/' + head + '/statuses?per_page=100', token)
    runs = api(base + 'actions/runs?head_sha=' + head + '&per_page=100', token)
    return {'queriedAt': datetime.now(timezone.utc).isoformat(), 'head': head,
            'combinedState': combined['state'], 'statuses': statuses,
            'workflow_runs': runs['workflow_runs'], 'workflowRunTotalCount': runs['total_count'],
            'ciInterpretation': 'NOT CI PASS' if combined['state'] == 'pending' and not statuses and not runs['total_count']
            else 'ACTUAL_GITHUB_RESULTS_ONLY_LOCAL_TESTS_NOT_CI'}


def starting_gate():
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head != START or remote != START:
        raise ValueError('STARTING_GATE_MISMATCH')
    ahead, behind = git('rev-list', '--left-right', '--count', 'HEAD...origin/codex/customer-web-delivery-boundary').split()
    save(OUT / 'starting-gate.json', {
        'startingRemoteHead': START, 'localHead': head, 'remoteHead': remote,
        'mergeBase': git('merge-base', head, remote), 'ahead': int(ahead), 'behind': int(behind),
        'interveningCommits': [], 'productionDiff': git('diff', START, 'HEAD', '--',
            'apps/customer-web/src', 'apps/customer-web/public', 'backend/app'),
        'github': github_snapshot(head), 'audioPcmDecoded': False, 'newNeuralRuns': 0})


def fetch_batik():
    baseline = read(OUT / 'corrected-baseline.json')
    if not baseline['matchesExpected']:
        raise ValueError('BASELINE_REQUIRED_BEFORE_EXTERNAL_INTAKE')
    policy = read(HERE / 'source-policy.json')
    scope = policy['externalScope']
    commit = scope['commit']
    token = credential()
    repo = 'repos/' + scope['repository'] + '/'
    identity = api(repo + 'commits/' + commit, token)
    if identity['sha'] != commit:
        raise ValueError('UPSTREAM_COMMIT_IDENTITY')
    root_tree = api(repo + 'git/trees/' + commit, token)
    batik_tree = next(row for row in root_tree['tree'] if row['path'] == 'batik' and row['type'] == 'tree')
    tree = api(repo + 'git/trees/' + batik_tree['sha'] + '?recursive=1', token)
    if tree.get('truncated'):
        raise ValueError('BATIK_TREE_INCOMPLETE')
    blobs = {'batik/' + row['path']: row for row in tree['tree'] if row['type'] == 'blob'}
    raw_base = 'https://raw.githubusercontent.com/' + scope['repository'] + '/' + commit + '/'
    snapshots = []
    for path in ['README.md', 'LICENSING.md', 'LICENSE.md', 'batik/ATTRIBUTION.md', 'batik/metadata-batik.csv']:
        data = request(raw_base + path)
        local = WORK / 'upstream' / path
        local.parent.mkdir(parents=True, exist_ok=True)
        with local.open('xb') as file:
            file.write(data)
        snapshots.append({'path': path, 'localPath': local.relative_to(ROOT).as_posix(),
                          'sha256': sha256(data).hexdigest(), 'bytes': len(data), 'url': raw_base + path})
    metadata = (WORK / 'upstream/batik/metadata-batik.csv').read_bytes()
    rows = list(csv.DictReader(io.StringIO(metadata.decode('utf-8-sig'))))
    if len(rows) != 36 or len({r['midi'] for r in rows}) != 36:
        raise ValueError('BATIK_EXPECTED_36_PERFORMANCES')
    intended = []
    for index, row in enumerate(rows):
        midi = row['midi']
        if not midi.startswith('batik/midi/') or PurePosixPath(midi).suffix != '.mid' or '..' in PurePosixPath(midi).parts:
            raise ValueError('NON_BATIK_MIDI_DOWNLOAD_BLOCKED')
        audio = blobs[row['audio']]
        data = request(raw_base + midi)
        if data[:4] != b'MThd':
            raise ValueError('NOT_MIDI_BYTES')
        local = WORK / 'upstream' / midi
        local.parent.mkdir(parents=True, exist_ok=True)
        with local.open('xb') as file:
            file.write(data)
        # Byte hashing only: no musical events are parsed in this acquisition tool.
        item = {'dataset': 'batik', 'recordingId': PurePosixPath(midi).stem,
                'sourceRepository': scope['repository'], 'sourceRepositoryCommit': commit,
                'metadataRowIndex': index + 1, 'metadataRowSha256': sha256(json.dumps(row, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                'metadataRow': row, 'midi': {'path': local.relative_to(ROOT).as_posix(),
                    'upstreamPath': midi, 'sha256': sha256(data).hexdigest(), 'bytes': len(data), 'gitBlobSha1': blobs[midi]['sha']},
                'audio': {'path': row['audio'], 'sha256': None, 'gitBlobSha1': audio['sha'],
                          'upstreamBytes': audio['size'], 'downloaded': False,
                          'identityRole': 'FUTURE_COMPRESSED_AUDIO_OBJECT_NOT_PCM_IDENTITY'}}
        intended.append(item)
    upstream = policy['upstreamTraining']
    url = 'https://raw.githubusercontent.com/' + upstream['repository'] + '/' + upstream['commit'] + '/' + upstream['path']
    training = request(url)
    local = WORK / 'upstream-training-README.md'
    with local.open('xb') as file:
        file.write(training)
    text = training.decode('utf-8')
    if upstream['expectedDeclaration'] not in text:
        raise ValueError('EXPECTED_UPSTREAM_TRAINING_DECLARATION_ABSENT')
    if 'batik' in text.lower():
        raise ValueError('BATIK_MENTION_IN_TRAINING_DECLARATION_REQUIRES_STOP_AND_AUDIT')
    attribution = (WORK / 'upstream/batik/ATTRIBUTION.md').read_text(encoding='utf-8')
    if not all(term in attribution for term in ['36 mp3', 'Performance MIDI', 'Disklavier', 'Johannes Kepler', 'timing and', 'dynamics', 'CC BY-NC-SA 4.0']):
        raise ValueError('PROVENANCE_GATE_INCOMPLETE')
    save(OUT / 'batik-byte-manifest.json', {
        'repository': scope['repository'], 'branch': scope['branch'], 'commit': commit,
        'fetchedAt': datetime.now(timezone.utc).isoformat(), 'dataset': 'batik',
        'metadataSnapshots': snapshots, 'performances': intended, 'midiFileCount': len(intended),
        'license': 'CC BY-NC-SA 4.0',
        'pairingProvenance': 'Publisher metadata binds 36 performance MIDI/audio pairs; JKU Disklavier replay of Roland Batik human MIDI timing/dynamics, not the commercial recording. Audio alignment and codec PCM not independently measured.',
        'trainingOverlapEvidence': {'url': url, 'commit': upstream['commit'],
            'sha256': sha256(training).hexdigest(), 'localPath': local.relative_to(ROOT).as_posix(),
            'declaration': 'MAESTRO dataset V2.0.0',
            'batik': 'NO_DOCUMENTED_TRAINING_OVERLAP_IN_INSPECTED_UPSTREAM_DECLARATION',
            'limitation': 'Upstream published declaration plus local Robust lineage evidence; not a proof of exclusion from all training.'},
        'audioDownloaded': False, 'audioPcmDecoded': False, 'newNeuralRuns': 0,
        'batikMidiEventsParsed': False})
    print('Downloaded metadata and hashed MIDI bytes only:', len(intended))


if __name__ == '__main__':
    {'starting': starting_gate, 'fetch': fetch_batik}[sys.argv[1]]()
