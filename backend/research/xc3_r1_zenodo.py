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


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['probe'])
    args = parser.parse_args()
    {'probe': probe}[args.command]()


if __name__ == '__main__':
    main()
