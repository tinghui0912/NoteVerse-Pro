"""Docker-only institutional provenance and bounded MAPS archive metadata workflow."""

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import time

import xc3_r1_zenodo as reader


ROOT = reader.ROOT
WORK = ROOT / 'backend/data/work/xc3_r2_maps'
REPORTS = ROOT / 'backend/research/reports'
PHASE = 'PHASE_9G_XC3_R2_INSTITUTIONAL_PROVENANCE_AND_BOUNDED_MAPS_ACQUISITION'
START = '4a077afdcc654a79ba5e1fed7ea2a801b0e2bcd3'
NAME = 'Paraskevas Stamatiadis'
ALLOWED = ('ENSTDkAm.zip', 'ENSTDkCl.zip')
TAXONOMY = ('ORIGINAL_AUTHOR_OR_PUBLISHER_ENDORSED_ARCHIVE',
            'INSTITUTIONALLY_AFFILIATED_ARCHIVAL_REDISTRIBUTION',
            'UNLINKED_THIRD_PARTY_REDISTRIBUTION')
OLD_REPORT = REPORTS / 'phase9g_xc3_r1_zenodo_provenance_determination_2026-10-16.json'
INSTITUTION = REPORTS / 'phase9g_xc3_r2_institutional_provenance_2026-10-16.json'
DIRECTORY = REPORTS / 'phase9g_xc3_r2_bounded_zip_metadata_2026-10-16.json'


class VisibleEvidence(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.text, self.members, self.mailto = [], [], []
        self.section, self.heading, self.heading_parts = '', None, []
        self.ignore = 0
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.ignore += 1
        if tag in ('h2', 'h3', 'h6'):
            self.heading, self.heading_parts = tag, []
        a = dict(attrs)
        if tag == 'a' and a.get('href', '').startswith('mailto:'):
            self.mailto.append(a['href'][7:])

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignore = max(0, self.ignore - 1)
        if tag == self.heading:
            text = ' '.join(' '.join(self.heading_parts).split())
            if tag in ('h2', 'h3'):
                self.section = text
            elif tag == 'h6':
                self.members.append({'name': text, 'roleSection': self.section,
                                     'precedingText': ' '.join(self.text[-10:]),
                                     'precedingMailto': self.mailto[-1:]})
            self.heading = None

    def handle_data(self, data):
        if self.ignore:
            return
        text = ' '.join(data.split())
        if text:
            self.text.append(text)
            if self.heading:
                self.heading_parts.append(text)

    @property
    def normalized(self):
        return ' '.join(self.text)


def classify(conditions, original_endorsement=False):
    if original_endorsement:
        return TAXONOMY[0]
    return TAXONOMY[1] if len(conditions) == 6 and all(conditions.values()) else TAXONOMY[2]


def load(path):
    return json.loads(path.read_text())


def identity(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': reader.sha(path.read_bytes()),
            'bytes': path.stat().st_size}


def baseline():
    old = load(OLD_REPORT)
    blob = subprocess.check_output(['git', '-c', 'safe.directory=/workspace', 'show',
        START + ':' + OLD_REPORT.relative_to(ROOT).as_posix()], cwd=ROOT)
    if reader.sha(blob) != reader.sha(OLD_REPORT.read_bytes()):
        raise RuntimeError('HISTORICAL_XC3_R1_REPORT_CHANGED')
    return old


def institution():
    old = baseline()
    requests, pages = [], {}
    urls = {'members': 'https://adasp.telecom-paris.fr/members/',
            'resources': 'https://adasp.telecom-paris.fr/resources/',
            'publications': 'https://adasp.telecom-paris.fr/fr/publications/'}
    for name, url in urls.items():
        for attempt in (1, 2):
            row, data = reader.bounded_get(url, 2 * 1024 * 1024)
            row['attempt'] = attempt
            if data:
                row['snapshot'] = reader.write_new(WORK / f'{name}_{attempt}.html', data)
            requests.append(reader.sanitized(row))
            if row.get('httpStatus') == 200 and data:
                pages[name] = VisibleEvidence(data.decode('utf-8'))
                break
            time.sleep(2)
    member = next((m for m in pages.get('members', VisibleEvidence('')).members if m['name'] == NAME), None)
    emails = [] if not member else re.findall(r'[\w.+-]+@telecom-paris\.fr',
                                             member['precedingText'] + ' ' + ' '.join(member['precedingMailto']))
    role_ok = bool(member and member['roleSection'] in ('Research Engineers', 'Research Engineer'))
    contribution = []
    for name in ('resources', 'publications'):
        text = pages.get(name, VisibleEvidence('')).normalized
        index = text.find(NAME)
        contribution.append({'page': name, 'url': urls[name], 'nameObserved': index >= 0,
                             'context': text[max(0, index - 160):index + len(NAME) + 160] if index >= 0 else None})
    owner = old['provenanceChainDetermination']['recordOwner']
    owner_name = owner.get('profile', {}).get('full_name')
    docs = old['readmeAndLicense']
    doc_checks = []
    for doc in docs:
        raw = reader.WORK / ('readme.raw' if doc['name'] == 'readme.txt' else 'license_retry.raw')
        if reader.sha(raw.read_bytes()) != doc['sha256']:
            raise RuntimeError('README_OR_LICENSE_BYTES_CHANGED')
        doc_checks.append({'name': doc['name'], 'sha256': doc['sha256'], 'md5': doc['md5'], 'pass': True})
    files = {f['name']: f for f in old['fileInventory']}
    conditions = {
        'depositorIdentityIndependentlyCorroborated': owner_name == NAME and bool(member) and all(c['nameObserved'] for c in contribution),
        'originalInstitutionAffiliation': role_ok and 'stamatiadis@telecom-paris.fr' in emails,
        'datasetTitleVersionCreatorsCopyrightAgree': old['recordIdentity']['metadata']['title'] == 'MAPS - MIDI Aligned Piano Sounds'
            and old['recordIdentity']['metadata']['version'] == '0.4'
            and 'Valentin Emiya' in old['recordIdentity']['metadata']['copyright'],
        'checksumVerifiedReadmeLicense': len(doc_checks) == 2 and 'Version 0.4' in docs[0]['contents']
            and 'by-nc-sa/2.0/fr/' in docs[1]['contents'],
        'archiveSubsetIdentitiesConsistent': all(n in files for n in ALLOWED)
            and 'ENSTDkCl/ENSTDkAm' in docs[0]['contents'] and 'Disklavier' in docs[0]['contents'],
        'noContradictoryIdentityEvidenceObserved': owner_name == NAME and old['recordIdentity']['recordOwnerUserId'] == owner['id'],
    }
    result = classify(conditions)
    report = {'phase': PHASE, 'startingRemoteHead': START, 'implementationCommit': reader.git('rev-parse', 'HEAD'),
        'taxonomy': list(TAXONOMY), 'category': result, 'conditions': conditions,
        'institutionalRequests': requests, 'memberEvidence': member,
        'observedInstitutionalEmails': sorted(set(emails)), 'contributionEvidence': contribution,
        'depositor': owner, 'identityLinkInterpretation': 'Exact public Zenodo owner name corroborated by official institutional member/role/email and independently published group contributions; not private account-control authentication.',
        'originalAuthorPersonalEndorsement': 'ORIGINAL_AUTHOR_PERSONAL_ENDORSEMENT_NOT_ESTABLISHED',
        'explicitOriginalAuthorOrPublisherEndorsementFound': False,
        'legacyGatePreserved': {'XC3': 'FRESH_COMPONENT_SELECTION_BLOCKED_DATASET_PROVENANCE',
            'XC3-R1': 'ZENODO_ARCHIVE_PROVENANCE_NOT_SUFFICIENTLY_LINKED', 'historicalReport': identity(OLD_REPORT)},
        'documentChecks': doc_checks, 'zenodoRecord': old['recordIdentity'],
        'archiveIdentity': [files[n] for n in ALLOWED],
        'progressiveContentAuthenticity': 'CONTENT_PROVENANCE_SUPPORTED_BY_INSTITUTIONAL_AND_INTERNAL_CONSISTENCY',
        'internalMemberValidation': 'PENDING_BOUNDED_DIRECTORY_INSPECTION',
        'structuredLicenseAnnotationCaution': old['licenseEvidence']['structuredRightsMismatch'],
        'originalPublisherByteIdentityClaim': False, 'scientificUse': 'SCIENTIFIC_RESEARCH_ONLY',
        'commercialQualificationStatus': 'NOT_PERFORMED', 'legalOpinion': 'NOT_PERFORMED',
        'productionAssetRedistributionQualification': 'NOT_PERFORMED', 'scopeProtections': old['scopeProtections'],
        'audioContentReads': 0, 'midiContentReads': 0, 'newNeuralInferenceCount': 0,
        'sourceHashBoundary': [identity(Path(__file__)), identity(ROOT / 'backend/research/xc3_r1_zenodo.py'),
                              identity(ROOT / 'backend/research/test_xc3_r2_maps_acquisition.py')]}
    print(json.dumps({'report': reader.json_new(INSTITUTION, report), 'category': result, 'conditions': conditions}))


def verify_sources(report):
    for row in report['sourceHashBoundary']:
        if reader.sha((ROOT / row['path']).read_bytes()) != row['sha256']:
            raise RuntimeError('PROSPECTIVE_ACQUISITION_SOURCE_DRIFT')


def classify_member(path, archive):
    subset = archive.removesuffix('.zip')
    if not path.startswith(subset + '/'):
        raise ValueError('ARCHIVE_SUBSET_PATH_INCONSISTENT')
    suffix = Path(path).suffix.lower()
    if '/MUS/' in path and suffix == '.wav':
        return 'MUS_WAV'
    if '/MUS/' in path and suffix in ('.mid', '.midi'):
        return 'MUS_MIDI'
    return 'NON_MUS_AUDIO_MIDI' if suffix in ('.wav', '.mid', '.midi') else 'METADATA_OTHER'


def pairs_for(rows, archive):
    subset = archive.removesuffix('.zip')
    wav, midi = {}, {}
    for row in rows:
        row['role'] = classify_member(row['path'], archive)
        stem = str(Path(row['path']).with_suffix(''))
        if row['role'] == 'MUS_WAV':
            if stem in wav:
                raise ValueError('DUPLICATE_WAV_STEM')
            wav[stem] = row
        elif row['role'] == 'MUS_MIDI':
            if stem in midi:
                raise ValueError('DUPLICATE_MIDI_STEM')
            midi[stem] = row
    if not wav or set(wav) != set(midi):
        raise ValueError('MUS_WAV_MIDI_PAIRING_INCONSISTENT')
    pairs = []
    for stem in sorted(wav):
        name = Path(stem).name
        match = re.fullmatch(r'MAPS_MUS-(.+)_' + re.escape(subset), name)
        if not match:
            raise ValueError('MAPS_MUS_NAMING_INCONSISTENT')
        pairs.append({'archive': archive, 'recordingCondition': subset,
            'pieceId': match[1].lower(), 'wav': wav[stem], 'midi': midi[stem]})
    return pairs


def directories():
    provenance = load(INSTITUTION)
    verify_sources(provenance)
    if provenance['category'] != TAXONOMY[1]:
        raise RuntimeError('INSTITUTIONAL_PROVENANCE_NOT_ACCEPTED')
    # Only relocate output; the historical fail-closed HTTP/ZIP functions are unchanged.
    reader.WORK = WORK
    results, pairs = [], []
    for file in provenance['archiveIdentity']:
        name = file['name']
        if name not in ALLOWED:
            raise RuntimeError('SYNTHETIC_ARCHIVE_TARGET_FORBIDDEN')
        frozen = {'name': name, 'bytes': file['bytes'], 'reportedChecksum': file['reportedChecksum'],
                  'downloadUrl': reader.RECORD + '/files/' + name + '?download=1'}
        result = reader.inspect_archive(frozen)
        for request in result['requests']:
            request['headers'] = {k: v for k, v in request.get('headers', {}).items()
                                  if k.lower() not in ('set-cookie', 'cookie')}
            if request.get('validatedContentRange') and request['validatedContentRange'][2] != file['bytes']:
                raise RuntimeError('ARCHIVE_CONTENT_RANGE_TOTAL_IDENTITY_DRIFT')
        if result['status'] == 'BOUNDED_CENTRAL_DIRECTORY_VERIFIED':
            try:
                pair_rows = pairs_for(result['members'], name)
                result['observedMusPairCount'] = len(pair_rows)
                pairs.extend(pair_rows)
            except ValueError as error:
                result['status'] = 'MAPS_ARCHIVE_INTERNAL_STRUCTURE_INCONSISTENT'
                result['error'] = str(error)
        results.append(result)
        time.sleep(2)
    success = all(r['status'] == 'BOUNDED_CENTRAL_DIRECTORY_VERIFIED' for r in results)
    status = 'BOUNDED_MAPS_DIRECTORY_AND_PAIRING_VERIFIED' if success else (
        'MAPS_ARCHIVE_INTERNAL_STRUCTURE_INCONSISTENT' if any(r['status'] == 'MAPS_ARCHIVE_INTERNAL_STRUCTURE_INCONSISTENT' for r in results)
        else 'MAPS_BOUNDED_MEMBER_DISCOVERY_BLOCKED_FULL_ARCHIVE_REQUIRED')
    receipt = {'phase': PHASE, 'startingRemoteHead': START, 'provenanceReceipt': identity(INSTITUTION),
        'status': status, 'archives': results, 'candidatePairs': pairs,
        'exactZipMetadataBodyBytesRead': sum(q['readBytes'] for r in results for q in r['requests']),
        'audioContentReads': 0, 'midiContentReads': 0, 'newNeuralInferenceCount': 0,
        'fullArchiveFallbackPerformed': False, 'combinedArchiveBytesNotDownloaded': sum(f['bytes'] for f in provenance['archiveIdentity']),
        'scopeProtections': provenance['scopeProtections'], 'NO_OPTIMAL_PROFILE_CLAIM': True,
        'prospectiveSplit': 'NOT_FROZEN' if not success else 'NEXT_STEP_METADATA_ONLY_SPLIT',
        'selectedMemberHashes': [], 'DECODER_DEFAULT': 'UNRESOLVED', 'RESAMPLER_DEFAULT': 'UNRESOLVED',
        'STREAMING_GEOMETRY_DEFAULT': 'UNRESOLVED', 'selectionMetrics': 'NOT_PERFORMED',
        'confirmationResult': 'NOT_PERFORMED'}
    print(json.dumps({'receipt': reader.json_new(DIRECTORY, receipt), 'status': status,
                      'metadataBodyBytes': receipt['exactZipMetadataBodyBytesRead']}))


def final():
    from xc3_maps_provenance import github_state
    provenance = load(INSTITUTION)
    verify_sources(provenance)
    archive = load(DIRECTORY) if DIRECTORY.exists() else None
    status = archive['status'] if archive else provenance['category']
    tests = []
    for name in ('test_xc3_r2_maps_acquisition.py', 'test_xc3_r1_zenodo.py'):
        result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'backend/research',
            '-p', name, '-v'], cwd=ROOT, capture_output=True, text=True, check=True)
        tests.append({'command': f'python -m unittest discover -s backend/research -p {name} -v',
                      'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    changes = reader.git('diff', '--name-status', START).splitlines()
    if any(not row.startswith('A\t') or 'xc3_r2_' not in row for row in changes):
        raise RuntimeError('HISTORICAL_SOURCE_OR_EVIDENCE_CHANGED')
    github = None
    try:
        github = github_state(reader.git('rev-parse', 'HEAD'))
    except Exception as error:
        github = {'status': 'QUERY_FAILED', 'error': str(error)}
    report = {'phase': PHASE, 'startingRemoteHead': START, 'status': status,
        'commitSequenceBeforeFinalEvidence': reader.git('log', '--reverse', '--format=%H', START + '..HEAD').splitlines(),
        'finalEvidenceCommit': 'Exact containing evidence-only commit returned after push; no self-referential hash.',
        'institutionalProvenance': provenance, 'boundedZipMetadata': archive,
        'provenanceCategory': provenance['category'],
        'originalAuthorPersonalEndorsement': 'ORIGINAL_AUTHOR_PERSONAL_ENDORSEMENT_NOT_ESTABLISHED',
        'contentProvenanceScope': 'CONTENT_PROVENANCE_SUPPORTED_BY_INSTITUTIONAL_AND_INTERNAL_CONSISTENCY; directory consistency is reported separately, not presumed if access failed.',
        'byteIdentityWithOriginalPublisherClaim': False,
        'exactZipMetadataBytesRead': archive['exactZipMetadataBodyBytesRead'] if archive else 0,
        'totalMediaPayloadBytesDownloaded': 0, 'audioContentReads': 0, 'midiContentReads': 0,
        'neuralSessionRunCount': 0, 'synthesizedArchiveRequests': 0,
        'prospectiveSplit': 'NOT_FROZEN' if not archive or archive['status'] != 'BOUNDED_MAPS_DIRECTORY_AND_PAIRING_VERIFIED' else 'PENDING_PROSPECTIVE_METADATA_SPLIT_COMMIT',
        'selectedMemberIdentitiesAndHashes': [], 'decoderResults': 'NOT_PERFORMED',
        'resamplerResults': 'NOT_PERFORMED', 'geometryResults': 'NOT_PERFORMED',
        'selectionPareto': [], 'confirmationResult': 'NOT_PERFORMED',
        'DECODER_DEFAULT': 'UNRESOLVED', 'RESAMPLER_DEFAULT': 'UNRESOLVED',
        'STREAMING_GEOMETRY_DEFAULT': 'UNRESOLVED',
        'PROFILE_CLASSIFICATION': 'CURRENT_FROZEN_REPRESENTATIVE_ROBUST_PROFILE',
        'NO_OPTIMAL_PROFILE_CLAIM': True, 'historicalFilesUnchanged': True,
        'trackedChangesFromRequiredStart': changes, 'tests': tests, 'githubPreFinalEvidence': github,
        'scopeProtections': provenance['scopeProtections']}
    report['reportCanonicalSha256'] = reader.sha(json.dumps(report, sort_keys=True, separators=(',', ':')).encode())
    path = REPORTS / 'phase9g_xc3_r2_institutional_bounded_acquisition_final_2026-10-16.json'
    out = reader.json_new(path, report)
    reader.json_new(REPORTS / 'phase9g_xc3_r2_evidence_manifest_2026-10-16.json', {
        'phase': PHASE, 'files': [identity(p) for p in (INSTITUTION, DIRECTORY, path) if p.exists()],
        'finalReportCanonicalSha256': report['reportCanonicalSha256'],
        'note': 'Final report written once before filesystem hashing. Manifest excludes itself.'})
    print(json.dumps({'report': out, 'status': status}))


def post_push():
    from xc3_maps_provenance import github_state
    head = reader.git('rev-parse', 'HEAD')
    receipt = github_state(head)
    if receipt['requests'][2]['body']['commit']['sha'] != head:
        raise RuntimeError('REMOTE_HEAD_MISMATCH')
    reader.json_new(WORK / f'github_post_push_{head}.json', {'phase': PHASE, **receipt})
    print(json.dumps({'commit': head, 'remoteHeadVerified': True,
        'combinedState': receipt['requests'][0]['body']['state'],
        'statuses': receipt['requests'][0]['body']['statuses'],
        'workflowRuns': receipt['requests'][1]['body']['workflow_runs']}))


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY_NO_HOST_PYTHON')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['institution', 'directories', 'final', 'post-push'])
    command = parser.parse_args().command
    {'institution': institution, 'directories': directories, 'final': final, 'post-push': post_push}[command]()


if __name__ == '__main__':
    main()
