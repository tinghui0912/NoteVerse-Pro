"""Identity-only probe of current files and every reachable historical text blob."""
from datetime import datetime, timezone
from hashlib import sha256
import os
from pathlib import Path
import re
import subprocess
from contracts import ROOT, OUT, START, read, save

TEXT = {'.json', '.jsonl', '.md', '.txt', '.csv', '.tsv', '.py', '.mjs', '.js',
        '.ts', '.tsx', '.yaml', '.yml', '.toml', '.ini', '.xml', '.match'}
MIDI = {'.mid', '.midi'}


class IdentityMatcher:
    """Exact case-normalized identity substring search without regex alternation."""
    def __init__(self, tokens):
        self.tokens = tuple(sorted({t.lower().encode('ascii') for t in tokens}))
        guards = {rb'[a-f0-9]{40}' if len(t) >= 40 and re.fullmatch(rb'[a-f0-9]+', t)
                  else re.escape(t[:4]) for t in self.tokens}
        self.guard = re.compile(b'|'.join(sorted(guards)) or rb'(?!)')
        if any(self.guard.search(token) is None for token in self.tokens):
            raise ValueError('IDENTITY_GUARD_MUST_COVER_EVERY_TOKEN')

    def matches(self, data):
        if self.guard.search(data) is None:
            return []
        return [token.decode('ascii') for token in self.tokens if token in data]


def identity_hits(pattern, data):
    if isinstance(pattern, IdentityMatcher):
        return pattern.matches(data)
    return [m.group().decode('ascii') for m in pattern.finditer(data)]


def scan_stream(file, size, pattern, midi_hashes, is_midi=False):
    left = size
    tail = b''
    found = set()
    digest = sha256() if is_midi else None
    while left:
        data = file.read(min(left, 1024 * 1024))
        if not data:
            raise ValueError('HISTORY_STREAM_TRUNCATED')
        left -= len(data)
        if digest is not None:
            digest.update(data)
        else:
            block = tail + data.lower()
            found.update(identity_hits(pattern, block))
            tail = block[-512:]
    if digest is not None and digest.hexdigest() in midi_hashes:
        found.add(digest.hexdigest())
    return sorted(found)


def main():
    started = datetime.now(timezone.utc).isoformat()
    manifest = read(OUT / 'batik-byte-manifest.json')
    if subprocess.check_output(['git', 'rev-parse', '--is-shallow-repository'], cwd=ROOT, text=True).strip() != 'false':
        raise ValueError('UNKNOWN_PROVENANCE_SHALLOW_HISTORY')
    tokens = {'batik', 'matchmaker-benchmark-data'}
    midi_hashes = set()
    for row in manifest['performances']:
        tokens.update([row['recordingId'], row['midi']['sha256'], row['audio']['gitBlobSha1'],
                       row['midi']['upstreamPath'], row['audio']['path'],
                       Path(row['audio']['path']).stem])
        midi_hashes.add(row['midi']['sha256'])
    pattern = IdentityMatcher(tokens)
    listing = subprocess.check_output(['git', 'rev-list', '--objects', '--all'], cwd=ROOT, text=True)
    objects = []
    path_hits = []
    for line in listing.splitlines():
        parts = line.split(' ', 1)
        if len(parts) != 2:
            continue
        oid, path = parts
        hit = identity_hits(pattern, path.lower().encode())
        if hit:
            path_hits.append({'object': oid, 'path': path, 'identityTokens': sorted(set(hit))})
        if Path(path).suffix.lower() in TEXT | MIDI:
            objects.append((oid, path))
    process = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    hits = []
    total_bytes = 0
    scanned = 0
    try:
        for oid, path in objects:
            process.stdin.write((oid + '\n').encode())
            process.stdin.flush()
            header = process.stdout.readline().decode().strip().split()
            if len(header) != 3 or header[1] != 'blob':
                raise ValueError('UNKNOWN_PROVENANCE_GIT_BLOB_MISSING')
            size = int(header[2])
            matched = scan_stream(process.stdout, size, pattern, midi_hashes, Path(path).suffix.lower() in MIDI)
            if process.stdout.read(1) != b'\n':
                raise ValueError('HISTORY_BATCH_FRAMING')
            scanned += 1
            total_bytes += size
            if scanned % 5000 == 0:
                print('Historical blobs scanned:', scanned, flush=True)
            if matched:
                hits.append({'blobSha1': oid, 'historicalPath': path, 'identityTokens': matched})
        process.stdin.close()
        if process.wait() != 0:
            raise ValueError('HISTORY_PROBE_FAILED')
    finally:
        if process.poll() is None:
            process.kill()
    current_hits = []
    current_files = 0
    current_bytes = 0
    errors = []
    from contracts import WORK
    token_file = WORK / 'identity-search-tokens.txt'
    token_file.write_text('\n'.join(sorted(tokens)) + '\n', encoding='ascii')
    command = ['rg', '--only-matching', '--with-filename', '--no-line-number', '--no-heading',
               '--ignore-case', '--fixed-strings',
               '--text', '--hidden', '--no-ignore', '--file', str(token_file)]
    for extension in sorted(TEXT):
        command += ['--glob', '*' + extension]
    for excluded in ('.git', 'node_modules', '.venv', '__pycache__', 'step_waiting_h50_holdout_v4'):
        command += ['--glob', '!**/' + excluded + '/**']
    command += ['backend/research/reports', 'backend/data/work']
    probe = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    matched_paths = {}
    for line in probe.stdout:
        path, token = line.rstrip('\n').rsplit(':', 1)
        relative = path.replace(chr(92), '/')
        matched_paths.setdefault(relative.lower(), {'path': relative, 'identityTokens': set()})['identityTokens'].add(token.lower())
    error = probe.stderr.read()
    if probe.wait() not in (0, 1) or error.strip():
        raise ValueError('UNKNOWN_PROVENANCE_RG_SCAN_INCOMPLETE:' + error)
    current_hits = [{'path': row['path'], 'identityTokens': sorted(row['identityTokens'])}
                    for row in matched_paths.values()]
    for relative in ['backend/research/reports', 'backend/data/work']:
        directory = ROOT / relative
        extended_prefix = chr(92) * 2 + '?' + chr(92)
        walk_root = extended_prefix + str(directory) if os.name == 'nt' else str(directory)
        def onerror(error):
            errors.append(str(error))
        for folder, dirs, files in os.walk(walk_root, onerror=onerror, followlinks=False):
            dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '.venv', '__pycache__',
                                                    'step_waiting_h50_holdout_v4'} and not Path(folder, d).is_symlink()]
            for name in files:
                path = Path(folder, name)
                if path.suffix.lower() not in TEXT | MIDI or path.is_symlink():
                    continue
                try:
                    size = path.stat().st_size
                    printable = str(path).removeprefix(extended_prefix)
                    relative_path = str(Path(printable).relative_to(ROOT)).replace(chr(92), '/')
                    matched = []
                    if path.suffix.lower() in MIDI:
                        with path.open('rb') as file:
                            matched = scan_stream(file, size, pattern, midi_hashes, path.suffix.lower() in MIDI)
                    current_files += 1
                    current_bytes += size
                    if current_files % 10000 == 0:
                        print('Current metadata files scanned:', current_files, flush=True)
                    if matched:
                        current_hits.append({'path': relative_path,
                                             'identityTokens': matched})
                except OSError as error:
                    errors.append(str(error))
    changes = subprocess.check_output(['git', 'log', '--all', '--format=%H', '--name-status',
                                      '--diff-filter=DR', '--find-renames'], cwd=ROOT)
    report = {
        'executionStartedAt': started, 'completedAt': datetime.now(timezone.utc).isoformat(),
        'historyAtStartingHead': START,
        'scope': 'All reachable --all Git objects including deleted/renamed text and MIDI; current reports and project data/work only, excluding newly generated v4. Identity-only output, no model values.',
        'gitShallow': False,
        'gitReachableCommitCount': int(subprocess.check_output(['git', 'rev-list', '--all', '--count'], cwd=ROOT)),
        'gitAllRefs': subprocess.check_output(['git', 'show-ref'], cwd=ROOT, text=True).splitlines(),
        'gitHistoricalBlobCount': scanned, 'gitHistoricalBytesScanned': total_bytes,
        'gitPathIdentityHits': path_hits, 'gitHistoricalIdentityHits': hits,
        'deletedRenamedHistoryIndexSha256': sha256(changes).hexdigest(),
        'deletedRenamedHistoryIndexLines': len(changes.splitlines()),
        'historyProbeDeletedGitEvidenceChecked': True,
        'currentFilesScanned': current_files, 'currentBytesScanned': current_bytes,
        'currentTextScanner': 'rg fixed-string ignore-case full scope; --only-matching identities with filenames, never model values; binary MIDI SHA separately',
        'currentTextFilesMatched': len(matched_paths),
        'currentIdentityHits': current_hits, 'readErrors': errors,
        'historyCompleteness': 'COMPLETE_FOR_REACHABLE_REPOSITORY_REFS_AND_SCOPED_CURRENT_FILES' if not errors else 'UNKNOWN_PROVENANCE',
        'unreachablePrunedExternalHistoryClaim': False,
        'identityTokensSha256': sha256('\n'.join(sorted(tokens)).encode()).hexdigest(),
        'candidateMidiEventsParsed': False, 'audioPcmDecoded': False, 'newNeuralRuns': 0}
    save(OUT / 'history-probe.json', report)
    print({k: report[k] for k in ['gitReachableCommitCount', 'gitHistoricalBlobCount',
                                'currentFilesScanned', 'historyCompleteness']})
    print('Identity hits:', len(path_hits), len(hits), len(current_hits))
    if errors:
        raise ValueError('STOP_HISTORY_COMPLETENESS_UNKNOWN')


if __name__ == '__main__':
    main()
