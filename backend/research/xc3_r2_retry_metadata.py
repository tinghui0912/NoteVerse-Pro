"""One bounded transport retry; unchanged reader/policy, append-only outputs."""
import argparse
from pathlib import Path

import xc3_r2_maps_acquisition as workflow
from xc3_r1_zenodo import json_new


def configure():
    workflow.WORK = workflow.WORK / 'bounded_transport_retry'
    workflow.DIRECTORY = workflow.REPORTS / 'phase9g_xc3_r2_bounded_zip_metadata_retry_2026-10-16.json'


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['retry', 'final'])
    command = parser.parse_args().command
    original = workflow.DIRECTORY
    initial = workflow.load(original)
    configure()
    if command == 'retry':
        if initial['status'] != 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED':
            raise RuntimeError('RETRY_REQUIRES_PRIOR_TRANSPORT_BLOCKER')
        workflow.directories()
    else:
        workflow.final()
    if command == 'retry':
        result = workflow.load(workflow.DIRECTORY)
        json_new(workflow.REPORTS / 'phase9g_xc3_r2_transport_retry_receipt_2026-10-16.json', {
            'phase': workflow.PHASE, 'initialAttempt': workflow.identity(original),
            'retryAttempt': workflow.identity(workflow.DIRECTORY),
            'wrapperSource': workflow.identity(Path(__file__)),
            'unchangedReaderAndWorkflowSources': workflow.load(workflow.INSTITUTION)['sourceHashBoundary'],
            'reason': 'Initial precise206 confirms partial Range capability; TLS EOF/handshake failure is not proof that full download is required. One fixed retry only.',
            'combinedExactZipMetadataBodyBytesRead': initial['exactZipMetadataBodyBytesRead'] + result['exactZipMetadataBodyBytesRead'],
            'audioContentReads': 0, 'midiContentReads': 0, 'neuralSessionRunCount': 0})


if __name__ == '__main__':
    main()
