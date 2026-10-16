"""No-network, synthetic ZIP/HTTP tests."""
import io
import struct
import unittest
from unittest.mock import patch
import zipfile

from xc3_r1_zenodo import bounded_get, parse_directory, determine_provenance, JsonScripts


class Response(io.BytesIO):
    def __init__(self, body, status, headers):
        super().__init__(body)
        self.status, self.headers = status, headers
        self.read_called = False

    def geturl(self):
        return 'https://zenodo.org/test'

    def read(self, *args):
        self.read_called = True
        return super().read(*args)


class RangeTests(unittest.TestCase):
    def test_creator_attribution_not_depositor_authentication(self):
        record = {'metadata': {'creators': [{'name': 'Original Author'}]},
                  'expanded': {'parent': {'access': {'owned_by': {
                      'username': 'different_uploader', 'profile': {'full_name': 'Third Party'}}}}}}
        result = determine_provenance(record, '<p>Original MAPS publisher</p>')
        self.assertEqual(result['classification'], 'ZENODO_ARCHIVE_PROVENANCE_NOT_SUFFICIENTLY_LINKED')
        self.assertFalse(result['creatorAttributionAloneEstablishesDepositorIdentity'])

    def test_original_publisher_explicit_endorsement(self):
        result = determine_provenance({}, '<a href="https://zenodo.org/records/18160555">MAPS</a>')
        self.assertEqual(result['classification'], 'ORIGINAL_AUTHOR_ARCHIVAL_DISTRIBUTION_PROVENANCE_ESTABLISHED')

    def test_embedded_record_is_structured_json_not_visible_author_names(self):
        page = JsonScripts('<div data-record="{&quot;id&quot;:&quot;18160555&quot;}"></div>')
        self.assertEqual(page.items[0]['value'], {'id': '18160555'})

    def test_ignored_range_never_reads_full_body(self):
        response = Response(b'unrelated media payload', 200, {'Content-Length': '2700000000'})
        with patch('xc3_r1_zenodo.urlopen', return_value=response):
            row, data = bounded_get('https://zenodo.org/test', 4, 'bytes=0-3')
        self.assertEqual(data, b'')
        self.assertEqual(row['readBytes'], 0)
        self.assertFalse(response.read_called)

    def test_wrong_range_rejected_before_body(self):
        response = Response(b'1234', 206, {'Content-Range': 'bytes 4-7/100'})
        with patch('xc3_r1_zenodo.urlopen', return_value=response):
            row, _ = bounded_get('https://zenodo.org/test', 4, 'bytes=0-3')
        self.assertEqual(row['rejection'], 'CONTENT_RANGE_NOT_EXACT_REQUEST')
        self.assertFalse(response.read_called)

    def test_valid_range(self):
        response = Response(b'PK\x03\x04', 206, {'Content-Range': 'bytes 0-3/100'})
        with patch('xc3_r1_zenodo.urlopen', return_value=response):
            row, data = bounded_get('https://zenodo.org/test', 4, 'bytes=0-3')
        self.assertEqual(data, b'PK\x03\x04')
        self.assertEqual(row['readBytes'], 4)

    def test_metadata_directory_without_member_payload(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('ENSTDkAm/MUS/MAPS_MUS-example_ENSTDkAm.wav', b'SYNTHETIC_TEST')
        blob = stream.getvalue()
        _, _, _, _, count, size, start, _ = struct.unpack('<4s4H2IH', blob[-22:])
        rows = parse_directory(blob[start:start + size], count)
        self.assertEqual(rows[0]['uncompressedBytes'], 14)
        self.assertEqual(rows[0]['compressionMethod'], 8)
        self.assertEqual(rows[0]['localHeaderOffset'], 0)
        with self.assertRaisesRegex(ValueError, 'COUNT'):
            parse_directory(blob[start:start + size], count + 1)


if __name__ == '__main__':
    unittest.main()
