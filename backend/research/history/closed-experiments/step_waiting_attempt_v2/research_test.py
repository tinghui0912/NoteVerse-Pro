import unittest
from select_corpus import first_cases


def group(t, pitches, tags):
    return {'time':t,'notes':[{'time':t+i*.01,'pitch':p,'velocity':70,'end':t+.2} for i,p in enumerate(pitches)],'tags':tags}


class SelectionContractTests(unittest.TestCase):
    def test_isolated_single_and_chord(self):
        groups=[group(1,[55],['single']),group(4,[60],['single']),group(6,[60,64],['chord']),group(8,[62],['single'])]
        found=first_cases(groups,[],20)
        self.assertEqual(found['correct_single']['eventTime'],4)
        self.assertEqual(found['correct_chord']['eventTime'],6)
        self.assertEqual(found['close_spread_chord']['eventTime'],6)

    def test_dense_gestures_are_not_counted_as_waiting_single_opportunities(self):
        groups=[group(t,[60],['single']) for t in [1,3,3.2,3.4,3.6,3.8]]
        self.assertNotIn('correct_single',first_cases(groups,[],20))

    def test_busy_pair_is_selected_without_candidate_outputs(self):
        groups=[group(1,[50],['single']),group(4,[60],['single']),group(4.7,[62],['single']),group(7,[64],['single'])]
        found=first_cases(groups,[],20)
        self.assertEqual(found['busy_period_input']['eventTime'],4)
        self.assertEqual(found['late_publication']['busyInput']['time'],4.7)

    def test_note_on_free_held_and_pedal_guards_are_distinct(self):
        groups=[group(2,[60],['single']),group(6,[60,64],['chord'])]
        guards=[{'start':3,'end':5,'tags':['held','all_note_on_free']},{'start':7,'end':9,'tags':['pedal_sustain','all_note_on_free']}]
        found=first_cases(groups,guards,20)
        self.assertEqual(found['held_note_negative']['scoredEnd'],found['held_note_negative']['warmBoundary']+1.2)
        self.assertEqual(found['pedal_sustain_negative']['physicalPitches'],[60,64])


if __name__=='__main__':
    unittest.main(verbosity=2)
