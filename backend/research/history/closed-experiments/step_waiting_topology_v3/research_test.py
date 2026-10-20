import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('v3_inventory',Path(__file__).with_name('inventory.py'))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

def group(time,pitches,velocity=80):return {'time':time,'notes':[{'time':time,'pitch':p,'velocity':velocity,'end':time+1} for p in pitches]}

class MetadataRules(unittest.TestCase):
    def test_single_and_chord_are_isolated_from_next_opportunity(self):
        c=mod.eligible([group(4,[60]),group(6,[60]),group(8,[60,64]),group(10,[65])],[],20)
        self.assertEqual(c['single'][0]['time'],6);self.assertEqual(c['chord'][0]['time'],8)
    def test_same_pitch_soft_and_repeated_chord_use_only_physical_history(self):
        c=mod.eligible([group(5,[60]),group(6.5,[60],30),group(8,[60,64]),group(9.5,[60,64]),group(12,[70])],[],20)
        self.assertTrue(c['soft_after_loud_after_ready']);self.assertTrue(c['repeated_chord_after_ready'])
    def test_busy_and_rapid_are_not_ready_positive_requirements(self):
        c=mod.eligible([group(5,[60]),group(6,[64]),group(6.22,[64]),group(8,[70]),group(8.8,[70])],[],20)
        self.assertTrue(c['rapid_not_ready']);self.assertTrue(c['analyzing'])
    def test_no_padding_insufficient_context_is_not_selected(self):
        c=mod.eligible([group(1,[60]),group(3,[64]),group(4.6,[60])],[],20)
        self.assertFalse(c['capturing_outside']);self.assertFalse(c['single'])

if __name__=='__main__':unittest.main(verbosity=2)
