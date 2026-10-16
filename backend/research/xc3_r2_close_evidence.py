"""Append-only closure packaging for the observed bounded-discovery TLS blocker."""
from pathlib import Path

import xc3_r2_maps_acquisition as workflow
import xc3_r2_retry_metadata as retry
from xc3_r1_zenodo import json_new, git, sha


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY')
    initial_path = workflow.DIRECTORY
    initial = workflow.load(initial_path)
    retry.configure()
    latest_path = workflow.DIRECTORY
    latest = workflow.load(latest_path)
    status = 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED'
    if initial['status'] != status or latest['status'] != status:
        raise RuntimeError('BLOCKER_CLOSURE_ONLY_DO_NOT_STOP_SUCCESSFUL_DISCOVERY')
    journal_path = workflow.REPORTS / 'phase9g_xc3_r2_transport_retry_receipt_2026-10-16.json'
    journal = workflow.load(journal_path)
    for row in (journal['initialAttempt'], journal['retryAttempt'], journal['wrapperSource']):
        if sha((workflow.ROOT / row['path']).read_bytes()) != row['sha256']:
            raise RuntimeError('RETRY_CHAIN_IDENTITY_DRIFT')
    workflow.final()
    requests = [dict(archive=r['archive']['name'], **q)
                for attempt in (initial, latest) for r in attempt['archives'] for q in r['requests']]
    body_bytes = sum(q['readBytes'] for q in requests)
    if body_bytes != journal['combinedExactZipMetadataBodyBytesRead']:
        raise RuntimeError('CUMULATIVE_METADATA_BYTE_COUNT_DISAGREES')
    provenance = workflow.load(workflow.INSTITUTION)
    final_path = workflow.REPORTS / 'phase9g_xc3_r2_institutional_bounded_acquisition_final_2026-10-16.json'
    receipt = {'phase': workflow.PHASE, 'startingRemoteHead': workflow.START, 'status': status,
        'technicalBlocker': 'TLS_EOF_AND_HANDSHAKE_TIMEOUT_DURING_BOUNDED_DISCOVERY',
        'classificationInterpretation': 'Required acquisition-blocker label, not proof that the server requires full downloads: precise206 responses establish partial Range capability. Stop because both complete directories could not be safely obtained under the fixed bounded retry plan.',
        'provenanceCategory': provenance['category'],
        'originalAuthorPersonalEndorsement': 'ORIGINAL_AUTHOR_PERSONAL_ENDORSEMENT_NOT_ESTABLISHED',
        'institutionalEvidence': [{'url': r['url'], 'sha256': r['sha256'], 'retrievedAt': r['requestedAt']}
                                  for r in provenance['institutionalRequests'] if r.get('httpStatus') == 200],
        'observedName': provenance['memberEvidence']['name'],
        'observedRole': provenance['memberEvidence']['roleSection'],
        'observedEmail': provenance['observedInstitutionalEmails'], 'depositor': provenance['depositor'],
        'archiveIdentities': provenance['archiveIdentity'],
        'allRangeRequests': requests, 'rangeRequestCount': len(requests),
        'successful206Count': sum(q.get('httpStatus') == 206 for q in requests),
        'transportFailureCount': sum('error' in q for q in requests),
        'http200IgnoringRangeCount': sum(q.get('httpStatus') == 200 for q in requests),
        'cumulativeExactZipMetadataBodyBytesRead': body_bytes,
        'finalReportCountScope': 'The final report includes the latest retry30bytes; this closure/journal also include initial4bytes, cumulative34bytes.',
        'centralDirectoryInventoryStatus': 'NOT_OBTAINED_NOT_AN_OBSERVED_EMPTY_ARCHIVE',
        'observedMusWavMidiPairCount': None, 'pairCountInterpretation': 'Unknown, not zero.',
        'partialDirectoryRangePlan': [{'archive': q['archive'], 'range': q['rangeRequested'],
            'status': 'TRANSPORT_FAILED_NOT_READ'} for q in requests if q.get('rangeRequested', '').startswith('bytes=2606592173-')],
        'prospective8And8Split': 'NOT_CREATED_NO_TRUSTWORTHY_COMPLETE_PAIR_INVENTORY',
        'selectiveMemberIdentitiesAndHashes': [], 'fullArchiveFallbackPerformed': False,
        'combinedFullArchiveBytesNotDownloaded': initial['combinedArchiveBytesNotDownloaded'],
        'fullDownloadNecessityEstablished': False, 'totalMediaPayloadBytesDownloaded': 0,
        'audioContentReads': 0, 'midiContentReads': 0, 'neuralSessionRunCount': 0,
        'decoderResults': 'NOT_PERFORMED', 'resamplerResults': 'NOT_PERFORMED',
        'geometryResults': 'NOT_PERFORMED', 'selectionPareto': [], 'confirmationResult': 'NOT_PERFORMED',
        'DECODER_DEFAULT': 'UNRESOLVED', 'RESAMPLER_DEFAULT': 'UNRESOLVED',
        'STREAMING_GEOMETRY_DEFAULT': 'UNRESOLVED',
        'PROFILE_CLASSIFICATION': 'CURRENT_FROZEN_REPRESENTATIVE_ROBUST_PROFILE',
        'NO_OPTIMAL_PROFILE_CLAIM': True, 'scopeProtections': provenance['scopeProtections'],
        'implementationAndProvenanceCommitSequence': git('log', '--reverse', '--format=%H', workflow.START + '..HEAD').splitlines(),
        'sourceIdentity': workflow.identity(Path(__file__)),
        'finalReport': workflow.identity(final_path), 'retryChain': workflow.identity(journal_path),
        'evidenceCommit': 'Exact containing evidence-only commit returned after push; no self-referential SHA.'}
    path = workflow.REPORTS / 'phase9g_xc3_r2_acquisition_closure_2026-10-16.json'
    out = json_new(path, receipt)
    files = [workflow.identity(p) for p in sorted(workflow.REPORTS.glob('phase9g_xc3_r2_*.json'))]
    json_new(workflow.REPORTS / 'phase9g_xc3_r2_complete_package_manifest_2026-10-16.json', {
        'phase': workflow.PHASE, 'files': files, 'note': 'All append-only attempt/final/closure reports hashed after packaging. This manifest excludes itself.'})
    print({'closure': out, 'cumulativeZipMetadataBytes': body_bytes, 'status': status})


if __name__ == '__main__':
    main()
