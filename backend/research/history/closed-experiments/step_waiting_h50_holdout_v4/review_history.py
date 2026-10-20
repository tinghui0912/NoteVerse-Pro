"""Resolve literal work-prefix collisions using identity substrings only."""
from hashlib import sha256
import subprocess
from contracts import ROOT, OUT, read, save

PATTERN = r'k331_1[A-Za-z0-9_.-]*'


def vienna_work_prefix_only(values):
    return bool(values) and all(value.lower().startswith('k331_1st-mov') for value in values)


def main():
    path = OUT / 'history-probe.json'
    report = read(path)
    hits = report['gitPathIdentityHits'] + report['gitHistoricalIdentityHits'] + report['currentIdentityHits']
    if not hits or any(set(hit['identityTokens']) != {'k331_1'} for hit in hits):
        raise ValueError('UNSUPPORTED_IDENTITY_HITS_REQUIRE_SEPARATE_PROVENANCE_AUDIT')
    reviewed_history = []
    for hit in report['gitHistoricalIdentityHits']:
        process = subprocess.Popen(['git', 'cat-file', 'blob', hit['blobSha1']], cwd=ROOT, stdout=subprocess.PIPE)
        extraction = subprocess.run(['rg', '--only-matching', '--ignore-case', '--no-filename', PATTERN],
                                    cwd=ROOT, stdin=process.stdout, capture_output=True, text=True)
        process.stdout.close()
        if process.wait() != 0 or extraction.returncode != 0 or extraction.stderr.strip():
            raise ValueError('HISTORICAL_IDENTITY_EXTRACTION_INCOMPLETE')
        values = sorted(set(extraction.stdout.lower().splitlines()))
        if not vienna_work_prefix_only(values):
            raise ValueError('UNRESOLVED_RECORDING_IDENTITY_COLLISION')
        reviewed_history.append({**hit, 'expandedIdentityStrings': values,
            'classification': 'VIENNA_MOZART_K331_1ST_MOV_WORK_PREFIX_NOT_BATIK_RECORDING_ID'})
    reviewed_current = []
    paths = [hit['path'] for hit in report['currentIdentityHits']]
    # All subprocess output is the matched identity substring, never its surrounding values.
    for offset in range(0, len(paths), 40):
        part = paths[offset:offset + 40]
        extraction = subprocess.run(['rg', '--only-matching', '--ignore-case', '--with-filename',
            '--no-line-number', '--no-heading', PATTERN, *part], cwd=ROOT, capture_output=True, text=True)
        if extraction.returncode != 0 or extraction.stderr.strip():
            raise ValueError('CURRENT_IDENTITY_EXTRACTION_INCOMPLETE')
        identities = {}
        for line in extraction.stdout.splitlines():
            file, value = line.rsplit(':', 1)
            identities.setdefault(file.replace(chr(92), '/').lower(), set()).add(value.lower())
        for file in part:
            values = sorted(identities.get(file.lower(), []))
            if not vienna_work_prefix_only(values):
                raise ValueError('UNRESOLVED_CURRENT_IDENTITY_COLLISION:' + file)
            reviewed_current.append({'path': file, 'expandedIdentityStrings': values,
                'classification': 'VIENNA_MOZART_K331_1ST_MOV_WORK_PREFIX_NOT_BATIK_RECORDING_ID'})
    save(OUT / 'history-identity-review.json', {
        'historyProbeSha256': sha256(path.read_bytes()).hexdigest(),
        'historyProbeDeletedGitEvidenceChecked': report['historyProbeDeletedGitEvidenceChecked'],
        'rawWeakToken': 'k331_1', 'resolvedExpandedWorkLabel': 'Mozart_K331_1st-mov',
        'batikExactMidiRecordingId': 'kv331_1', 'batikAudioBasename': 'k331_1.mp3',
        'basis': 'Every raw literal hit extends to the distinct Vienna work label K331_1st-mov. None is the exact Batik MIDI ID, audio filename/path, MIDI SHA256, future audio Git blob, or dataset identity. This is not treating a filename alias or prior performance as fresh.',
        'historyObjectsReviewed': reviewed_history, 'currentFilesReviewed': reviewed_current,
        'allWeakHitsResolvedToViennaWorkPrefix': True,
        'candidateIdentityHitsAfterBoundaryReview': 0,
        'sourceHistoryScope': report['historyCompleteness'],
        'limitation': 'No claim about pruned/unreachable/external execution or unknown future audio byte aliases.',
        'batikMidiEventsParsed': False, 'audioPcmDecoded': False, 'newNeuralRuns': 0})
    print({'reviewedHistoricalObjects': len(reviewed_history), 'reviewedCurrentFiles': len(reviewed_current),
           'candidateIdentityHitsAfterBoundaryReview': 0})


if __name__ == '__main__':
    main()
