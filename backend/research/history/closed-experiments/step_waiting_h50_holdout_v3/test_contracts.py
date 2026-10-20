import ast
import copy
from pathlib import Path
import unittest
from eligibility import primary_decision
from pair_identity import pair_identity


class ExposureTests(unittest.TestCase):
    def setUp(self):
        self.facts = {'recordingId':'test', 'audioSha256':'a', 'midiSha256':'m', 'lineageAudioSha256s':[],
                      'pairingEstablished':True, 'researchAuthorized':True, 'provenanceComplete':True}

    def event(self, kind, audio='a'):
        return {'exposureClass':kind, 'audioSha256':audio, 'evidencePath':'metadata-receipt', 'basis':'identity only'}

    def test_actual_execution_rejected(self):
        self.assertFalse(primary_decision(self.facts, [self.event('ACTUAL_ROBUST_EXECUTION')])['primaryEligible'])

    def test_alias_audio_hash_rejected_even_with_new_id_and_midi(self):
        self.facts.update(recordingId='renamed', midiSha256='other')
        self.assertFalse(primary_decision(self.facts, [self.event('ACTUAL_ROBUST_EXECUTION')])['primaryEligible'])

    def test_resampling_lineage_cannot_escape_execution(self):
        self.facts.update(audioSha256='resampled', lineageAudioSha256s=['a'])
        self.assertFalse(primary_decision(self.facts, [self.event('ACTUAL_ROBUST_EXECUTION')])['primaryEligible'])

    def test_output_bearing_without_robust_receipt_rejected(self):
        self.assertFalse(primary_decision(self.facts, [self.event('OUTPUT_BEARING_INSPECTION')])['primaryEligible'])

    def test_output_driven_tuning_rejected(self):
        self.assertFalse(primary_decision(self.facts, [self.event('OUTPUT_DRIVEN_SELECTION_OR_TUNING')])['primaryEligible'])

    def test_truth_only_inventory_is_not_a_blocker(self):
        self.assertTrue(primary_decision(self.facts, [self.event('TRUTH_ONLY_INVENTORY')])['primaryEligible'])

    def test_truth_only_selection_is_separate_from_material_topology_design(self):
        self.assertTrue(primary_decision(self.facts, [self.event('TRUTH_ONLY_PRIOR_SELECTION')])['primaryEligible'])
        self.assertFalse(primary_decision(self.facts, [self.event('PRIOR_PRODUCT_TOPOLOGY_DESIGN_EXPOSURE')])['primaryEligible'])

    def test_unknown_pairing_and_unknown_history_fail_closed(self):
        for field in ['pairingEstablished','researchAuthorized','provenanceComplete']:
            facts = {**self.facts, field:False}
            self.assertFalse(primary_decision(facts, [])['primaryEligible'])
        self.assertFalse(primary_decision(self.facts, [self.event('UNKNOWN_PROVENANCE')])['primaryEligible'])

    def test_output_payload_cannot_cross_metadata_schema(self):
        with self.assertRaises(ValueError):
            primary_decision({**self.facts, 'decodedObservations':[]}, [])


class PairTests(unittest.TestCase):
    def pair(self, a, b, gap=225, source=None):
        return pair_identity(source or {'recordingId':'r','audioSha256':'a','midiSha256':'m'},
            {'gestureId':'g1','onsetMs':0,'normalizedPitchSet':a},
            {'gestureId':'g2','onsetMs':gap,'normalizedPitchSet':b})

    def test_single_same_pitch(self):
        self.assertEqual(self.pair([60],[60])['pairKind'],'SINGLE_SAME_PITCH_RETRIGGER')

    def test_chord_normalization_and_dedupe(self):
        for a,b in [([60,64],[60,64]),([64,60],[60,64]),([60,60,64],[64,60])]:
            self.assertEqual(self.pair(a,b)['pairKind'],'EXACT_REPEATED_CHORD')

    def test_partial_overlap_subset_superset_not_repeats(self):
        for a,b in [([60],[61]),([60,64],[60]),([60],[60,64]),([60,64],[60,64,67]),
                    ([60,64,67],[60,67]),([60,64,67],[60,65,69])]:
            self.assertIsNone(self.pair(a,b)['pairKind'])

    def test_single_inclusive_band(self):
        for gap in [200,250]: self.assertTrue(self.pair([60],[60],gap)['singleBusyTopologyEligible'])
        for gap in [199.999,250.001]: self.assertFalse(self.pair([60],[60],gap)['singleBusyTopologyEligible'])

    def test_chord_separate_band(self):
        for gap in [50.001,100,200,250]: self.assertTrue(self.pair([60,64],[60,64],gap)['chordBusyTopologyEligible'])
        for gap in [49,50,250.001]: self.assertFalse(self.pair([60,64],[60,64],gap)['chordBusyTopologyEligible'])

    def test_identity_binds_every_component(self):
        source = {'recordingId':'r','audioSha256':'a','midiSha256':'m'}
        first = {'gestureId':'g1','onsetMs':0,'normalizedPitchSet':[60,64]}
        second = {'gestureId':'g2','onsetMs':225,'normalizedPitchSet':[60,64]}
        original = pair_identity(source,first,second)['pairId']
        for key in source:
            self.assertNotEqual(original,pair_identity({**source,key:'changed'},first,second)['pairId'])
        for group,other in [(first,second),(second,first)]:
            for key,new in [('gestureId','new'),('onsetMs',1 if group is first else 226),('normalizedPitchSet',[60,67])]:
                changed = copy.deepcopy(group); changed[key] = new
                args = (changed,other) if group is first else (other,changed)
                self.assertNotEqual(original,pair_identity(source,*args)['pairId'])

    def test_invalid_pitch_rejected(self):
        for values in [[],[-1],[128],[60.5],[True]]:
            with self.assertRaises(ValueError): self.pair(values,[60])


class ArchitectureTests(unittest.TestCase):
    def test_pure_eligibility_has_no_import_or_file_capability(self):
        tree = ast.parse(Path(__file__).with_name('eligibility.py').read_text())
        self.assertFalse(any(isinstance(n,(ast.Import,ast.ImportFrom)) for n in ast.walk(tree)))
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name)
                             and n.func.id in ['open','eval','exec','__import__'] for n in ast.walk(tree)))

    def test_pair_contract_imports_only_canonical_hash_primitives(self):
        tree = ast.parse(Path(__file__).with_name('pair_identity.py').read_text())
        imports = [n.module if isinstance(n,ast.ImportFrom) else n.names[0].name
                   for n in ast.walk(tree) if isinstance(n,(ast.Import,ast.ImportFrom))]
        self.assertEqual(sorted(imports),['hashlib','json'])


if __name__ == '__main__':
    unittest.main()
