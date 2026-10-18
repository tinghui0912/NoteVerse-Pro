import unittest
import io
import sys
import json
import subprocess
from pathlib import Path
import closure as c


class ClosureAuditTests(unittest.TestCase):
    def test_starting_remote_identity(self):
        self.assertEqual(c.audit.git('merge-base',c.START,'HEAD'),c.START)

    def test_immutable_chain(self):
        result=c.verify()
        self.assertEqual(result['hashMismatches'],0)
        self.assertEqual(len(result['v9CellIdentities']),40)

    def test_production_and_v3_v9_unchanged(self):c.unchanged()

    def test_no_neural_import(self):
        with self.assertRaises(PermissionError):__import__('onnxruntime')

    def test_no_audio_decoder_import(self):
        with self.assertRaises(PermissionError):__import__('soundfile')

    def test_no_browser_import(self):
        with self.assertRaises(PermissionError):__import__('playwright')

    def test_child_execution_denied(self):
        with self.assertRaises(PermissionError):subprocess.run([sys.executable,'-c','raise Exception("MUST_NOT_RUN")'])

    def test_selected_pcm_not_semantically_read(self):
        with self.assertRaises(PermissionError):c.read('backend/data/work/step_waiting_h50_holdout_v6/audio_only/example.f32')

    def test_no_stage_a_payload_parse(self):
        with self.assertRaises(PermissionError):c.read(c.audit.ACOUSTIC)

    def test_v9_disposition_remains_not_qualified(self):
        self.assertEqual(c.read(c.V9+'stage-b-results.json')['disposition'],c.V9_DISPOSITION)

    def test_two_independent_stored_blockers(self):
        r=c.read(c.V9+'stage-b-results.json')
        self.assertEqual(r['actualValidEmpiricalCells'],30)
        self.assertEqual(r['empiricalCellsExpected'],38)
        self.assertEqual(len(r['functionalFailures']),6)
        self.assertEqual(r['safetyCounters']['busyPeriodCarryoverAdvance']['validCausalDenominator'],0)
        self.assertEqual(r['safetyCounters']['latePublicationCarryoverAdvance']['validCausalDenominator'],0)

    def test_physical_and_decoded_anchor_metrics_are_distinct(self):
        cell=c.read(c.V9+'cells/correct_chord-44100.json');a=cell['attempts'][0]
        row=c.latency_row(cell,a)
        self.assertNotEqual(row['physicalTruthToAttemptOpenCaptureProgressMs'],row['decodedEventToAttemptOpenCaptureProgressMs'])
        self.assertEqual(row['decodedEventToAttemptOpenCaptureProgressMs'],a['timing']['sourceEventToAttemptOpenCaptureProgressMs'])
        self.assertEqual(row['physicalTruthToAttemptOpenCaptureProgressMs'],a['timing']['attemptOpenMs']-a['timing']['physicalSourceMs'])

    def test_both_rates_latency_labels_confirmed_without_replay(self):
        for rate in (44100,48000):
            cell=c.read(c.V9+f'cells/correct_chord-{rate}.json')
            row=c.latency_row(cell,cell['attempts'][0])
            self.assertEqual(row['sourceRateHz'],rate)
            self.assertEqual(row['interpretation'],'NOT_PHYSICAL_DEVICE_UX_LATENCY')

    def test_summaries_use_nearest_rank_and_preserve_empty(self):
        self.assertEqual(c.distribution([1,2,3,4]),{'count':4,'p50':2,'p95':4,'max':4})
        self.assertEqual(c.distribution([]),{'count':0,'p50':None,'p95':None,'max':None})

    def test_diagnostics_do_not_mutate_cells(self):
        cell=c.read(c.V9+'cells/correct_chord-44100.json');before=c.audit.canonical(cell)
        c.diagnostics([cell]);self.assertEqual(c.audit.canonical(cell),before)

    def test_stored_failure_mechanisms(self):
        names=('correct_chord','post_ready_repeat','single_busy_retrigger','chord_busy_retrigger','late_publication')
        cells=[c.read(c.V9+f'cells/{n}-{r}.json') for n in names for r in (44100,48000)]
        inventory=c.mechanisms(cells)
        self.assertEqual(len(inventory['correctChord']),2)
        self.assertEqual(len(inventory['late']),2)
        self.assertFalse(inventory['HWidthRootCauseEstablished'])

    def test_high_confidence_and_octave_findings_not_heuristic_fix(self):
        cell=c.read(c.V9+'cells/correct_chord-44100.json');obs=cell['attempts'][0]['attempt']['observations']
        true=next(o for o in obs if o['midiPitch']==56)
        false=next(o for o in obs if o['midiPitch']==52)
        self.assertGreater(false['confidence'],true['confidence'])
        repeat=c.read(c.V9+'cells/post_ready_repeat-44100.json')
        self.assertEqual(repeat['targetPitchSets'][0],[46,58])

    def test_candidate_not_selected(self):
        value=json.loads((c.HERE/'next-candidate-requirements.json').read_text())
        self.assertFalse(value['candidateSelected']);self.assertFalse(value['executionAuthorized'])
        self.assertEqual(value['candidateStatusVocabulary'],'PRODUCT_ENGINEERING_CANDIDATE')

    def test_h_and_thresholds_not_retuned(self):
        value=json.loads((c.HERE/'next-candidate-requirements.json').read_text())['historicalCandidate']
        self.assertEqual((value['HMs'],value['onsetThreshold'],value['frameThreshold']),(50,.30,.05))
        self.assertFalse(value['HWidthRootCauseEstablished'])

    def test_dangerous_heuristics_prohibited(self):
        value=json.loads((c.HERE/'next-candidate-requirements.json').read_text())
        names={r['name'] for r in value['prohibitedHeuristicRepairs']}
        self.assertIn('target subset acceptance',names);self.assertIn('global octave deduplication',names)
        self.assertIn('confidence threshold fitted on v9',names)

    def test_no_fresh_strike_detector_authorized(self):
        value=json.loads((c.HERE/'next-candidate-requirements.json').read_text())
        self.assertIn('RMS gate',value['prohibitedDetectors'])
        self.assertIn('second onset detector',value['prohibitedDetectors'])

    def test_no_future_holdout_recording_selected(self):
        value=json.loads((c.HERE/'fresh-holdout-design.json').read_text())
        self.assertEqual(value['recordingsSelected'],[]);self.assertFalse(value['audioAcquisitionAuthorized'])
        self.assertFalse(value['executionAuthorized']);self.assertFalse(value['candidateChosen'])

    def test_busy_grid_geometry_not_guessed_gap_or_output(self):
        value=json.loads((c.HERE/'fresh-holdout-design.json').read_text())
        self.assertEqual(value['rates'],[44100,48000])
        self.assertIsNone(value['BUSY_GAP_GRID']['selectedGapValues'])
        self.assertFalse(value['BUSY_GAP_GRID']['gridExecuted'])
        self.assertIn('P1_min',value['busyFeasibility'])
        self.assertIn('S_latest',value['busyFeasibility']['bounds'])

    def test_late_requires_distinct_publication_and_retired_rearm(self):
        value=json.loads((c.HERE/'fresh-holdout-design.json').read_text())['latePublicationDesign']
        self.assertIn('differ from W1',value['separatePublication'])
        self.assertIn('strictly after next READY',value['retirement'])
        self.assertIn('source-owned W2 identity only',value['selector'])

    def test_zero_over_zero_and_functional_blockers_separate(self):
        value=json.loads((c.HERE/'fresh-holdout-design.json').read_text())['denominators']
        self.assertIn('zero/zero never PASS',value['safety'])
        self.assertIn('coequal blockers',value['functional'])

    def test_capabilities_closed(self):
        self.assertEqual(c.CAPS,{'Continuous':'MODEL_NOT_VALIDATED','STEP':'ATTEMPT_ANALYZER_NOT_VALIDATED','productionMicrophone':False,'D4':False})
        self.assertTrue(all(v==0 for k,v in c.ZERO.items() if k!='selectedPcmDecoded'))
        self.assertFalse(c.ZERO['selectedPcmDecoded'])


if __name__=='__main__':
    stream=io.StringIO();suite=unittest.defaultTestLoader.loadTestsFromTestCase(ClosureAuditTests)
    result=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)
    c.save('tests.json',{'testFiles':1,'tests':result.testsRun,'passed':result.testsRun-len(result.failures)-len(result.errors),
        'failed':len(result.failures),'errors':len(result.errors),'scope':'Metadata/diagnostic arithmetic/design invariants only, no Stage B replay',
        'output':stream.getvalue(),**c.ZERO})
    print(stream.getvalue());sys.exit(0 if result.wasSuccessful() else 1)
