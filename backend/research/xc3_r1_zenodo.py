"""Docker-only bounded Zenodo metadata inspection; no media fallback downloads."""

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import struct
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


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['probe', 'recover'])
    args = parser.parse_args()
    {'probe': probe, 'recover': recover}[args.command]()


if __name__ == '__main__':
    main()
