import unittest

from xc3_r2_maps_acquisition import VisibleEvidence, TAXONOMY, classify, pairs_for


class MapsR2Tests(unittest.TestCase):
    def test_institutional_taxonomy_does_not_require_personal_endorsement(self):
        self.assertEqual(classify({str(i): True for i in range(6)}), TAXONOMY[1])
        self.assertEqual(classify({str(i): i != 2 for i in range(6)}), TAXONOMY[2])
        self.assertEqual(classify({}, original_endorsement=True), TAXONOMY[0])

    def test_member_role_is_heading_bound_not_global_text(self):
        p = VisibleEvidence('<h2>Research Engineers</h2><a href="mailto:stamatiadis@telecom-paris.fr">mail</a>'
                            '<h6>Paraskevas Stamatiadis</h6><h2>Alumni</h2><h6>Other Person</h6>')
        self.assertEqual(p.members[0]['roleSection'], 'Research Engineers')
        self.assertEqual(p.members[0]['precedingMailto'], ['stamatiadis@telecom-paris.fr'])
        self.assertEqual(p.members[1]['roleSection'], 'Alumni')

    def test_exact_stem_pairing_and_piece_identity_across_conditions(self):
        a = [{'path': 'ENSTDkAm/MUS/MAPS_MUS-bach_1_ENSTDkAm.wav'},
             {'path': 'ENSTDkAm/MUS/MAPS_MUS-bach_1_ENSTDkAm.mid'}]
        b = [{'path': r['path'].replace('ENSTDkAm', 'ENSTDkCl')} for r in a]
        self.assertEqual(pairs_for(a, 'ENSTDkAm.zip')[0]['pieceId'],
                         pairs_for(b, 'ENSTDkCl.zip')[0]['pieceId'])

    def test_no_unpaired_or_wrong_subset(self):
        with self.assertRaises(ValueError):
            pairs_for([{'path': 'ENSTDkAm/MUS/MAPS_MUS-piece_ENSTDkAm.wav'}], 'ENSTDkAm.zip')
        with self.assertRaises(ValueError):
            pairs_for([{'path': 'AkPnBcht/MUS/piece.wav'}], 'ENSTDkAm.zip')


if __name__ == '__main__':
    unittest.main()
