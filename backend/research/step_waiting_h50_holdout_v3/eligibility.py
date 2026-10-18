"""Pure recording-level eligibility. No files, models, MIDI events or product imports."""

CLASSES = frozenset({
    'ACTUAL_ROBUST_EXECUTION', 'OUTPUT_BEARING_INSPECTION',
    'OUTPUT_DRIVEN_SELECTION_OR_TUNING', 'TRUTH_ONLY_INVENTORY',
    'TRUTH_ONLY_PRIOR_SELECTION', 'PRIOR_PRODUCT_TOPOLOGY_DESIGN_EXPOSURE',
    'UNKNOWN_PROVENANCE',
})
BLOCKING = frozenset({
    'ACTUAL_ROBUST_EXECUTION', 'OUTPUT_BEARING_INSPECTION',
    'OUTPUT_DRIVEN_SELECTION_OR_TUNING', 'PRIOR_PRODUCT_TOPOLOGY_DESIGN_EXPOSURE',
    'UNKNOWN_PROVENANCE',
})
FACT_FIELDS = frozenset({'recordingId', 'audioSha256', 'midiSha256', 'lineageAudioSha256s',
                         'pairingEstablished', 'researchAuthorized', 'provenanceComplete'})
EVENT_FIELDS = frozenset({'exposureClass', 'audioSha256', 'evidencePath', 'basis'})


def primary_decision(facts, ledger):
    if set(facts) != FACT_FIELDS:
        raise ValueError('METADATA_FACT_SCHEMA_ONLY')
    audio_identities = {facts['audioSha256'], *facts['lineageAudioSha256s']}
    relevant = []
    for event in ledger:
        if set(event) != EVENT_FIELDS or event['exposureClass'] not in CLASSES:
            raise ValueError('EXPOSURE_METADATA_SCHEMA_ONLY')
        if event['audioSha256'] in audio_identities:
            relevant.append(event)
    reasons = sorted({event['exposureClass'] for event in relevant} & BLOCKING)
    if not facts['pairingEstablished']:
        reasons.append('PAIRING_PROVENANCE_NOT_ESTABLISHED')
    if not facts['researchAuthorized']:
        reasons.append('RESEARCH_AUTHORIZATION_NOT_ESTABLISHED')
    if not facts['provenanceComplete']:
        reasons.append('UNKNOWN_PROVENANCE')
    return {'recordingId': facts['recordingId'], 'primaryEligible': not reasons,
            'exclusionReasons': sorted(set(reasons)),
            'exposureClasses': sorted({event['exposureClass'] for event in relevant}),
            'evidence': relevant}
