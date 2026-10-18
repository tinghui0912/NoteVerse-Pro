"""Recompute Vienna-only metadata baseline with byte-verified v3 code."""
import sys
from datetime import datetime, timezone
from hashlib import sha256
from contracts import ROOT, OUT, V3, V3_REPORT, EXPECTED_BASELINE, read, save, verify_v3


def main():
    dependencies = verify_v3()
    governance_path = ROOT / 'backend/research/reports/phase9g_d1r_corrected_local_public_dataset_inventory_2026-10-12.json'
    governance = read(governance_path)
    maestro = next(x for x in governance['datasets'] if x['datasetId'] == 'maestro-v3.0.0')
    assert maestro['trainingOverlapStatus'] == 'KNOWN_TRAINING_DOMAIN_OVERLAP'
    assert maestro['currentlyAllowedResearchRole'] == 'DEVELOPMENT_ADAPTER_VALIDATION_ONNX_PARITY_PIPELINE_DEBUGGING_ONLY'
    assert maestro['knownLicenseEvidence']['license'] == 'CC BY-NC-SA 4.0'
    vienna = next(x for x in governance['datasets'] if x['datasetId'] == 'vienna-4x22')
    assert vienna['currentlyAllowedResearchRole'] == 'PUBLIC_EXTERNAL_PROXY_CANDIDATE_AFTER_PROTOCOL_AND_ALIGNMENT_VERIFICATION'
    sys.path.insert(0, str(V3))
    from select_truth import read_midi
    from selector import first_topologies
    rows = [r for r in read(V3_REPORT / 'source-inventory.json')['recordings']
            if r['primaryEligible'] and r['dataset'] == 'vienna-4x22']
    if len(rows) != 24:
        raise ValueError('CORRECTED_BASELINE_SOURCE_COUNT')
    started = datetime.now(timezone.utc).isoformat()
    sources = [read_midi(row) for row in rows]
    selected, counts = first_topologies(sources)
    result = {'executionStartedAt': started, 'completedAt': datetime.now(timezone.utc).isoformat(),
              'v3HistoricalDisposition': 'STEP_WAITING_H50_PRIMARY_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED',
              'v3ReportedPrimaryCandidateCount': 25, 'correctedPrimaryCandidateCount': 24,
              'maestroPrimaryDisposition': 'NOT_PRIMARY_ELIGIBLE_DEVELOPMENT_ONLY',
              'maestroTrainingOverlapDisposition': maestro['trainingOverlapStatus'],
              'maestroAllowedRole': maestro['currentlyAllowedResearchRole'],
              'governanceEvidence': {'path': governance_path.relative_to(ROOT).as_posix(),
                                     'sha256': sha256(governance_path.read_bytes()).hexdigest()},
              'v3Dependencies': dependencies, 'viennaOnlyTopologyCounts': counts,
              'expectedCounts': EXPECTED_BASELINE, 'matchesExpected': counts == EXPECTED_BASELINE,
              'selectedViennaCases': selected,
              'recordingIds': [s['recordingId'] for s in sources],
              'role': 'TRUTH_METADATA_OPPORTUNITIES_NOT_READY_BUSY_OR_ACOUSTIC_PASS',
              'audioPcmDecoded': False, 'newNeuralRuns': 0, 'batikMidiEventsParsed': False}
    save(OUT / 'corrected-baseline.json', result)
    print(counts)
    if counts != EXPECTED_BASELINE:
        raise ValueError('STOP_BASELINE_DIFFERS_NO_EXTERNAL_INTAKE')


if __name__ == '__main__':
    main()
