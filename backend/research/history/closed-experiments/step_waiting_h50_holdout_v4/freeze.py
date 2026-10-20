"""Create and independently remote-verify the discovery-only freeze."""
from datetime import datetime, timezone
from hashlib import sha256
import subprocess
import sys
from contracts import ROOT, HERE, OUT, START, canonical, read, save, verify_v3
from intake import git


def create():
    if git('status', '--porcelain'):
        raise ValueError('COMMIT_IMPLEMENTATION_BEFORE_FREEZE')
    baseline = read(OUT / 'corrected-baseline.json')
    if not baseline['matchesExpected']:
        raise ValueError('BASELINE_MISMATCH')
    ledger = read(OUT / 'source-authorization-ledger.json')
    if len(ledger['batikEligibleRecordingIds']) != 36:
        raise ValueError('BATIK_ELIGIBILITY_NOT_ESTABLISHED_FOR_ALL_FIXED_SOURCES')
    test = read(OUT / 'focused-tests-review.json')
    if test['failed'] or test['errors'] or test['passed'] != test['tests']:
        raise ValueError('FOCUSED_TEST_FAILURE_STOP')
    paths = git('ls-files', HERE.relative_to(ROOT).as_posix(), OUT.relative_to(ROOT).as_posix()).splitlines()
    paths += [r['path'] for r in verify_v3()]
    paths += [baseline['governanceEvidence']['path'],
              ledger['activeRobustLineage']['activeIdentityPath'],
              ledger['activeRobustLineage']['historicalIdentityPath'],
              'backend/research/reports/step_waiting_h50_holdout_v3/selector-freeze.json',
              'backend/research/reports/step_waiting_h50_holdout_v3/source-inventory.json']
    manifest = read(OUT / 'batik-byte-manifest.json')
    paths += [r['localPath'] for r in manifest['metadataSnapshots']]
    paths += [r['midi']['path'] for r in manifest['performances']]
    paths += [manifest['trainingOverlapEvidence']['localPath']]
    value = {'role': 'EXTERNAL_TRUTH_SOURCE_DISCOVERY_FREEZE',
             'implementationCommit': git('rev-parse', 'HEAD'), 'startingRemoteHead': START,
             'files': [{'path': p, 'sha256': sha256((ROOT / p).read_bytes()).hexdigest()}
                       for p in sorted(set(paths))],
             'HMs': 50, 'batikMidiEventsParsed': False,
             'audioDownloaded': False, 'audioPcmDecoded': False, 'newNeuralRuns': 0,
             'primaryQualificationFreeze': 'NOT_CREATED'}
    value['freezeCanonicalSha256'] = sha256(canonical(value)).hexdigest()
    save(OUT / 'source-discovery-freeze.json', value)
    print(value['freezeCanonicalSha256'])


def verify():
    freeze_path = OUT / 'source-discovery-freeze.json'
    freeze = read(freeze_path)
    value = dict(freeze)
    digest = value.pop('freezeCanonicalSha256')
    if sha256(canonical(value)).hexdigest() != digest:
        raise ValueError('DISCOVERY_FREEZE_DIGEST')
    commit = git('log', '-1', '--format=%H', '--', freeze_path.relative_to(ROOT).as_posix())
    subprocess.run(['git', 'fetch', 'origin', 'codex/customer-web-delivery-boundary'], cwd=ROOT, check=True)
    remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if remote != commit or git('rev-parse', 'HEAD') != commit:
        raise ValueError('REMOTE_DISCOVERY_FREEZE_MISMATCH')
    for row in freeze['files']:
        if sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('FROZEN_INPUT_CHANGED:' + row['path'])
    verify_v3()
    protected = ['apps/customer-web/src', 'apps/customer-web/public', 'backend/app',
                 'backend/research/step_waiting_h50_holdout_v3',
                 'backend/research/reports/step_waiting_h50_holdout_v3']
    if git('diff', '--name-only', START, 'HEAD', '--', *protected):
        raise ValueError('PROTECTED_SOURCE_OR_HISTORY_CHANGED')
    proof = {'freezeCommit': commit, 'remoteHead': remote, 'freezeSha256': digest,
             'remoteVerifiedAt': datetime.now(timezone.utc).isoformat(),
             'batikMidiEventsParsed': False,
             'role': 'PRE_BATIK_EVENT_PARSE_SOURCE_DISCOVERY_PROOF_NOT_ACOUSTIC_QUALIFICATION'}
    save(OUT / 'source-discovery-remote-proof.json', proof)
    print(proof)


if __name__ == '__main__':
    {'create': create, 'verify': verify}[sys.argv[1]]()
