"""Docker-only bounded Zenodo metadata inspection; no media fallback downloads."""

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'backend/data/work/xc3_r1_zenodo'
PHASE = 'PHASE_9G_XC3_R1_ZENODO_PROVENANCE_RECOVERY_AND_FRESH_COMPONENT_SELECTION'
RECORD = 'https://zenodo.org/records/18160555'
API = 'https://zenodo.org/api/records/18160555'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as handle:
        handle.write(data)
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': sha(data), 'bytes': len(data)}


def json_new(path, data):
    return write_new(path, (json.dumps(data, indent=2, ensure_ascii=True) + '\n').encode())


class JsonScripts(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.items = []
        self.attrs = {}
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.attrs = dict(attrs)
        if tag == 'script' and self.attrs.get('type') == 'application/json':
            self.active = True
        for key, value in attrs:
            if value and value.startswith('{'):
                try:
                    self.items.append({'attribute': key, 'value': json.loads(value)})
                except ValueError:
                    pass

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = False

    def handle_data(self, data):
        if self.active:
            try:
                self.items.append({'script': self.attrs, 'value': json.loads(data)})
            except ValueError:
                pass


def bounded_get(url, cap, range_header=None):
    row = {'url': url, 'rangeRequested': range_header, 'readBytes': 0,
           'requestedAt': datetime.now(timezone.utc).isoformat()}
    headers = {'User-Agent': 'NoteVerse-XC3-R1-metadata/1.0', 'Accept-Encoding': 'identity'}
    if range_header:
        headers['Range'] = range_header
    try:
        try:
            response = urlopen(Request(url, headers=headers), timeout=40)
        except HTTPError as error:
            response = error
        with response:
            row.update(httpStatus=response.status, resolvedUrl=response.geturl(),
                       headers=dict(response.headers.items()))
            if range_header and response.status != 206:
                row['rejection'] = 'RANGE_NOT_206_CLOSED_WITHOUT_READING_BODY'
                return row, b''
            if range_header:
                match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
                if not match or int(match[2]) - int(match[1]) + 1 > cap:
                    row['rejection'] = 'INVALID_OR_OVERSIZED_CONTENT_RANGE'
                    return row, b''
                expected = int(match[2]) - int(match[1]) + 1
                row['validatedContentRange'] = list(map(int, match.groups()))
                first, last, total = map(int, match.groups())
                requested = re.fullmatch(r'bytes=(\d+)-(\d+)', range_header)
                suffix = re.fullmatch(r'bytes=-(\d+)', range_header)
                if not ((requested and (first, last) == tuple(map(int, requested.groups())))
                        or (suffix and (first, last) == (total - int(suffix[1]), total - 1))):
                    row['rejection'] = 'CONTENT_RANGE_NOT_EXACT_REQUEST'
                    return row, b''
            else:
                expected = None
            length = response.headers.get('Content-Length')
            if length and int(length) > cap:
                row['rejection'] = 'CONTENT_LENGTH_EXCEEDS_METADATA_CAP'
                return row, b''
            data = response.read(cap + 1)
            row['readBytes'] = len(data)
            if len(data) > cap or (expected is not None and len(data) != expected):
                raise ValueError('BOUNDED_RESPONSE_SIZE_MISMATCH')
            row.update(sha256=sha(data), md5=hashlib.md5(data).hexdigest())
            return row, data
    except Exception as error:
        row['error'] = f'{type(error).__name__}:{error}'
        return row, b''


def probe():
    rows = []
    for name, url in [('api', API), ('record', RECORD),
                      ('readme', RECORD + '/files/readme.txt?download=1'),
                      ('license', RECORD + '/files/license.txt?download=1')]:
        row, data = bounded_get(url, 2 * 1024 * 1024 if name in ('api', 'record') else 65536)
        if data:
            row['snapshot'] = write_new(WORK / f'{name}.raw', data)
            if name == 'api' and row.get('httpStatus') == 200:
                try:
                    row['jsonMetadata'] = json.loads(data)
                except ValueError:
                    row['notJson'] = True
            elif name == 'record' and row.get('httpStatus') == 200:
                row['embeddedJson'] = JsonScripts(data.decode()).items
        rows.append(row)
        time.sleep(2)
    out = {'phase': PHASE, 'requests': rows, 'audioContentReads': 0,
           'midiContentReads': 0, 'newNeuralInferenceCount': 0,
           'downloadedHttpBodyBytes': sum(r['readBytes'] for r in rows)}
    print(json.dumps(json_new(WORK / 'probe.json', out)))


def parse_directory(data, expected_count):
    rows = []
    offset = 0
    while offset < len(data):
        if len(data) - offset < 46:
            raise ValueError('TRUNCATED_CENTRAL_DIRECTORY')
        fields = struct.unpack_from('<4s6H3I5H2I', data, offset)
        if fields[0] != b'PK\x01\x02':
            raise ValueError('CENTRAL_DIRECTORY_SIGNATURE')
        name_size, extra_size, comment_size = fields[10:13]
        end = offset + 46 + name_size + extra_size + comment_size
        if end > len(data) or fields[13] != 0:
            raise ValueError('TRUNCATED_OR_MULTIDISK_MEMBER')
        name = data[offset + 46:offset + 46 + name_size].decode('utf-8' if fields[3] & 2048 else 'cp437')
        if name.startswith(('/', '\\')) or '..' in name.split('/') or '\\' in name or ':' in name:
            raise ValueError('UNSAFE_ZIP_MEMBER_PATH')
        if 0xffffffff in (fields[8], fields[9], fields[16]):
            raise ValueError('ZIP64_MEMBER_REQUIRES_EXPLICIT_SUPPORT')
        rows.append({'path': name, 'compressedBytes': fields[8], 'uncompressedBytes': fields[9],
                     'crc32': f'{fields[7]:08x}', 'compressionMethod': fields[4],
                     'flags': fields[3], 'localHeaderOffset': fields[16]})
        offset = end
    if len(rows) != expected_count:
        raise ValueError('CENTRAL_DIRECTORY_MEMBER_COUNT')
    return rows


def inspect_archive(file):
    url = file['downloadUrl']
    requests = []
    row, data = bounded_get(url, 4, 'bytes=0-3')
    requests.append(row)
    out = {'archive': file, 'requests': requests, 'members': [],
           'fullArchiveMd5LocallyVerified': False, 'memberPayloadBytesRead': 0}
    if row.get('rejection') or row.get('error') or data != b'PK\x03\x04':
        out['status'] = 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED'
        return out
    row, data = bounded_get(url, 22, 'bytes=-22')
    requests.append(row)
    if row.get('rejection') or row.get('error') or len(data) != 22 or data[:4] != b'PK\x05\x06':
        out['status'] = 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED'
        return out
    _, disk, cd_disk, disk_count, count, size, start, comment = struct.unpack('<4s4H2IH', data)
    if (disk or cd_disk or disk_count != count or comment or count == 65535
            or size > 2 * 1024 * 1024 or start + size != file['bytes'] - 22):
        out['status'] = 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED'
        out['reason'] = 'UNSUPPORTED_EOCD_NO_PAYLOAD_SCAN_OR_FULL_DOWNLOAD'
        return out
    row, data = bounded_get(url, size, f'bytes={start}-{start + size - 1}')
    requests.append(row)
    if row.get('rejection') or row.get('error') or len(data) != size:
        out['status'] = 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED'
        return out
    out['members'] = parse_directory(data, count)
    out['directorySnapshot'] = write_new(WORK / (file['name'] + '.central_directory'), data)
    out['status'] = 'BOUNDED_CENTRAL_DIRECTORY_VERIFIED'
    return out


def recover():
    rows = []
    for name, url in [('api_retry', API), ('record_retry', RECORD),
                      ('license_retry', RECORD + '/files/license.txt?download=1'),
                      ('export', RECORD + '/export/json')]:
        row, data = bounded_get(url, 2 * 1024 * 1024 if name != 'license_retry' else 65536)
        if data:
            row['snapshot'] = write_new(WORK / f'{name}.raw', data)
            try:
                row['jsonMetadata'] = json.loads(data)
            except ValueError:
                if name == 'record_retry':
                    row['embeddedJson'] = JsonScripts(data.decode()).items
        rows.append(row)
        time.sleep(3)
    print(json.dumps(json_new(WORK / 'recovery.json', {'phase': PHASE, 'requests': rows,
        'audioContentReads': 0, 'midiContentReads': 0, 'newNeuralInferenceCount': 0})))


def determine_provenance(record, upstream_html):
    owner = record.get('expanded', {}).get('parent', {}).get('access', {}).get('owned_by', {})
    cross_link = RECORD in upstream_html or '10.5281/zenodo.18160555' in upstream_html
    return {'classification': 'ORIGINAL_AUTHOR_ARCHIVAL_DISTRIBUTION_PROVENANCE_ESTABLISHED'
            if cross_link else 'ZENODO_ARCHIVE_PROVENANCE_NOT_SUFFICIENTLY_LINKED',
            'originalPublisherExplicitCrossLinkObserved': cross_link,
            'recordOwner': owner,
            'creatorAttributionAloneEstablishesDepositorIdentity': False,
            'interpretation': 'An original-publisher cross-link can endorse archival provenance. Creator names and author-signed copied files alone do not authenticate a different depositor. Absence of a verified link is not evidence of illegality, falsification or corruption.'}


def git(*args):
    return subprocess.check_output(['git', '-c', 'safe.directory=/workspace',
        '-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false', *args], cwd=ROOT).decode().strip()


def sanitized(row):
    return {k: ({h: v for h, v in value.items() if h.lower() not in ('set-cookie', 'cookie')}
                if k == 'headers' else value)
            for k, value in row.items() if k not in ('jsonMetadata', 'embeddedJson')}


def finalize():
    start = '1f1e05e75cdfba55be75ed71ebe5bedc86dba696'
    probe_data = json.loads((WORK / 'probe.json').read_text())
    recovered = json.loads((WORK / 'recovery.json').read_text())
    requests = probe_data['requests'] + recovered['requests']
    for row in requests:
        if row.get('snapshot'):
            if sha((ROOT / row['snapshot']['path']).read_bytes()) != row['snapshot']['sha256']:
                raise RuntimeError('METADATA_SNAPSHOT_DRIFT')
    embedded = JsonScripts((WORK / 'record_retry.raw').read_text()).items
    record = next(x['value'] for x in embedded if x.get('attribute') == 'data-record')
    exported = json.loads((WORK / 'export.raw').read_text())
    if (record['id'] != '18160555' or exported['id'] != record['id']
            or exported['metadata'] != record['metadata'] or exported['files'] != record['files']):
        raise RuntimeError('INDEPENDENT_METADATA_VIEWS_DISAGREE')
    entries = record['files']['entries']
    documents = []
    for name, filename in [('readme.txt', 'readme.raw'), ('license.txt', 'license_retry.raw')]:
        data = (WORK / filename).read_bytes()
        expected = entries[name]
        if len(data) != expected['size'] or 'md5:' + hashlib.md5(data).hexdigest() != expected['checksum']:
            raise RuntimeError('SMALL_DOCUMENT_CHECKSUM_MISMATCH')
        encoding = 'utf-8' if name == 'readme.txt' else 'iso-8859-1'
        documents.append({'name': name, 'bytes': len(data), 'md5': hashlib.md5(data).hexdigest(),
                          'sha256': sha(data), 'textEncoding': encoding, 'contents': data.decode(encoding)})
    readme = documents[0]['contents']
    if not all(x in readme for x in ('Version 0.4', 'Disklavier', 'ENSTDkCl/ENSTDkAm', 'Valentin Emiya')):
        raise RuntimeError('DISKLAVIER_README_PROVENANCE_NOT_ESTABLISHED')
    legacy_path = ROOT / 'backend/research/reports/phase9g_xc3_maps_provenance_gate_2026-10-16.json'
    legacy = json.loads(legacy_path.read_text())
    upstream_row = legacy['metadataRequests'][0]['attempts'][0]
    upstream_data = (ROOT / upstream_row['snapshot']).read_bytes()
    if sha(upstream_data) != upstream_row['sha256']:
        raise RuntimeError('HISTORICAL_UPSTREAM_SNAPSHOT_CHANGED')
    new_upstream_row, new_upstream_data = bounded_get(
        'https://adasp.telecom-paris.fr/resources/2010-07-08-maps-database/', 256 * 1024)
    if new_upstream_row.get('httpStatus') == 200 and new_upstream_data:
        new_upstream_row['snapshot'] = write_new(WORK / 'upstream_rechecked.html', new_upstream_data)
        upstream_data = new_upstream_data
    requests.append(new_upstream_row)
    provenance = determine_provenance(record, upstream_data.decode('utf-8'))
    if provenance['classification'] != 'ZENODO_ARCHIVE_PROVENANCE_NOT_SUFFICIENTLY_LINKED':
        raise RuntimeError('PROVENANCE_RECOVERED_CONTINUE_TO_RANGE_STAGE_NOT_A_BLOCKER')
    tests = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'backend/research',
        '-p', 'test_xc3_r1_zenodo.py', '-v'], capture_output=True, text=True, check=True, cwd=ROOT)
    changes = git('diff', '--name-status', start).splitlines()
    if any(not r.startswith('A\t') or 'xc3_r1_' not in r for r in changes):
        raise RuntimeError('HISTORICAL_SOURCE_OR_EVIDENCE_MODIFIED')
    files = [{'name': n, 'bytes': r['size'], 'reportedChecksum': r['checksum'], 'links': r['links']}
             for n, r in sorted(entries.items())]
    old_blob = subprocess.check_output(['git', '-c', 'safe.directory=/workspace', 'show',
        start + ':backend/research/reports/phase9g_xc3_maps_provenance_gate_2026-10-16.json'], cwd=ROOT)
    if sha(old_blob) != sha(legacy_path.read_bytes()):
        raise RuntimeError('LEGACY_BLOCKER_BYTES_CHANGED')
    report = {'phase': PHASE, 'startingRemoteHead': start, 'implementationHead': git('rev-parse', 'HEAD'),
        'implementationCommits': git('log', '--reverse', '--format=%H', start + '..HEAD').splitlines(),
        'status': provenance['classification'], 'provenanceChainDetermination': provenance,
        'recordIdentity': {'recordId': record['id'], 'doi': record['pids']['doi']['identifier'],
            'metadataSource': RECORD + ' embedded data-record and ' + RECORD + '/export/json',
            'metadataViewsAgree': True, 'created': record['created'], 'updated': record['updated'],
            'metadata': record['metadata'], 'recordOwnerUserId': record['parent']['access']['owned_by']['user']},
        'fileInventory': files, 'readmeAndLicense': documents,
        'subsetIdentity': {'ENSTDkAm': 'DISKLAVIER_SUB_BASE_PER_CHECKSUM_VERIFIED_README',
            'ENSTDkCl': 'DISKLAVIER_SUB_BASE_PER_CHECKSUM_VERIFIED_README',
            'synchronizationCaution': 'Readme warns about hardware synchronization offsets and pedal-related issues. No correction fitted or MIDI read.'},
        'licenseEvidence': {'fileAndDescription': 'CC BY-NC-SA 2.0 France',
            'structuredZenodoRights': record['metadata']['rights'],
            'structuredRightsMismatch': 'Record structured field says Generic 2.0; description/publisher link/license file identify France. Retained, not silently harmonized.',
            'commercialQualificationStatus': 'NOT_PERFORMED', 'legalOpinion': 'NOT_PERFORMED'},
        'upstreamEvidence': {'legacyBlocker': {'path': legacy_path.relative_to(ROOT).as_posix(),
            'sha256': sha(legacy_path.read_bytes()), 'gitBlobBytesEqual': True},
            'upstreamSnapshot': upstream_row, 'freshRecheck': sanitized(new_upstream_row),
            'LEGACY_PUBLISHER_ROUTE_REQUIRES_REGISTRATION': True,
            'PUBLIC_ZENODO_ARCHIVAL_ROUTE_DISCOVERED_AFTER_XC3_BLOCKER': True,
            'legacyBlockerRewritten': False, 'legacyBlockerDeclaredFalse': False},
        'chain': ['Original publisher identifies MAPS and Valentin Emiya / Telecom ParisTech.',
            'Checksum-verified readme/license identify MAPS0.4 and original authorship.',
            'Zenodo creators/copyright/description agree with these attributions.',
            'But the record is owned by Paraskevas Stamatiadis / paridios96, not a listed creator; no original-publisher cross-link or independent author endorsement established.',
            'Content attribution and open file checksums do not establish original-author archival deposit provenance. Gate remains closed.'],
        'minimumEvidenceToReconsider': ['Original publisher/author endorsement linking this DOI or exact files',
            'Or independently authenticated upstream archive checksums/file-level provenance plus reviewed acceptance of this third-party redistribution route'],
        'networkRequests': [sanitized(r) for r in requests],
        'downloadAccounting': {'auditedDockerHttpBodyBytes': sum(r['readBytes'] for r in requests),
            'recordReadmeLicenseAndHtmlOnly': True, 'webLookupMetadataByteCount': 'NOT_EXPOSED_BY_WEB_TOOL',
            'zipPayloadBytes': 0, 'audioContentReads': 0, 'midiContentReads': 0,
            'rangeRequestsToZip': 0, 'unrelatedMapsMediaDownloaded': False},
        'rangeSupport': 'NOT_TESTED_PROVENANCE_GATE_FAILED_BEFORE_ZIP_ACCESS',
        'centralDirectoryInventory': 'NOT_ACQUIRED', 'candidateTakeInventory': [],
        'selectionConfirmationSplit': 'NOT_FROZEN', 'perMemberSha256': [],
        'actualSessionRunCount': 0, 'decoderPairedResults': 'NOT_PERFORMED',
        'resamplerPairedResults': 'NOT_PERFORMED', 'geometryPairedResults': 'NOT_PERFORMED',
        'selectionParetoFrontier': [], 'selectionDecision': 'NOT_PERFORMED',
        'confirmationResult': 'NOT_PERFORMED', 'DECODER_DEFAULT': 'UNRESOLVED',
        'RESAMPLER_DEFAULT': 'UNRESOLVED', 'STREAMING_GEOMETRY_DEFAULT': 'UNRESOLVED',
        'PROFILE_CLASSIFICATION': 'CURRENT_FROZEN_REPRESENTATIVE_ROBUST_PROFILE',
        'NO_OPTIMAL_PROFILE_CLAIM': True, 'scientificUse': 'SCIENTIFIC_RESEARCH_ONLY',
        'scopeProtections': legacy['scopeProtections'], 'tests': {'exitCode': 0, 'stdout': tests.stdout, 'stderr': tests.stderr},
        'auditedMetadataDockerImage': 'sha256:7feadf65b7763a9ee94880218e3e80f8566ec242ffff7e9ca99d10bb85d76a6f',
        'sourceHashBoundary': [{'path': p, 'sha256': sha((ROOT / p).read_bytes())} for p in
            ['backend/research/xc3_r1_zenodo.py', 'backend/research/test_xc3_r1_zenodo.py',
             'backend/research/xc3_maps_provenance.py']],
        'allHistoricalFilesUnchanged': True, 'trackedChangesFromStart': changes,
        'evidenceCommit': 'Exact containing evidence-only commit, returned after push; no self-referential SHA.'}
    from xc3_maps_provenance import github_state
    try:
        report['githubPreEvidence'] = github_state(git('rev-parse', 'HEAD'))
    except Exception as error:
        report['githubPreEvidence'] = {'status': 'QUERY_FAILED', 'error': str(error)}
    path = ROOT / 'backend/research/reports/phase9g_xc3_r1_zenodo_provenance_determination_2026-10-16.json'
    print(json.dumps({'report': json_new(path, report), 'status': report['status'],
        'archiveBytes': {n: entries[n]['size'] for n in ('ENSTDkAm.zip', 'ENSTDkCl.zip')},
        'auditedMetadataBytes': report['downloadAccounting']['auditedDockerHttpBodyBytes']}))


def post_push():
    from xc3_maps_provenance import github_state
    head = git('rev-parse', 'HEAD')
    receipt = github_state(head)
    if receipt['requests'][2]['body']['commit']['sha'] != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    json_new(WORK / f'github_post_push_{head}.json', {'phase': PHASE, **receipt})
    print(json.dumps({'commit': head, 'remoteHeadVerified': True,
        'combinedState': receipt['requests'][0]['body']['state'],
        'statuses': receipt['requests'][0]['body']['statuses'],
        'workflowRuns': receipt['requests'][1]['body']['workflow_runs']}))


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['probe', 'recover', 'finalize', 'post-push'])
    args = parser.parse_args()
    {'probe': probe, 'recover': recover, 'finalize': finalize, 'post-push': post_push}[args.command]()


if __name__ == '__main__':
    main()
