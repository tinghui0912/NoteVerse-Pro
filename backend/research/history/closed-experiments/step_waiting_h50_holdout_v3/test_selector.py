import ast
import json
from pathlib import Path
import unittest
from selector import first_topologies


def gesture(time,pitches,index,offset=None):
    return {'gestureId':f'g{index}','onsetMs':time,'normalizedPitchSet':pitches,
            'notes':[{'pitch':p,'onsetMs':time,'offsetMs':offset} for p in pitches]}


def source(groups):
    return {'dataset':'fixture','recordingId':'r','audioSha256':'a','midiSha256':'m',
            'durationMs':30000,'gestures':groups,'pedal':[]}


class SelectorTests(unittest.TestCase):
    def test_strict_busy_pair_selected(self):
        selected,_=first_topologies([source([gesture(6000,[60],0),gesture(6225,[60],1)])])
        self.assertIn('single_busy_retrigger',selected)

    def test_overlap_not_repeat(self):
        selected,_=first_topologies([source([gesture(6000,[60,64],0),gesture(6225,[60,67],1)])])
        self.assertNotIn('chord_busy_retrigger',selected)

    def test_chord_independent_gap(self):
        selected,_=first_topologies([source([gesture(6000,[60,64],0),gesture(6100,[60,64],1)])])
        self.assertIn('chord_busy_retrigger',selected)
        self.assertNotIn('single_busy_retrigger',selected)

    def test_waiting_repeat_is_not_busy_pass(self):
        selected,_=first_topologies([source([gesture(6000,[60],0),gesture(8000,[60],1)])])
        self.assertIn('post_ready_repeat',selected)
        self.assertNotIn('single_busy_retrigger',selected)

    def test_all_note_on_free_guard(self):
        selected,_=first_topologies([source([gesture(6000,[60],0,10000),gesture(8000,[61],1)])])
        self.assertIn('same_pitch_sustain',selected)
        self.assertLess(selected['same_pitch_sustain']['guard']['endMs'],8000)

    def test_partial_then_full_and_wrong_sequence(self):
        selected,_=first_topologies([source([gesture(6000,[60],0),gesture(8000,[60,64],1),gesture(10000,[60,64,67],2)])])
        self.assertIn('partial_then_full',selected)
        self.assertIn('multiple_wrong_then_correct',selected)

    def test_lexical_first_not_output_dependent(self):
        a=source([gesture(6000,[60],0),gesture(6225,[60],1)])
        b={**a,'recordingId':'a'}
        selected,_=first_topologies([a,b])
        self.assertEqual(selected['single_busy_retrigger']['recordingId'],'a')

    def test_selector_import_graph_has_no_io_or_acoustic_execution(self):
        tree=ast.parse(Path(__file__).with_name('selector.py').read_text())
        imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]
        self.assertEqual(imports,['pair_identity'])
        self.assertFalse(any(isinstance(n,ast.Import) for n in ast.walk(tree)))
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name)
                             and n.func.id in ['open','eval','exec','__import__'] for n in ast.walk(tree)))

    def test_frozen_h_and_no_vacuous_safety_or_neural_execution(self):
        folder=Path(__file__).parent
        selector=json.loads((folder/'selector-contract.json').read_text())
        scorer=json.loads((folder/'scorer-contract.json').read_text())
        self.assertEqual(selector['HMs'],50)
        self.assertEqual(scorer['HMs'],50)
        self.assertTrue(selector['noNeuralExecutionThisPhase'])
        self.assertFalse(scorer['neuralOrProductExecutionThisPhase'])
        self.assertIn('0/0',scorer['safetyGate'])


if __name__=='__main__':
    unittest.main()
