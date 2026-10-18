import ast
from pathlib import Path
import unittest
from contracts import *
from portable import *
from protocol import V5, V5_TOOLS, audit_intended_diff, verified_audio


class PortableRegression(unittest.TestCase):
    def test_old_backslash_path_rejected(self):
        with self.assertRaises(ValueError): validate_path(r'backend\research\reports\step_waiting_h50_holdout_v4\combined-truth-topology.json')

    def test_exact_posix_counterpart_accepted(self):
        value='backend/research/reports/step_waiting_h50_holdout_v4/combined-truth-topology.json'
        self.assertEqual(validate_path(value),value)
        self.assertEqual(repo_relative_posix(ROOT/value),value)

    def test_drive_rejected(self):
        with self.assertRaises(ValueError): validate_path(r'C:\repo\file.json')

    def test_unc_rejected(self):
        with self.assertRaises(ValueError): validate_path(r'\\server\share\file')

    def test_absolute_rejected(self):
        with self.assertRaises(ValueError): validate_path('/backend/file')

    def test_parent_rejected(self):
        with self.assertRaises(ValueError): validate_path('backend/../secret')

    def test_empty_component_rejected(self):
        with self.assertRaises(ValueError): validate_path('backend//file')

    def test_dot_component_rejected(self):
        with self.assertRaises(ValueError): validate_path('backend/./file')

    def test_backslash_rejected(self):
        with self.assertRaises(ValueError): validate_path(r'backend\file')

    def test_relative_accepted(self): self.assertEqual(validate_path('backend/file'),'backend/file')

    def test_external_root_rejected(self):
        with self.assertRaises(ValueError): repo_relative_posix(ROOT.parent/'outside.json')

    def test_generated_manifest_uses_posix(self):
        path=repo_relative_posix(ROOT/'backend/research/reports/step_waiting_h50_holdout_v4/combined-truth-topology.json')
        value={'pathSchema':SCHEMA,'files':[{'path':path,'sha256':digest((ROOT/path).read_bytes())}]}
        value['freezeCanonicalSha256']=digest(canonical(value))
        self.assertEqual(validate_portable_freeze_manifest(value),1)
        self.assertNotIn('\\',value['files'][0]['path'])

    def test_manifest_bad_hash_rejected(self):
        path='backend/research/reports/step_waiting_h50_holdout_v4/combined-truth-topology.json'
        value={'pathSchema':SCHEMA,'files':[{'path':path,'sha256':'0'*64}]}
        value['freezeCanonicalSha256']=digest(canonical(value))
        with self.assertRaisesRegex(ValueError,'HASH_MISMATCH'): validate_portable_freeze_manifest(value)

    def test_old_v5_freeze_is_still_broken_and_immutable(self):
        old=read(V5/'audio-acquisition-protocol-freeze.json')
        self.assertEqual(old['freezeCanonicalSha256'],'0f669a76c9b2661b2577300d641e195feeee33018081e510b58498b35f75b2fe')
        self.assertEqual(sum('\\' in r['path'] for r in old['files']),2)
        self.assertEqual(git('diff','--name-only',START,'--',*PROTECTED),'')

    def test_all_four_exact_audio_and_blobs(self): self.assertEqual(len(verified_audio()['objects']),4)

    def test_contract_bytes_unchanged(self):
        for name in ('decoder-contract.json','input-preservation-contract.json'):
            self.assertEqual((HERE/name).read_bytes(),(V5_TOOLS/name).read_bytes())

    def test_algorithm_diff_is_limited(self): self.assertEqual(len(audit_intended_diff()),8)

    def test_h50_and_alignment_unchanged(self):
        self.assertEqual(read(HERE/'input-preservation-contract.json')['HMs'],50)
        self.assertEqual(read(HERE/'decoder-contract.json')['alignmentTransformSeconds'],0)

    def test_preflight_has_no_decoder_import(self):
        tree=ast.parse((HERE/'preflight.py').read_text())
        imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]
        imports += [a.name for n in ast.walk(tree) if isinstance(n,ast.Import) for a in n.names]
        self.assertFalse({'soundfile','numpy','scipy','torch','onnxruntime','decode','prepare'} & set(imports))

    def test_no_old_path_repair(self):
        for file in ('portable.py','preflight.py','contracts.py'):
            self.assertNotIn('replace(', (HERE/file).read_text())


if __name__=='__main__': unittest.main()
