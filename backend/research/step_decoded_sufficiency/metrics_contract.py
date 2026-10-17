import unittest
from metrics import assignment,score_scenario

class ProductMetricsContracts(unittest.TestCase):
    def test_one_truth_cannot_support_two_advances(self):
        g={'time':.1,'notes':[{'pitch':60}]}
        self.assertEqual(len(assignment([{'eventMs':100,'targetPitches':['C4']},{'eventMs':120,'targetPitches':['C4']}],[g])),1)

    def test_owned_boundary_corroboration_keeps_adjacent_truth(self):
        self.assertEqual(assignment([{'eventMs':200,'targetPitches':['C4']}],[{'time':.1992,'notes':[{'pitch':60}]}]),{0:0})

    def test_wrong_pitch_does_not_corroborate_a_match(self):
        self.assertEqual(assignment([{'eventMs':100,'targetPitches':['C#4']}],[{'time':.1,'notes':[{'pitch':60}]}]),{})

    def test_busy_source_event_is_not_hidden_by_matching_new_truth(self):
        event=lambda id,t,lock,verdict:{'attemptId':id,'eventMs':t,'lockMs':lock,'verdictMs':verdict,'verdict':'MATCH',
            'targetPitches':['C4'],'observedPitches':['C4'],'observationIds':[id],
            'evidenceAvailabilityMs':lock,'rearmed':True,'rearmWatermarkMs':t+100,'lateReceipt':False}
        case={'id':'case','recordingId':'source','ownedStartSeconds':0,'ownedEndSeconds':2,'negativeGuards':[],
            'truth':[{'time':t,'truthId':str(t),'notes':[{'pitch':60}],'tags':['single']} for t in [.1,.8]]}
        result={'scenario':{'name':'busy','targets':[[60],[60]]},'outcomes':[event('a',100,500,1000),event('b',800,1500,1500)],
            'ignoredGestures':0,'receipts':[{'opened':1}]}
        score=score_scenario(result,case,48000)
        self.assertEqual(score['safety']['busyPeriodCarryoverAdvance'],1)
        self.assertEqual(score['supportedMatches'],2)

    def test_empty_truth_sustain_match_is_a_dangerous_advance(self):
        event={'attemptId':'echo','eventMs':800,'lockMs':1000,'verdictMs':1000,'verdict':'MATCH',
            'targetPitches':['C4'],'observedPitches':['C4'],'observationIds':['echo'],
            'evidenceAvailabilityMs':1000,'rearmed':True,'rearmWatermarkMs':900,'lateReceipt':False}
        case={'id':'guard','recordingId':'source','ownedStartSeconds':0,'ownedEndSeconds':2,
            'negativeGuards':[{'start':.5,'end':1.2,'tags':['held']}],'truth':[]}
        result={'scenario':{'name':'sustain','targets':[[60]]},'outcomes':[event],
            'ignoredGestures':0,'receipts':[{'opened':1}]}
        score=score_scenario(result,case,48000)
        self.assertEqual(score['safety']['falseAdvanceWithoutNewTruthGesture'],1)
        self.assertEqual(score['safety']['samePitchSustainAdvance'],1)

if __name__=='__main__':unittest.main()
