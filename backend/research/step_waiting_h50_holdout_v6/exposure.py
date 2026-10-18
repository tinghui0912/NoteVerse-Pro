"""Additive exact-byte identity audit, never returns acoustic result values."""
import os
import subprocess
from pathlib import Path
from contracts import *

TEXT = {'.json', '.jsonl', '.md', '.txt', '.csv', '.tsv', '.py', '.mjs', '.js', '.ts', '.tsx', '.yaml', '.yml', '.toml', '.match'}
ALLOWED_METADATA = ('backend/research/step_waiting_h50_holdout_v5/', 'backend/research/reports/step_waiting_h50_holdout_v5/', 'backend/data/work/step_waiting_h50_holdout_v5/', 'backend/research/step_waiting_h50_holdout_v4/', 'backend/research/reports/step_waiting_h50_holdout_v4/',
                    'backend/data/work/step_waiting_h50_holdout_v4/', 'backend/research/step_waiting_h50_holdout_v6/',
                    'backend/research/reports/step_waiting_h50_holdout_v6/', 'backend/data/work/step_waiting_h50_holdout_v6/')


def prior_exposure_or_unknown(path):
    return not path.replace(chr(92), '/').startswith(ALLOWED_METADATA)


def main():
    proof = require_protocol(); started = now()
    objects = read(OUT / 'audio-acquisition.json')['objects']
    tokens = sorted({r[k].lower() for r in objects for k in ('audioSha256', 'actualGitBlobSha1', 'recordingId', 'path')})
    needles = [token.encode('ascii') for token in tokens]
    if git('rev-parse', '--is-shallow-repository') != 'false': raise ValueError('EXPOSURE_HISTORY_INCOMPLETE')
    listing = git('rev-list', '--objects', '--all').splitlines()
    historical = []; blobs = 0; total_bytes = 0
    child = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for line in listing:
        parts = line.split(' ', 1)
        if len(parts) != 2 or Path(parts[1]).suffix.lower() not in TEXT: continue
        oid, path = parts
        child.stdin.write((oid + '\n').encode()); child.stdin.flush()
        header = child.stdout.readline().split()
        if len(header) != 3 or header[1] != b'blob': raise ValueError('GIT_OBJECT_PROVENANCE_INCOMPLETE')
        remaining = int(header[2]); total_bytes += remaining; found = set(); tail = b''
        while remaining:
            data = child.stdout.read(min(remaining, 1024 * 1024)); remaining -= len(data)
            if not data: raise ValueError('HISTORY_READ_TRUNCATED')
            block = tail + data.lower()
            found.update(n.decode() for n in needles if n in block); tail = block[-512:]
        if child.stdout.read(1) != b'\n': raise ValueError('HISTORY_FRAMING')
        blobs += 1
        if found: historical.append({'blobSha1': oid, 'path': path, 'identityTokens': sorted(found),
            'classification': 'UNKNOWN_PRIOR_PROVENANCE' if prior_exposure_or_unknown(path) else 'FROZEN_TRUTH_METADATA_OR_CURRENT_PHASE_ONLY_NOT_ACOUSTIC_OUTPUT'})
    child.stdin.close()
    if child.wait(): raise ValueError('HISTORY_AUDIT_FAILED')
    token_file = WORK / 'exact-byte-exposure-tokens.txt'; token_file.write_text('\n'.join(tokens) + '\n', encoding='ascii')
    command = ['rg', '--only-matching', '--with-filename', '--no-line-number', '--no-heading', '--ignore-case', '--fixed-strings',
               '--hidden', '--no-ignore', '--text', '--file', str(token_file)]
    for ext in sorted(TEXT): command += ['--glob', '*' + ext]
    for excluded in ('.git', 'node_modules', '.venv', '__pycache__', 'step_waiting_h50_holdout_v6'):
        command += ['--glob', '!**/' + excluded + '/**']
    command += ['backend/research/reports', 'backend/data/work']
    scan = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if scan.returncode not in (0, 1) or scan.stderr.strip(): raise ValueError('CURRENT_EXPOSURE_SCOPE_INCOMPLETE')
    current = {}
    for line in scan.stdout.splitlines():
        path, token = line.rsplit(':', 1); path = path.replace(chr(92), '/')
        current.setdefault(path, set()).add(token.lower())
    current = [{'path': p, 'identityTokens': sorted(t), 'classification':
                'UNKNOWN_PRIOR_PROVENANCE' if prior_exposure_or_unknown(p) else 'FROZEN_V4_TRUTH_METADATA_NOT_ACOUSTIC_OUTPUT'} for p,t in current.items()]
    alias_files = []
    files = subprocess.run(['rg', '--files', '--hidden', '--no-ignore', '-g', '*.mp3', '-g', '!**/node_modules/**',
                            '-g', '!**/.git/**', '-g', '!**/step_waiting_h50_holdout_v6/**', 'backend/data/work'],
                           cwd=ROOT, capture_output=True, text=True)
    if files.returncode not in (0, 1) or files.stderr.strip(): raise ValueError('BYTE_ALIAS_SCOPE_INCOMPLETE')
    hashes = {r['audioSha256'] for r in objects}
    accepted_acquisition_paths = {(ROOT/r['localPath']).resolve() for r in objects}
    for path in files.stdout.splitlines():
        if (ROOT/path).resolve() in accepted_acquisition_paths: continue
        if digest((ROOT / path).read_bytes()) in hashes: alias_files.append(path)
    unresolved = [r for r in historical + current if r['classification'] == 'UNKNOWN_PRIOR_PROVENANCE']
    result = dict(proof, executionStartedAt=started, completedAt=now(),
        scope='All reachable Git text objects including deleted history; current reports/data-work; known receipt/manifest files included. Full token identities only, no scores.',
        gitReachableCommits=int(git('rev-list', '--all', '--count')), gitTextBlobs=blobs, gitTextBytes=total_bytes,
        historicalHits=historical, currentHits=current, preexistingExactMp3Aliases=alias_files,
        oldV4HistoryEvidenceSha256=digest((V4 / 'history-probe.json').read_bytes()),
        evidenceInterpretation='V4 is immutable truth-only discovery with audioDownloaded=false and zero neural runs. Current-phase hashes are acquisition/preparation only, never inherited acoustic PASS.',
        unresolvedPriorHits=unresolved, eligible=not unresolved and not alias_files, newNeuralRuns=0)
    save(OUT / 'exact-byte-exposure-audit.json', result)
    print({'historyTextBlobs': blobs, 'unknownPriorHits': len(unresolved), 'exactAliases': len(alias_files), 'eligible': result['eligible']})
    if not result['eligible']: raise ValueError('STEP_WAITING_H50_SELECTED_AUDIO_PREVIOUSLY_EXPOSED_OR_PROVENANCE_UNKNOWN')


if __name__ == '__main__': main()
