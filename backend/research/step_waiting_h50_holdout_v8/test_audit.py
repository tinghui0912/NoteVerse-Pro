import security
import unittest
import subprocess
from unittest.mock import patch
import json
from projection import Projection
from taxonomy import classify, ownership
import protocol as p


class TaxonomyTests(unittest.TestCase):
    def verdict(self,urls,constructions=1,sessions=1,model=1):return ownership(classify(urls),constructions,sessions,model)
    def test_current_four_workers_valid(self):
        counts=classify(['/worker.js']+['/ort/ort-wasm-simd-threaded.jsep.mjs']*3)
        self.assertEqual((counts['product'],counts['ort'],counts['unexpected'],counts['total']),(1,3,0,4))
        self.assertEqual(ownership(counts,1,1,1),'PASS')
    def test_second_product_worker_fails(self):self.assertEqual(self.verdict(['/worker.js','/worker.js']), 'STEP_WAITING_H50_STAGE_A_SECOND_PRODUCT_ACOUSTIC_WORKER_CONFIRMED')
    def test_product_worker_absent_fails(self):self.assertNotEqual(self.verdict(['/ort/ort-wasm-simd-threaded.jsep.mjs']),'PASS')
    def test_unknown_worker_fails(self):self.assertEqual(self.verdict(['/worker.js','/foo.js']),'STEP_WAITING_H50_STAGE_A_UNEXPECTED_WORKER_TOPOLOGY')
    def test_second_session_fails(self):self.assertEqual(self.verdict(['/worker.js'],sessions=2),'STEP_WAITING_H50_STAGE_A_SECOND_MODEL_SESSION_CONFIRMED')
    def test_second_reported_session_fails(self):self.assertEqual(self.verdict(['/worker.js'],model=2),'STEP_WAITING_H50_STAGE_A_SECOND_MODEL_SESSION_CONFIRMED')
    def test_second_trace_worker_fails(self):self.assertNotEqual(self.verdict(['/worker.js'],constructions=2),'PASS')
    def test_raw_total_four_not_standalone_failure(self):self.assertEqual(self.verdict(['/worker.js']+['/ort/ort-wasm-simd-threaded.jsep.mjs']*3),'PASS')
    def test_ort_count_not_fixed_at_three(self):
        for count in (0,1,2,7):self.assertEqual(self.verdict(['/worker.js']+['/ort/ort-wasm-simd-threaded.jsep.mjs']*count),'PASS')
    def test_foreign_worker_origin_fails(self):self.assertNotEqual(self.verdict(['https://example.com/worker.js']),'PASS')
    def test_mixed_origins_fail(self):self.assertNotEqual(self.verdict(['http://127.0.0.1:1/worker.js','http://127.0.0.1:2/ort/ort-wasm-simd-threaded.jsep.mjs']),'PASS')
    def test_query_worker_fails(self):self.assertNotEqual(self.verdict(['/worker.js?alternate=1']),'PASS')


class AuditIsolation(unittest.TestCase):
    def test_before_remote_stage_a_projection_denied(self):
        with self.assertRaisesRegex(PermissionError,'BEFORE_REMOTE'):p.project(p.ACOUSTIC,{'status':True})
    def test_truth_parser_denied_before_io(self):
        with self.assertRaisesRegex(PermissionError,'SEMANTIC_FILE_OPEN_DENIED'):p.project('backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json',{'anything':True})
    def test_midi_parser_denied_before_io(self):
        with self.assertRaises(PermissionError):p.project('example.mid',{})
    def test_selected_source_truth_denied(self):
        with self.assertRaises(PermissionError):p.project('backend/research/reports/step_waiting_h50_holdout_v4/combined-truth-topology.json',{})
    def test_skip_acoustic_payload_without_decoding_values(self):
        text='{"count":228,"publications":[{"pitch":"SECRET_NOTE", "confidence":0.7,"escaped":"x\\\"[]{}"}],"model":{"loads":1}}'
        parser=Projection(text);old=parser.decoder.raw_decode
        def checked(s,index=0):
            self.assertFalse(s[index:].startswith('"SECRET_NOTE"'))
            return old(s,index)
        parser.decoder.raw_decode=checked
        self.assertEqual(parser.project({'count':True,'model':{'loads':True}}),{'count':228,'model':{'loads':1}})
        self.assertEqual(parser.skipped,1)
    def test_metadata_scalar_refuses_nested_payload(self):
        with self.assertRaisesRegex(ValueError,'LEAF_MUST_BE_SCALAR'):Projection('{"count":{"notes":[]}}').project({'count':True})
    def test_non_git_process_blocked_before_spawn(self):
        with self.assertRaisesRegex(PermissionError,'NON_GIT_PROCESS'):subprocess.check_output(['node','--version'])
    def test_neural_import_blocked(self):
        with self.assertRaisesRegex(PermissionError,'RUNTIME_IMPORT_DENIED'):__import__('onnxruntime')
    def test_audio_decoder_import_blocked(self):
        with self.assertRaisesRegex(PermissionError,'RUNTIME_IMPORT_DENIED'):__import__('soundfile')
    def test_historical_and_product_unchanged(self):self.assertIsNone(p.unchanged())
    def test_ort_asset_exact(self):self.assertEqual(p.digest(p.raw(p.ORT_PATH)),p.ORT_SHA)


if __name__=='__main__':
    import io
    stream=io.StringIO();started=p.now()
    result=unittest.TextTestRunner(stream=stream,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(__import__(__name__)))
    p.save(p.OUT/'synthetic-tests.json',{'startedAt':started,'completedAt':p.now(),'testFiles':1,'tests':result.testsRun,
        'passed':result.testsRun-len(result.failures)-len(result.errors),'failed':len(result.failures),'errors':len(result.errors),
        'newNeuralRuns':0,'RobustSessionRuns':0,'truthOpened':False,'output':stream.getvalue()})
    print(stream.getvalue());raise SystemExit(0 if result.wasSuccessful() else 1)
