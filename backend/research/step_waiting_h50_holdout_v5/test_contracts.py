import ast
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from scipy.signal import resample_poly
from contracts import *
import decode
from prepare import source_conversion
from scenarios import counterfactual
from exposure import prior_exposure_or_unknown


class ImmutableIdentities(unittest.TestCase):
    def test_v3_sha_exact(self):
        rows, _ = verify_dependencies()
        self.assertEqual(next(r['sha256'] for r in rows if r['path'].endswith('/selector.py')),
                         '0a8b52e31c329fb956db6b213354f46a9b18349930b1a17120c6bf76f67e0496')

    def test_v3_scorer_sha_exact(self):
        rows, _ = verify_dependencies()
        self.assertEqual(next(r['sha256'] for r in rows if r['path'].endswith('/scorer-contract.json')),
                         'b0691e5b8b03a550fd7a869328ffba83107587753a5951d8ae48aa89d9860ddd')

    def test_v4_seal_exact(self):
        self.assertEqual(verify_dependencies()[1], '6023fc0cdb5a9bf36769b5f33a4ff1fce8ce220f9d968516bfaf6cfb5f32ee18')

    def test_four_audio_objects_only(self):
        self.assertEqual(set(SELECTED), {'kv282_1','kv279_3','kv281_1','kv279_2'})
        for ident,(path,sha) in SELECTED.items(): self.assertEqual(allowed_audio(ident,path),sha)

    def test_unselected_audio_request_rejected(self):
        with self.assertRaisesRegex(ValueError,'UNSELECTED_AUDIO'): allowed_audio('kv280_1','batik/audio/k280_1.mp3')

    def test_alternate_representation_rejected(self):
        with self.assertRaisesRegex(ValueError,'UNSELECTED_AUDIO'): allowed_audio('kv279_3','batik/audio/k279_3.wav')

    def test_git_blob_semantics_not_plain_sha1(self):
        self.assertEqual(object_sha(b'hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
        self.assertNotEqual(object_sha(b'hello\n'), sha1(b'hello\n').hexdigest())

    def test_wrong_object_rejected(self):
        with self.assertRaisesRegex(ValueError,'UPSTREAM_OBJECT_MISMATCH'): check_object('kv279_3','batik/audio/k279_3.mp3',b'wrong')

    def test_v4_truth_pair_unchanged(self):
        case = read(V4/'combined-truth-topology.json')['batikGapFillCases']['single_busy_retrigger']
        self.assertEqual(case['pair']['pairId'], '7ee0a810b91ba58b5c72383b67f99d744623e4957efeab2e4102a6b4b8fccec2')
        self.assertIsNone(case['pair']['audioSha256'])

    def binding(self):
        return dict(v4TruthTopologySealSha256='seal',family='single_busy_retrigger',truthSelectionIdentity={'truthPairId':'immutable'},
            recordingId='kv279_3',midiSha256='midi',upstreamRepositoryCommit=UPSTREAM,upstreamAudioPath='batik/audio/k279_3.mp3',
            upstreamGitBlobSha1=SELECTED['kv279_3'][1],audioSha256='audio',decoderProtocolSha256='decoder',decodedPcmSha256='pcm')

    def test_audio_bound_id_changes_with_audio(self):
        a = self.binding(); self.assertNotEqual(bound_identity(a),bound_identity(a|{'audioSha256':'different'}))

    def test_audio_bound_id_binds_truth_selection(self):
        a=self.binding(); self.assertNotEqual(bound_identity(a),bound_identity(a|{'truthSelectionIdentity':{'truthPairId':'other'}}))


class DecoderAndContext(unittest.TestCase):
    def test_protocol_required_before_decoder_import(self):
        with patch('decode.require_protocol',side_effect=ValueError('PROTOCOL_REQUIRED')):
            with self.assertRaisesRegex(ValueError,'PROTOCOL_REQUIRED'): decode.one('kv279_3',1)

    def test_decoder_fallback_rejected(self):
        with patch('decode.require_protocol',return_value={}), patch('decode.read',return_value={'fallback':True,'implementation':'other'}):
            with self.assertRaisesRegex(ValueError,'DECODER_FALLBACK_REJECTED'): decode.one('kv279_3',1)

    def row(self): return dict(nativeSampleRate=44100,channels=2,frames=100,monoPcmSha256='same')

    def test_three_identical_decodes_accepted(self): decode.deterministic([self.row() for _ in range(3)])

    def test_nondeterministic_pcm_rejected(self):
        with self.assertRaisesRegex(ValueError,'DETERMINISM_NOT_ESTABLISHED'):
            decode.deterministic([self.row(),self.row(),self.row()|{'monoPcmSha256':'different'}])

    def test_nondeterministic_geometry_rejected(self):
        with self.assertRaisesRegex(ValueError,'DETERMINISM_NOT_ESTABLISHED'):
            decode.deterministic([self.row(),self.row(),self.row()|{'frames':101}])

    def test_insufficient_trials_rejected(self):
        with self.assertRaisesRegex(ValueError,'DETERMINISM_NOT_ESTABLISHED'): decode.deterministic([self.row()])

    def case(self): return {'gestures':[{'notes':[{'onsetMs':6000}]}], 'midiEotDurationSeconds':100}

    def test_actual_audio_not_midi_eot_controls_context(self):
        with self.assertRaisesRegex(ValueError,'AUDIO_CONTEXT_INVALID'): context_valid(self.case(),8)

    def test_actual_audio_context_valid(self): self.assertEqual(context_valid(self.case(),10)['remainingRealAudioMs'],4000)

    def test_invalid_context_does_not_reselect_or_mutate(self):
        case=self.case(); before=deepcopy(case)
        with self.assertRaises(ValueError): context_valid(case,7)
        self.assertEqual(case,before)

    def test_sync_contract_required(self):
        with self.assertRaisesRegex(ValueError,'ZERO_TRANSFORM'): verify_sync({})

    def test_nonzero_alignment_rejected(self):
        with self.assertRaisesRegex(ValueError,'ZERO_TRANSFORM'):
            verify_sync({'conclusion':'PUBLISHER_ZERO_TRANSFORM_SYNCHRONIZATION_CONTRACT','alignmentTransformSeconds':.01})

    def test_zero_alignment_accepted(self): verify_sync({'conclusion':'PUBLISHER_ZERO_TRANSFORM_SYNCHRONIZATION_CONTRACT','alignmentTransformSeconds':0})


class DspAndArchitecture(unittest.TestCase):
    def test_native_preparation_has_no_gain(self):
        source=np.array([-.2,.1,.3],dtype='<f4'); np.testing.assert_array_equal(source_conversion(source,44100,44100),source)

    def test_rate_conversion_is_existing_scipy_default(self):
        source=np.linspace(-.2,.3,441,dtype=np.float32)
        np.testing.assert_array_equal(source_conversion(source,44100,48000),resample_poly(source,160,147).astype('<f4'))

    def test_both_source_rates_required(self): self.assertEqual(read(HERE/'input-preservation-contract.json')['rates'],[44100,48000])

    def test_unsupported_source_fixture_rate_rejected(self):
        with self.assertRaises(ValueError): source_conversion(np.zeros(10,dtype='<f4'),44100,32000)

    def test_production_adapter_import_not_copied_fir(self):
        text=(HERE/'dsp.ts').read_text()
        self.assertIn("from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter'",text)
        self.assertIn('QualifiedSourceAdapter.create',text)
        self.assertNotIn('Math.fround',text)
        self.assertNotIn('coefficients[',text)

    def test_no_neural_import_or_execution(self):
        for path in HERE.glob('*.py'):
            tree=ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node,ast.Import): self.assertFalse({'torch','onnxruntime','tensorflow'} & {n.name for n in node.names})
                if isinstance(node,ast.ImportFrom): self.assertNotIn(node.module,{'torch','onnxruntime','tensorflow'})
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute): self.assertNotEqual(node.func.attr,'InferenceSession')

    def test_prior_unknown_output_not_allowed(self): self.assertTrue(prior_exposure_or_unknown('backend/research/reports/unknown-model-output.json'))

    def test_immutable_v4_truth_metadata_not_model_exposure(self): self.assertFalse(prior_exposure_or_unknown('backend/research/reports/step_waiting_h50_holdout_v4/assessment.json'))

    def test_v3_counterfactuals_exact(self):
        self.assertEqual(counterfactual([56,64],'extra_chord_tone'),[56])
        self.assertEqual(counterfactual([56,64],'missing_chord_tone'),[21,56,64])
        self.assertEqual(counterfactual([56,64],'wrong_semitone'),[56,63])
        self.assertEqual(counterfactual([56,64],'wrong_octave'),[52,56])

    def test_protected_product_and_history_unchanged(self): self.assertEqual(git('diff','--name-only',START,'HEAD','--',*PROTECTED),'')


if __name__ == '__main__': unittest.main()
