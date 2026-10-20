"""Docker-only, metadata-only MAPS access audit. Never downloads corpus media."""

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
PHASE = 'PHASE_9G_XC3_FRESH_COMPONENT_SELECTION'
START = '8544428c62a5abb5797663f743635f7360f6042e'
LANDING = 'https://adasp.telecom-paris.fr/resources/2010-07-08-maps-database/'
LICENSE = 'https://creativecommons.org/licenses/by-nc-sa/2.0/fr/'
MAX_METADATA_BYTES = 2 * 1024 * 1024
REPORTS = ROOT / 'backend/research/reports'
WORK = ROOT / 'backend/data/work/xc3_maps_provenance'
IMAGE = 'sha256:7feadf65b7763a9ee94880218e3e80f8566ec242ffff7e9ca99d10bb85d76a6f'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(
        ['git', '-c', 'safe.directory=/workspace', *args], cwd=ROOT
    ).decode().strip()


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode()
    with path.open('xb') as handle:
        handle.write(data)
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': sha(data), 'bytes': len(data)}


class Page(HTMLParser):
    def __init__(self, html, url):
        super().__init__()
        self.url = url
        self.links = []
        self.forms = []
        self.fields = []
        self.text = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'a' and a.get('href'):
            self.links.append(urljoin(self.url, a['href']))
        if tag == 'form':
            self.forms.append({'method': a.get('method', 'get').upper(),
                               'action': urljoin(self.url, a.get('action', ''))})
        if tag in ('input', 'textarea', 'select'):
            self.fields.append({'name': a.get('name'), 'type': a.get('type', tag)})

    def handle_data(self, data):
        self.text.append(data)

    @property
    def normalized(self):
        return ' '.join(' '.join(self.text).split()).lower()

    @property
    def registration(self):
        return bool(self.forms and 'registration' in self.normalized
                    and 'e-mail' in self.normalized and 'affiliation' in self.normalized)

    @property
    def media_links(self):
        return sorted(set(u for u in self.links if urlsplit(u).path.lower().endswith(
            ('.zip', '.tar', '.gz', '.wav', '.mid', '.midi'))))


def fetch_metadata(url, name):
    attempts = []
    for number in range(1, 3):
        try:
            request = Request(url, headers={'User-Agent': 'NoteVerse-XC3-provenance-audit/1.0'})
            try:
                response = urlopen(request, timeout=30)
            except HTTPError as error:
                response = error
            with response:
                content_type = response.headers.get('Content-Type', '')
                if not any(t in content_type.lower() for t in ('text/', 'json', 'xml')):
                    raise ValueError(f'NON_METADATA_CONTENT_REFUSED:{content_type}')
                data = response.read(MAX_METADATA_BYTES + 1)
                if len(data) > MAX_METADATA_BYTES:
                    raise ValueError('METADATA_SIZE_LIMIT')
                status = response.status
                final_url = response.geturl()
            snapshot = WORK / f'{name}_attempt_{number}.html'
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            with snapshot.open('xb') as handle:
                handle.write(data)
            row = {'attempt': number, 'httpStatus': status, 'resolvedUrl': final_url,
                   'contentType': content_type, 'sha256': sha(data), 'bytes': len(data),
                   'snapshot': snapshot.relative_to(ROOT).as_posix()}
            attempts.append(row)
            if status == 200:
                return {'requestedUrl': url, 'attempts': attempts}, Page(data.decode('utf-8', 'replace'), final_url)
        except Exception as error:
            attempts.append({'attempt': number, 'error': f'{type(error).__name__}:{error}'})
        if number == 1:
            time.sleep(2)
    return {'requestedUrl': url, 'attempts': attempts}, None


def assert_docker():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('DOCKER_ONLY_NO_HOST_PYTHON')


def audit():
    assert_docker()
    if git('status', '--porcelain'):
        raise RuntimeError('CLEAN_IMPLEMENTATION_COMMIT_REQUIRED')
    head = git('rev-parse', 'HEAD')
    source = ROOT / 'backend/research/reports/phase9g_a32_challenger_qualification_report_2026-10-10.json'
    calibration = json.loads(source.read_text())['challengers']['bytedanceRobustAugmented']
    if (calibration['totalProfilesEvaluated'], calibration['gate1RemainingCount'],
            calibration['selectionMethod']) != (80, 25, 'NON_PERFORMANCE_NEUTRAL_HASH'):
        raise RuntimeError('CALIBRATION_HISTORY_DRIFT')
    landing_receipt, landing = fetch_metadata(LANDING, 'publisher')
    receipts = [landing_receipt]
    routes = [] if landing is None else sorted(set(u for u in landing.links if
        urlsplit(u).hostname == 'service.tsi.telecom-paristech.fr'
        and 'ident=maps' in u and 'subscribe.cgi' in u))
    license_links = [] if landing is None else sorted(set(u for u in landing.links if
        urlsplit(u).hostname == 'creativecommons.org'
        and '/licenses/by-nc-sa/2.0/fr/' in u))
    license_receipt, license_page = fetch_metadata(LICENSE + 'deed.en', 'license')
    receipts.append(license_receipt)
    registration = []
    for index, route in enumerate(routes):
        receipt, page = fetch_metadata(route, f'publisher_download_{index}')
        receipts.append(receipt)
        registration.append({'url': route, 'registrationFormObserved': bool(page and page.registration),
                             'forms': [] if page is None else page.forms,
                             'fieldNamesOnly': [] if page is None else page.fields,
                             'corpusMediaLinks': [] if page is None else page.media_links})
    license_verified = bool(license_links and license_page and
                            'cc by-nc-sa 2.0 fr' in license_page.normalized)
    blocked_by_registration = bool(registration and all(r['registrationFormObserved']
                                   and not r['corpusMediaLinks'] for r in registration))
    reason = ('PUBLISHER_DOWNLOAD_REQUIRES_REGISTRATION_NO_VERIFIED_SUBSET_INVENTORY'
              if blocked_by_registration else 'AUTHORITATIVE_FILE_LEVEL_SUBSET_PROVENANCE_NOT_ESTABLISHED')
    report = {
        'phase': PHASE, 'startingRemoteHead': START, 'implementationCommit': head,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'status': 'FRESH_COMPONENT_SELECTION_BLOCKED_DATASET_PROVENANCE',
        'blocker': reason,
        'stopBoundary': 'Before media download, listening, MIDI read, candidate inference or selection freeze.',
        'dockerScienceRuntimeIdentity': {'imageId': IMAGE, 'python': sys.version,
                                        'platform': platform.platform()},
        'sourceHashBoundary': [{'path': p.relative_to(ROOT).as_posix(), 'sha256': sha(p.read_bytes())}
                               for p in [Path(__file__), ROOT / 'backend/research/test_xc3_maps_provenance.py']],
        'metadataRequests': receipts, 'publisherDownloadRoutes': registration,
        'license': {'publisherLicenseLinks': license_links, 'verifiedFromPublisherAndCc': license_verified,
                    'identifier': 'CC-BY-NC-SA-2.0-FR' if license_verified else 'NOT_VERIFIED',
                    'canonicalUrl': LICENSE, 'commercialQualificationStatus': 'NOT_PERFORMED',
                    'interpretation': 'Publisher NC-SA license identified, not a grant of commercial rights or a legal opinion. Attribution and applicable share-alike duties remain.'},
        'acquisitionBoundary': {'formSubmitted': False, 'personalInformationSubmitted': False,
                                'registrationIdentityNotInvented': True, 'thirdPartyMirrorUsed': False,
                                'largeCorpusDownloaded': False, 'mediaBytesDownloaded': 0},
        'subsetProvenance': {'requestedSubset': 'Real acoustic Yamaha Disklavier MUS recordings only',
                             'candidateNamesFromLiteratureNotFileVerification': ['ENSTDkAm', 'ENSTDkCl'],
                             'publisherLandingConfirmsMixedVirtualAndDisklavier': bool(landing and 'disklavier' in landing.normalized),
                             'exactDistributionVersion': 'NOT_ESTABLISHED',
                             'authoritativeFileInventory': 'NOT_OBTAINED',
                             'upstreamChecksums': 'NOT_OBTAINED',
                             'wavMidiIdentities': 'NOT_OBTAINED', 'subsetFileLicenseVerification': 'NOT_PERFORMED',
                             'takeSelection': [], 'selectionSplit': [], 'confirmationSplit': [],
                             'prospectiveFreeze': 'NOT_CREATED'},
        'nextRequiredInput': 'Publisher-approved access or an auditable publisher-origin acoustic subset with original license, inventory and WAV/MIDI identities. No fabricated registration identity and no unverified mirror substitution.',
        'currentProfile': {'classification': 'CURRENT_FROZEN_REPRESENTATIVE_ROBUST_PROFILE',
                           'profile': 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
                           'profilesEvaluated': 80, 'correctedGate1Survivors': 25,
                           'selectionMethod': 'NON_PERFORMANCE_NEUTRAL_HASH',
                           'performanceRankSelected': False, 'NO_OPTIMAL_PROFILE_CLAIM': True},
        'execution': {'actualSessionRunCount': 0, 'newNeuralInferenceCount': 0,
                      'midiReads': 0, 'listeningPerformed': False, 'corpusSubstitution': False},
        'results': {'decoderPairedResults': 'NOT_PERFORMED', 'resamplerPairedResults': 'NOT_PERFORMED',
                    'geometryPairedResults': 'NOT_PERFORMED', 'acousticMetrics': 'NOT_PERFORMED',
                    'fiveVerdictDiagnostics': 'NOT_PERFORMED', 'causalRuntime': 'NOT_PERFORMED',
                    'paretoSurvivors': [], 'selectionDecision': 'NOT_PERFORMED',
                    'confirmationResult': 'NOT_PERFORMED', 'DECODER_DEFAULT': 'UNRESOLVED',
                    'RESAMPLER_DEFAULT': 'UNRESOLVED', 'STREAMING_GEOMETRY_DEFAULT': 'UNRESOLVED'},
        'scopeProtections': {'F5': 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',
                             'phase9gB': 'STATISTICAL_TIE', 'winner': None,
                             'XC2': 'ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES',
                             'R1': 'BOUNDED_FINALIZATION_HAS_SAFETY_TRADEOFF',
                             'R2': 'DIRECT_CONFLICT_RESERVATION_PARTIALLY_RECOVERS_SAFETY',
                             'R4Cadence': 'ROBUST_CADENCE_SUSTAINABLE',
                             'R4Headroom': 'ROBUST_20_PERCENT_HEADROOM_FAIL',
                             'viennaP15P22InferenceIncrease': 0,
                             'D4': False, 'productionWinner': None, 'practiceWebSocket': False,
                             'backendServerPracticeInference': False, 'scoreFollowing': False,
                             'expectedScoreEntersInference': False, 'historicalScienceModified': False,
                             'commercialQualificationStatus': 'NOT_PERFORMED',
                             'productLatencySlo': 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN'},
    }
    path = REPORTS / 'phase9g_xc3_maps_provenance_gate_2026-10-16.json'
    identity = write_new(path, report)
    print(json.dumps({'status': report['status'], 'blocker': reason,
                      'licenseVerified': license_verified, 'report': identity}))


def github_state(head):
    base = 'https://api.github.com/repos/tinghui0912/NoteVerse-Pro'
    rows = []
    for name, url in [('combinedStatus', f'{base}/commits/{head}/status'),
                      ('workflowRuns', f'{base}/actions/runs?head_sha={head}&per_page=100'),
                      ('branch', f'{base}/branches/codex%2Fcustomer-web-delivery-boundary')]:
        request = Request(url, headers={'User-Agent': 'NoteVerse-XC3-provenance-audit/1.0',
                                       'Accept': 'application/vnd.github+json'})
        with urlopen(request, timeout=30) as response:
            data = response.read(MAX_METADATA_BYTES + 1)
            if len(data) > MAX_METADATA_BYTES:
                raise ValueError('GITHUB_RESPONSE_SIZE_LIMIT')
            rows.append({'kind': name, 'url': url, 'httpStatus': response.status,
                         'body': json.loads(data)})
    return {'queriedAt': datetime.now(timezone.utc).isoformat(), 'commit': head, 'requests': rows,
            'interpretation': 'Empty statuses/workflow runs are not CI PASS.'}


def package():
    assert_docker()
    report_path = REPORTS / 'phase9g_xc3_maps_provenance_gate_2026-10-16.json'
    report = json.loads(report_path.read_text())
    for row in report['sourceHashBoundary']:
        if sha((ROOT / row['path']).read_bytes()) != row['sha256']:
            raise RuntimeError('PROVENANCE_AUDITOR_CHANGED_AFTER_EXECUTION')
    changes = git('diff', '--name-status', START).splitlines()
    for row in changes:
        status, path = row.split('\t', 1)
        if status != 'A' or 'xc3_' not in path:
            raise RuntimeError(f'HISTORICAL_TRACKED_CONTENT_CHANGED:{row}')
    tests = subprocess.run([sys.executable, '-m', 'unittest', 'discover',
                            '-s', 'backend/research', '-p', 'test_xc3_maps_provenance.py', '-v'],
                           cwd=ROOT, capture_output=True, text=True, check=True)
    head = git('rev-parse', 'HEAD')
    api = github_state(head)
    if api['requests'][2]['body']['commit']['sha'] != head:
        raise RuntimeError('IMPLEMENTATION_HEAD_NOT_PUSHED')
    receipt = {'phase': PHASE, 'startingRemoteHead': START, 'implementationCommit': head,
               'prospectiveCorpusFreeze': 'NOT_CREATED_DATASET_GATE_BLOCKED',
               'evidenceCommit': 'Exact containing evidence-only Git commit, returned after push; no self-referential SHA.',
               'gateReport': {'path': report_path.relative_to(ROOT).as_posix(),
                              'sha256': sha(report_path.read_bytes()), 'bytes': report_path.stat().st_size},
               'historicalTreeIdentity': git('rev-parse', START + '^{tree}'),
               'trackedChangesSinceRequiredStart': changes,
               'allExistingTrackedHistoryAndSourceUnchanged': True,
               'tests': {'exitCode': tests.returncode, 'stdout': tests.stdout, 'stderr': tests.stderr},
               'githubPreEvidence': api, 'actualSessionRunCount': 0,
               'noPreviouslyExposedCorpusSubstituted': True,
               'status': report['status'], 'scopeProtections': report['scopeProtections']}
    path = REPORTS / 'phase9g_xc3_provenance_blocker_evidence_2026-10-16.json'
    print(json.dumps(write_new(path, receipt)))


def post_push():
    assert_docker()
    head = git('rev-parse', 'HEAD')
    receipt = github_state(head)
    if receipt['requests'][2]['body']['commit']['sha'] != head:
        raise RuntimeError('EVIDENCE_REMOTE_HEAD_MISMATCH')
    path = WORK / f'github_post_push_{head}.json'
    write_new(path, receipt)
    print(json.dumps({'commit': head, 'remoteHeadVerified': True,
                      'combinedState': receipt['requests'][0]['body']['state'],
                      'statuses': receipt['requests'][0]['body']['statuses'],
                      'workflowRuns': receipt['requests'][1]['body']['workflow_runs'],
                      'branchProtected': receipt['requests'][2]['body']['protected'],
                      'receipt': path.relative_to(ROOT).as_posix()}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['audit', 'package', 'post-push'])
    args = parser.parse_args()
    {'audit': audit, 'package': package, 'post-push': post_push}[args.command]()


if __name__ == '__main__':
    main()
