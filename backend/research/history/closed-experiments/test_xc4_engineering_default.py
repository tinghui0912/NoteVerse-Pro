import copy
import unittest

import xc4_engineering_default as xc4


class EngineeringIdentityTests(unittest.TestCase):
    def test_canonical_digest_key_order_and_mutation(self):
        self.assertEqual(xc4.digest({'a': 1, 'b': 2}), xc4.digest({'b': 2, 'a': 1}))
        self.assertNotEqual(xc4.digest({'a': 1}), xc4.digest({'a': 2}))
        with self.assertRaises(ValueError):
            xc4.digest({'bad': float('nan')})

    def test_existing_identity_assembled_without_inference(self):
        value = xc4.build_identity()
        self.assertEqual(value['model']['candidateId'], 'bytedance-robust-augmented-calibrated-v1')
        self.assertEqual(value['input']['modelInputSamples'], 29120)
        self.assertEqual(value['runtime']['ortWebVersion'], '1.20.1')
        self.assertEqual(value['runtime']['provider'], 'webgpu')
        self.assertFalse(value['runtime']['automaticFallback'])
        self.assertEqual(value['decoder']['default'], 'A')
        self.assertEqual((value['decoder']['onsetThreshold'], value['decoder']['frameThreshold']), (.30, .05))
        self.assertEqual(value['resampler']['default'], 'BAND_LIMITED')
        self.assertEqual((value['ownership']['ownedMs'], value['ownership']['futureContextMs']), (600, 170))
        self.assertEqual(value['ownership']['fullWindowPastMs'], 1820 - 600 - 170)
        self.assertEqual(value['ownership']['rule'], '[ownedStartMs,ownedEndMs)')
        changed = copy.deepcopy(value)
        changed['ownership']['futureContextMs'] = 120
        self.assertNotEqual(xc4.digest(value), xc4.digest(changed))
        self.assertEqual(value['decoder']['authoritativeSource'], xc4.file_identity(xc4.AUTHORITATIVE))

    def test_scope_and_decision_separation(self):
        self.assertFalse(xc4.SCOPE['productionMicrophone'])
        self.assertFalse(xc4.SCOPE['D4'])
        self.assertIsNone(xc4.SCOPE['productionWinner'])
        self.assertEqual(xc4.SCOPE['F5'], 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER')
        self.assertTrue(xc4.interpretation()['NO_OPTIMAL_PROFILE_CLAIM'])
        self.assertTrue(all(v == 0 for v in xc4.COUNTERS.values()))
        self.assertEqual(xc4.interpretation()['PRODUCT_FINALIZATION_POLICY'], 'STILL_PRODUCT_CRITICAL')

    def test_stopping_rule_and_inactive_integration(self):
        self.assertEqual(len(xc4.policy()['sufficientReasons']), 4)
        self.assertFalse(xc4.policy()['maps']['networkRetryAuthorizedByThisPhase'])
        self.assertEqual(xc4.integration_plan()['status'], 'INACTIVE_PLAN_ONLY_NO_PRODUCTION_SOURCE_CHANGES')
        self.assertFalse(xc4.integration_plan()['productionMicrophone'])
        self.assertEqual(len(xc4.integration_plan()['unresolvedProductCritical']), 5)

    def test_matrix_is_complete_and_uses_explicit_relevance(self):
        rows = xc4.matrix()
        self.assertEqual(len(rows), 6)
        for row in rows:
            self.assertIn(row['additionalEvidenceDecisionRelevance'], {
                'CLOSED_FOR_CURRENT_ENGINEERING', 'REOPEN_ONLY_ON_TRIGGER', 'STILL_PRODUCT_CRITICAL'})
            self.assertTrue(row['evidenceSupportingDefault'])
            self.assertTrue(row['evidenceAgainstOrChallenging'])
            self.assertTrue(row['knownLimitation'])

    def test_existing_report_assertions_only_no_replay(self):
        audit = xc4.verify_existing_evidence()
        self.assertEqual(len(audit['storedOriginalParetoIds']), 7)
        self.assertEqual(audit['firParityObservedExact']['allRecordedMaxAbsAndRms'], 0)
        self.assertFalse(audit['firParityObservedExact']['newParityExperimentRun'])


if __name__ == '__main__':
    unittest.main()
