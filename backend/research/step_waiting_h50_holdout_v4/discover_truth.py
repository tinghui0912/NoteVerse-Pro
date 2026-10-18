"""Post-remote-freeze MIDI-only discovery, reusing the exact v3 selector."""
from datetime import datetime, timezone
import io
import subprocess
import sys
from contracts import (ROOT, OUT, V3, MISSING, read, save, gap_fill,
                       require_remote_proof)


def main():
    freeze = read(OUT / 'source-discovery-freeze.json')
    proof = read(OUT / 'source-discovery-remote-proof.json')
    started = datetime.now(timezone.utc).isoformat()
    require_remote_proof(freeze, proof, started)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if head != proof['freezeCommit']:
        raise ValueError('EXECUTION_MUST_USE_EXACT_DISCOVERY_FREEZE_HEAD')
    if not read(OUT / 'corrected-baseline.json')['matchesExpected']:
        raise ValueError('BASELINE_REQUIRED')
    manifest = read(OUT / 'batik-byte-manifest.json')
    ledger = read(OUT / 'source-authorization-ledger.json')
    eligible = set(ledger['batikEligibleRecordingIds'])
    if len(eligible) != 36:
        raise ValueError('SOURCE_PROVENANCE_INCOMPLETE')
    # No musical parser is imported or invoked until all immutable proof gates pass.
    sys.path.insert(0, str(V3))
    import mido
    from select_truth import read_midi
    from selector import first_topologies
    sources = []
    per_source = []
    for row in manifest['performances']:
        if row['recordingId'] not in eligible:
            raise ValueError('NON_ELIGIBLE_SOURCE')
        midi_bytes = (ROOT / row['midi']['path']).read_bytes()
        duration = mido.MidiFile(file=io.BytesIO(midi_bytes)).length
        source = read_midi({'dataset': 'batik', 'recordingId': row['recordingId'],
                            'midi': row['midi'],
                            'audio': {'sha256': None, 'durationSeconds': duration}})
        sources.append(source)
        _, counts = first_topologies([source])
        per_source.append({'recordingId': source['recordingId'],
            'midiSha256': source['midiSha256'], 'durationMs': source['durationMs'],
            'durationProvenance': 'SYMBOLIC_MIDI_END_OF_TRACK_NOT_MEASURED_AUDIO_DURATION',
            'noteOnCount': source['noteOnCount'], 'gestureCount': len(source['gestures']),
            'availableOccurrenceCounts': counts})
    selected, counts = first_topologies(sources)
    gaps = gap_fill({family: selected[family] for family in MISSING if family in selected})
    by_id = {row['recordingId']: row for row in manifest['performances']}
    bound = {}
    for family, item in gaps.items():
        row = by_id[item['recordingId']]
        bound[family] = dict(item, sourceRepositoryCommit=manifest['commit'],
            metadataRowIndex=row['metadataRowIndex'], metadataRowSha256=row['metadataRowSha256'],
            sourceAudioIdentity=row['audio'],
            audioAlignmentAndInputPreservation='NOT_MEASURED_AUDIO_NOT_ACQUIRED')
    remaining = [family for family in MISSING if counts[family] == 0]
    result = {
        **proof, 'midiParseStartedAt': started,
        'completedAt': datetime.now(timezone.utc).isoformat(),
        'executionKind': 'TRUTH_METADATA_OPPORTUNITIES_NOT_READY_BUSY_OR_ACOUSTIC_PASS',
        'HMs': 50, 'externalDataset': 'Batik', 'externalRepositoryCommit': manifest['commit'],
        'batikMidiFileCount': len(sources),
        'batikMidiShaManifest': [{'recordingId': r['recordingId'], **r['midi']} for r in manifest['performances']],
        'batikTopologyCounts': {f: counts[f] for f in MISSING},
        'batikDiagnosticOnlyCounts': {f: counts[f] for f in ('same_chord_sustain', 'chord_busy_retrigger')},
        'perSourceCounts': per_source, 'selectedGapFillCases': bound,
        'remainingMandatoryFamilies': remaining,
        'audioDownloaded': False, 'audioPcmDecoded': False,
        'newNeuralRuns': 0, 'RobustSessionRuns': 0,
        'primaryQualificationFreeze': 'NOT_CREATED',
        'ContinuousRegression': 'NOT_STARTED', 'StageA': 'NOT_STARTED', 'StageB': 'NOT_STARTED',
        'safetyCounters': 'NOT_MEASURED', 'usabilityMetrics': 'NOT_MEASURED',
        'disposition': 'STEP_WAITING_H50_EXTERNAL_BATIK_TRUTH_TOPOLOGY_INCOMPLETE' if remaining
            else 'STEP_WAITING_H50_EXTERNAL_TRUTH_TOPOLOGY_COMPLETE_AUDIO_ACQUISITION_NOT_STARTED'}
    save(OUT / 'batik-truth-topology.json', result)
    if not remaining:
        baseline = read(OUT / 'corrected-baseline.json')
        retained = baseline['selectedViennaCases']
        if any(item['dataset'] != 'vienna-4x22' for item in retained.values()):
            raise ValueError('MAESTRO_MUST_NOT_ENTER_COMBINED_TOPOLOGY')
        save(OUT / 'combined-truth-topology.json', {
            **proof, 'status': 'TRUTH_TOPOLOGY_COMPLETE_AUDIO_SOURCE_NOT_ACQUIRED',
            'viennaCasesUnchanged': retained, 'batikGapFillCases': bound,
            'HMs': 50, 'notAnAcousticPrimaryFreeze': True,
            'physicalTopologyOnly': True, 'audioSuitability': 'NOT_ESTABLISHED',
            'acousticSafety': 'NOT_MEASURED', 'newNeuralRuns': 0})
    print({'batikTopologyCounts': result['batikTopologyCounts'],
           'remainingMandatoryFamilies': remaining, 'disposition': result['disposition']})


if __name__ == '__main__':
    main()
