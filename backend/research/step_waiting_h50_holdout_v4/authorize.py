"""Build explicit source-purpose ledger only after complete identity history probe."""
from hashlib import sha256
from contracts import ROOT, HERE, OUT, read, save, verify_v3, primary_eligibility


def main():
    dependencies = verify_v3()
    history = read(OUT / 'history-probe.json')
    if (history['historyCompleteness'] != 'COMPLETE_FOR_REACHABLE_REPOSITORY_REFS_AND_SCOPED_CURRENT_FILES'
            or history['readErrors'] or not history['historyProbeDeletedGitEvidenceChecked']):
        raise ValueError('UNKNOWN_PROVENANCE_HISTORY_INCOMPLETE')
    hits = history['gitPathIdentityHits'] + history['gitHistoricalIdentityHits'] + history['currentIdentityHits']
    if hits:
        review = read(OUT / 'history-identity-review.json')
        if (review['historyProbeSha256'] != sha256((OUT / 'history-probe.json').read_bytes()).hexdigest()
                or not review['allWeakHitsResolvedToViennaWorkPrefix']
                or review['candidateIdentityHitsAfterBoundaryReview'] != 0
                or len(review['historyObjectsReviewed']) != len(history['gitHistoricalIdentityHits'])
                or len(review['currentFilesReviewed']) != len(history['currentIdentityHits'])
                or history['gitPathIdentityHits']):
            raise ValueError('STOP_UNRESOLVED_IDENTITY_HITS_NO_FRESH_ASSUMPTION')
    manifest = read(OUT / 'batik-byte-manifest.json')
    active_path = ROOT / 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json'
    active = read(active_path)
    lineage_path = ROOT / 'backend/research/reports/phase9g_d3_robust_browser_v1_identity_2026-10-13.json'
    lineage = read(lineage_path)['identity']
    if (active['model']['onnxSha256'] != lineage['onnxSha256'] or
            active['model']['checkpointSha256'] != lineage['checkpointSha256']):
        raise ValueError('ACTIVE_ROBUST_LINEAGE_MISMATCH')
    records = []
    for row in manifest['performances']:
        facts = {'dataset': 'batik', 'recordingId': row['recordingId'],
                 'license': manifest['license'], 'licenseKnown': True,
                 'researchUsePermitted': True, 'primaryQualificationRolePermitted': True,
                 'authorizedRoleScope': 'NONCOMMERCIAL_TRUTH_DISCOVERY_ONLY_NOT_ACOUSTIC_AUDIO_APPROVAL',
                 'trainingOverlapStatus': 'NO_DOCUMENTED_TRAINING_OVERLAP_IN_INSPECTED_UPSTREAM_DECLARATION',
                 'pairingEstablished': True, 'pairingBasis': 'PUBLISHER_PERFORMANCE_MIDI_AUDIO_MAPPING',
                 'provenanceComplete': True, 'historyComplete': True,
                 'historicalAcousticExposure': False, 'historicalProductDesignExposure': False,
                 'historyBasis': 'NO_BATIK_IDENTITY_HITS_AFTER_COMPLETE_IDENTITY_AND_VIENNA_WORK_PREFIX_REVIEW',
                 'historyLimitation': 'No claim about unreachable/pruned/external execution; future audio byte duplicate check still pending acquisition.',
                 'midiSha256': row['midi']['sha256'], 'futureAudioIdentity': row['audio'],
                 'sourceRepositoryCommit': manifest['commit']}
        facts['eligibilityForThisTruthDiscovery'] = primary_eligibility(facts)
        records.append(facts)
    save(OUT / 'source-authorization-ledger.json', {
        'sourcePurposePolicySha256': sha256((HERE / 'source-policy.json').read_bytes()).hexdigest(),
        'v3Dependencies': dependencies,
        'activeRobustLineage': {'activeIdentityPath': active_path.relative_to(ROOT).as_posix(),
            'activeIdentitySha256': sha256(active_path.read_bytes()).hexdigest(),
            'historicalIdentityPath': lineage_path.relative_to(ROOT).as_posix(),
            'historicalIdentitySha256': sha256(lineage_path.read_bytes()).hexdigest(),
            'onnxSha256': active['model']['onnxSha256'],
            'checkpointSha256': active['model']['checkpointSha256'],
            'upstreamDeclaration': manifest['trainingOverlapEvidence'],
            'claim': 'ACTIVE_FAMILY_LINEAGE_BOUND_NO_DOCUMENTED_BATIK_TRAINING_OVERLAP_NOT_PROVEN_EXCLUSION'},
        'maestro': {'licenseKnown': True, 'researchUsePermitted': True,
            'primaryQualificationRolePermitted': False,
            'trainingOverlapStatus': 'KNOWN_TRAINING_DOMAIN_OVERLAP',
            'allowedRole': 'DEVELOPMENT_ADAPTER_VALIDATION_ONNX_PARITY_PIPELINE_DEBUGGING_ONLY'},
        'correctedViennaRecordingCount': 24, 'batikSourceCount': len(records),
        'records': records,
        'batikEligibleRecordingIds': [r['recordingId'] for r in records if r['eligibilityForThisTruthDiscovery']['eligible']],
        'batikMidiEventsParsed': False, 'audioDownloaded': False, 'audioPcmDecoded': False,
        'newNeuralRuns': 0})
    print('Authorized Batik truth-only candidates:', len(records))


if __name__ == '__main__':
    main()
