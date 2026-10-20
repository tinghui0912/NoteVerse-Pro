"""No production/acoustic execution is reachable from this truth-only tooling."""
import ast
from pathlib import Path
import unittest
from contracts import HERE, V3_REPORT, read, verify_v3


class TruthOnlyArchitecture(unittest.TestCase):
    def test_canonical_v3_freeze_identity(self):
        self.assertEqual(read(V3_REPORT / 'selector-freeze.json')['freezeCanonicalSha256'],
                         '8b78b3f4f74db5ab4e104323e94cc94828777c3fde58585330bcbae882178caf')
        self.assertEqual(len(verify_v3()), 6)

    def test_discovery_proof_precedes_parser_import(self):
        tree = ast.parse((HERE / 'discover_truth.py').read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        gate = next(n for n in ast.walk(main) if isinstance(n, ast.Call)
                    and isinstance(n.func, ast.Name) and n.func.id == 'require_remote_proof')
        imports = [n for n in ast.walk(tree) if isinstance(n, ast.Import) and any(a.name == 'mido' for a in n.names)]
        self.assertEqual(len(imports), 1)
        self.assertGreater(imports[0].lineno, gate.lineno)

    def test_acquisition_does_not_import_musical_parser(self):
        tree = ast.parse((HERE / 'intake.py').read_text())
        names = [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
        names += [n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
        self.assertNotIn('mido', names)
        self.assertNotIn('select_truth', names)

    def test_no_audio_neural_or_product_imports(self):
        prohibited = {'torch', 'onnxruntime', 'soundfile', 'librosa', 'scipy', 'numpy',
                      'StepPracticeRuntime', 'StepPracticeController', 'StepTarget'}
        for path in HERE.glob('*.py'):
            tree = ast.parse(path.read_text())
            imports = [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
            imports += [n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
            self.assertFalse(prohibited.intersection(imports), path.name)

    def test_no_copied_selector_or_scorer(self):
        self.assertFalse((HERE / 'selector.py').exists())
        self.assertFalse((HERE / 'pair_identity.py').exists())
        self.assertFalse((HERE / 'scorer-contract.json').exists())

    def test_frozen_dependency_shas_exact(self):
        expected = {'pair_identity.py': '29b9710dcbacbb74b43226c557553ccbe2d60a9045cc32a809547beeabb1617a',
                    'selector.py': '0a8b52e31c329fb956db6b213354f46a9b18349930b1a17120c6bf76f67e0496',
                    'selector-contract.json': '8e6700de83ae10cdb5e0da29cd1ff6fbac7f1cad6082cced11bdbccd9b074077',
                    'scorer-contract.json': 'b0691e5b8b03a550fd7a869328ffba83107587753a5951d8ae48aa89d9860ddd'}
        actual = {Path(r['path']).name: r['sha256'] for r in verify_v3()}
        for key, value in expected.items():
            self.assertEqual(actual[key], value)


if __name__ == '__main__':
    unittest.main()
