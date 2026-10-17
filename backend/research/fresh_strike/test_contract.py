import unittest
import numpy as np
from baseline import historical_types
from prepare import groups_of, guards_of
from scoring import match

class FreshStrikeContracts(unittest.TestCase):
    def test_fixed_grouping_not_recursive(self):
        notes=[{'time':t,'pitch':60+i,'velocity':80,'end':t+.2} for i,t in enumerate([1.,1.02,1.04])]
        self.assertEqual(len(groups_of(notes)),2)

    def test_other_pitch_note_on_splits_negative_guard(self):
        notes=[{'time':1.,'pitch':60,'velocity':80,'end':3.}, {'time':2.,'pitch':72,'velocity':80,'end':2.5}]
        guards=guards_of(notes,[],4.)
        self.assertTrue(guards)
        self.assertTrue(all(not(g['start']<=2.<g['end']) for g in guards))

    def test_one_to_one_maximum_cardinality(self):
        self.assertEqual(len(match([.04,.14],[0.,.09])),2)
        self.assertEqual(len(match([1.],[1.,1.05])),1)
        self.assertEqual(len(match([1.125],[1.])),0)
        self.assertEqual(len(match([.1],[0.])),1)

    def test_exact_historical_default_and_chunk_parity(self):
        m=historical_types()
        self.assertEqual(m.DetectorConfig().__dict__,{'frame_size_samples':512,'hop_samples':160,'baseline_frames':48,
            'min_rms':.01,'rms_ratio':2.35,'min_flux':.08,'flux_ratio':3.,'refractory_samples':1600})
        pcm=np.zeros(16000,dtype=np.float32);pcm[4000:4100]=.9
        a,b=m.CausalPcmStrikeDetector(),m.CausalPcmStrikeDetector()
        a.ingest(pcm)
        for i in range(0,len(pcm),683):b.ingest(pcm[i:i+683])
        self.assertEqual([(c.candidate_anchor_sample,c.candidate_emit_sample) for c in a.candidates],
                         [(c.candidate_anchor_sample,c.candidate_emit_sample) for c in b.candidates])
        self.assertTrue(all(c.candidate_anchor_sample<=c.candidate_emit_sample<=c.received_samples_at_emit for c in b.candidates))

if __name__=='__main__': unittest.main()
