import unittest
from backend.research.qualification.product_replay_prepare import ROOT, receipt_file

class ReceiptPaths(unittest.TestCase):
    def test_cross_platform_same_identity(self):
        self.assertEqual(receipt_file('backend/data/file.json'), receipt_file(r'backend\data\file.json'))
        self.assertEqual(receipt_file(r'backend\data\file.json'), ROOT/'backend/data/file.json')

    def test_unsafe_paths_fail_closed(self):
        for path in ['../private',r'backend\..\..\private','/root/private',r'C:\private','https://example.com/file']:
            with self.subTest(path=path), self.assertRaises(ValueError): receipt_file(path)
