"""Research-only source-purpose authorization and immutable v3 dependencies."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'backend/research/reports/step_waiting_h50_holdout_v4'
WORK = ROOT / 'backend/data/work/step_waiting_h50_holdout_v4'
V3 = ROOT / 'backend/research/step_waiting_h50_holdout_v3'
V3_REPORT = ROOT / 'backend/research/reports/step_waiting_h50_holdout_v3'
START = 'd240ea220d900d805d17e4731ec602d1e914efd6'
MISSING = ('same_pitch_sustain', 'single_busy_retrigger', 'post_ready_repeat',
           'multiple_wrong_then_correct', 'partial_then_full')
EXPECTED_BASELINE = dict(correct_single=8, correct_chord=17, same_pitch_sustain=0,
                         same_chord_sustain=1, single_busy_retrigger=0,
                         chord_busy_retrigger=2, post_ready_repeat=0,
                         multiple_wrong_then_correct=0, partial_then_full=0)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False).encode()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as file:
        json.dump(value, file, indent=2, allow_nan=False)
        file.write('\n')


def verify_v3():
    freeze = read(V3_REPORT / 'selector-freeze.json')
    identity = dict(freeze)
    claimed = identity.pop('freezeCanonicalSha256')
    if sha256(canonical(identity)).hexdigest() != claimed:
        raise ValueError('V3_FREEZE_IDENTITY_CHANGED')
    names = {'eligibility.py', 'pair_identity.py', 'selector.py',
             'selector-contract.json', 'scorer-contract.json', 'select_truth.py'}
    rows = [row for row in freeze['files'] if Path(row['path']).name in names]
    if len(rows) != len(names):
        raise ValueError('V3_DEPENDENCY_INCOMPLETE')
    for row in rows:
        if sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('V3_DEPENDENCY_CHANGED:' + row['path'])
    return rows


def primary_eligibility(source):
    """License permission and authorized purpose are independent required facts."""
    required = ('licenseKnown', 'researchUsePermitted',
                'primaryQualificationRolePermitted', 'pairingEstablished',
                'provenanceComplete', 'historyComplete')
    reasons = [key for key in required if source.get(key) is not True]
    if source.get('trainingOverlapStatus') not in (
            'NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
            'NO_DOCUMENTED_TRAINING_OVERLAP_IN_INSPECTED_UPSTREAM_DECLARATION'):
        reasons.append('TRAINING_OVERLAP_NOT_CLEARED_FOR_ENGINEERING_SCOPE')
    for key in ('historicalAcousticExposure', 'historicalProductDesignExposure'):
        if source.get(key) is not False:
            reasons.append(key)
    return {'eligible': not reasons, 'reasons': reasons}


def gap_fill(selected):
    if any(family not in MISSING for family in selected):
        raise ValueError('CANNOT_REPLACE_COVERED_VIENNA_FAMILY')
    return {family: selected[family] for family in MISSING if family in selected}


def require_remote_proof(freeze, proof, started):
    payload = dict(freeze)
    claimed = payload.pop('freezeCanonicalSha256')
    if sha256(canonical(payload)).hexdigest() != claimed:
        raise ValueError('DISCOVERY_FREEZE_DIGEST')
    if (proof.get('remoteHead') != proof.get('freezeCommit') or
            proof.get('freezeSha256') != claimed or
            not proof.get('remoteVerifiedAt', '~') < started):
        raise ValueError('MIDI_PARSE_REQUIRES_PROSPECTIVE_REMOTE_PROOF')
    for row in freeze['files']:
        if sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('FROZEN_DISCOVERY_INPUT_CHANGED:' + row['path'])
    verify_v3()
