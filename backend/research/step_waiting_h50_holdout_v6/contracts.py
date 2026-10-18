"""Immutable identities and fail-closed gates for DSP-only preparation."""
from datetime import datetime, timezone
from hashlib import sha256, sha1
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'backend/research/reports/step_waiting_h50_holdout_v6'
WORK = ROOT / 'backend/data/work/step_waiting_h50_holdout_v6'
START = '63d33bf85d3c71d4a06fce326dbb49a5ba38b8b2'
IMAGE = 'sha256:7feadf65b7763a9ee94880218e3e80f8566ec242ffff7e9ca99d10bb85d76a6f'
UPSTREAM = 'fd1c78749b08182e8c078993fcf0645cd4a0a22e'
V4 = ROOT / 'backend/research/reports/step_waiting_h50_holdout_v4'
SELECTED = {'kv282_1': ('batik/audio/k282_1.mp3', '671220bf04d3bb2fa7061051e9a8bbc437d469c5'),
            'kv279_3': ('batik/audio/k279_3.mp3', '0abf27cc2147a3d74b06a2402ec0e74a4235bf6a'),
            'kv281_1': ('batik/audio/k281_1.mp3', 'e1ea552e0e16397268484f47dab9dc57a45417c7'),
            'kv279_2': ('batik/audio/k279_2.mp3', '3cd133fc5e0916e47be35313baf955c138202d99')}
PROTECTED = ['backend/research/step_waiting_h50_holdout_v5', 'backend/research/reports/step_waiting_h50_holdout_v5', 'apps/customer-web/src', 'apps/customer-web/public', 'backend/app',
             'backend/research/step_waiting_h50_holdout_v3', 'backend/research/reports/step_waiting_h50_holdout_v3',
             'backend/research/step_waiting_h50_holdout_v4', 'backend/research/reports/step_waiting_h50_holdout_v4']


def now(): return datetime.now(timezone.utc).isoformat()
def digest(data): return sha256(data).hexdigest()
def canonical(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()
def read(path): return json.loads(path.read_text(encoding='utf-8'))
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as file:
        json.dump(value, file, indent=2, allow_nan=False); file.write('\n')


def object_sha(data): return sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def verify_dependencies():
    freeze = read(ROOT / 'backend/research/reports/step_waiting_h50_holdout_v3/selector-freeze.json')
    needed = {'eligibility.py', 'pair_identity.py', 'selector.py', 'selector-contract.json', 'scorer-contract.json', 'select_truth.py'}
    rows = [r for r in freeze['files'] if Path(r['path']).name in needed]
    if len(rows) != 6: raise ValueError('V3_DEPENDENCY_MISSING')
    for row in rows:
        if digest((ROOT / row['path']).read_bytes()) != row['sha256']: raise ValueError('V3_DEPENDENCY_CHANGED')
    seal = read(V4 / 'truth-topology-seal.json')
    for row in seal['files']:
        if digest((ROOT / row['path']).read_bytes()) != row['sha256']: raise ValueError('V4_SEAL_CHANGED')
    return rows, digest((V4 / 'truth-topology-seal.json').read_bytes())


def verify_sync(evidence):
    if evidence.get('conclusion') != 'PUBLISHER_ZERO_TRANSFORM_SYNCHRONIZATION_CONTRACT' or evidence.get('alignmentTransformSeconds') != 0:
        raise ValueError('PUBLISHER_ZERO_TRANSFORM_CONTRACT_REQUIRED')


def allowed_audio(recording, path):
    if recording not in SELECTED or SELECTED[recording][0] != path:
        raise ValueError('UNSELECTED_AUDIO_REQUEST_REJECTED')
    return SELECTED[recording][1]


def check_object(recording, path, data):
    expected = allowed_audio(recording, path)
    if object_sha(data) != expected:
        raise ValueError('STEP_WAITING_H50_SELECTED_AUDIO_UPSTREAM_OBJECT_MISMATCH')


def require_protocol():
    from portable import validate_portable_freeze_manifest
    freeze = read(OUT / 'portable-predecode-protocol-freeze.json')
    proof = read(OUT / 'portable-predecode-remote-proof.json')
    validate_portable_freeze_manifest(freeze)
    if proof['freezeSha256'] != freeze['freezeCanonicalSha256'] or proof['remoteHead'] != proof['freezeCommit']:
        raise ValueError('PORTABLE_REMOTE_PROOF_INVALID')
    host = read(OUT / 'portable-predecode-host-preflight.json')
    container = read(OUT / 'portable-predecode-container-preflight.json')
    for receipt in (host, container):
        if receipt['status'] != 'PASS' or receipt['freezeSha256'] != proof['freezeSha256'] or receipt['hashMismatches']:
            raise ValueError('DUAL_PREFLIGHT_REQUIRED')
    if not proof['remoteVerifiedAt'] < host['startedAt'] < host['completedAt'] < container['startedAt'] < container['completedAt'] < now():
        raise ValueError('PREDECODE_PROSPECTIVE_ORDER_INVALID')
    verify_dependencies()
    verify_sync(read(OUT / 'publisher-sync-evidence.json'))
    return proof


def context_valid(case, duration):
    times = [n['onsetMs'] for g in case['gestures'] for n in g['notes']]
    end = max(times + ([case['guard']['endMs']] if 'guard' in case else []))
    if min(times) < 5000 or end + 3000 > duration * 1000:
        raise ValueError('STEP_WAITING_H50_FROZEN_TRUTH_OCCURRENCE_AUDIO_CONTEXT_INVALID')
    return {'minimumOnsetMs': min(times), 'lastRequiredTruthTimeMs': end,
            'actualAudioDurationSeconds': duration, 'remainingRealAudioMs': duration * 1000 - end}


def bound_identity(value):
    required = {'v4TruthTopologySealSha256', 'family', 'truthSelectionIdentity', 'recordingId', 'midiSha256',
                'upstreamRepositoryCommit', 'upstreamAudioPath', 'upstreamGitBlobSha1', 'audioSha256',
                'decoderProtocolSha256', 'decodedPcmSha256'}
    if not required <= set(value): raise ValueError('AUDIO_BOUND_IDENTITY_INCOMPLETE')
    return digest(canonical(value))
