"""Evidence/receipt generation; never selects or parses performance events."""
from datetime import datetime, timezone
from hashlib import sha256
import sys
from contracts import ROOT, OUT, WORK, START, read, save
from intake import git, github_snapshot


def protected_diff():
    return git('diff', '--name-status', START, 'HEAD', '--',
               'apps/customer-web/src', 'apps/customer-web/public', 'backend/app',
               'backend/research/step_waiting_h50_holdout_v3',
               'backend/research/reports/step_waiting_h50_holdout_v3')


def chain():
    return git('log', '--reverse', '--format=%H %s', START + '..HEAD').splitlines()


def assessment():
    baseline = read(OUT / 'corrected-baseline.json')
    manifest = read(OUT / 'batik-byte-manifest.json')
    result = read(OUT / 'batik-truth-topology.json')
    history = read(OUT / 'history-probe.json')
    proof = read(OUT / 'source-discovery-remote-proof.json')
    freeze = read(OUT / 'source-discovery-freeze.json')
    changed = []
    for row in freeze['files']:
        if sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            changed.append(row['path'])
    if changed or protected_diff():
        raise ValueError('FROZEN_SOURCE_OR_PROTECTED_HISTORY_CHANGED')
    value = {
        'phase': 'PRACTICE_STEP_H50_EXTERNAL_TRUTH_TOPOLOGY_GAP_FILL_DISCOVERY_DISABLED',
        'startingRemoteHead': START, 'remoteHeadAtAssessment': proof['remoteHead'],
        'commitChainThroughDiscoveryFreeze': chain(), 'productionDiff': '', 'v3HistoricalDiff': '',
        'v3HistoricalDisposition': baseline['v3HistoricalDisposition'],
        'v3ReportedPrimaryCandidateCount': 25, 'correctedPrimaryCandidateCount': 24,
        'maestroPrimaryDisposition': baseline['maestroPrimaryDisposition'],
        'maestroTrainingOverlapDisposition': baseline['maestroTrainingOverlapDisposition'],
        'maestroAllowedRole': baseline['maestroAllowedRole'],
        'viennaOnlyTopologyCounts': baseline['viennaOnlyTopologyCounts'],
        'externalDataset': 'Batik', 'externalRepositoryCommit': manifest['commit'],
        'license': manifest['license'], 'licenseScope': 'NONCOMMERCIAL_RESEARCH_ONLY_NOT_COMMERCIAL_QUALIFICATION',
        'attribution': 'Hu, Patricia and Widmer, Gerhard. The Batik-plays-Mozart Corpus: Linking Performance to Score to Musicological Annotations. ISMIR 2023. Benchmark JKU Disklavier audio provenance documented by pymatchmaker.',
        'derivedTruthArtifactLicense': 'CC BY-NC-SA 4.0; software is a separate work, not a relicensing of product code.',
        'pairingProvenance': manifest['pairingProvenance'],
        'trainingOverlapEvidence': manifest['trainingOverlapEvidence'],
        'historyProbeScope': history['scope'],
        'historyProbeDeletedGitEvidenceChecked': history['historyProbeDeletedGitEvidenceChecked'],
        'historyProbeSummary': {k: history[k] for k in ('gitReachableCommitCount', 'gitHistoricalBlobCount',
            'gitHistoricalBytesScanned', 'currentFilesScanned', 'currentBytesScanned', 'historyCompleteness')},
        'historyProbeLimitation': 'All reachable repository refs and scoped project files, not unreachable/pruned or external execution. Future audio byte duplicate check pending acquisition.',
        'sourceDiscoveryFreezeCommit': proof['freezeCommit'],
        'sourceDiscoveryFreezeSha256': proof['freezeSha256'],
        'remoteVerifiedAt': proof['remoteVerifiedAt'], 'midiParseStartedAt': result['midiParseStartedAt'],
        'remoteProofProspective': proof['remoteVerifiedAt'] < result['midiParseStartedAt'],
        'batikMidiFileCount': result['batikMidiFileCount'],
        'batikMidiShaManifest': result['batikMidiShaManifest'],
        'batikTopologyCounts': result['batikTopologyCounts'],
        'batikDiagnosticOnlyCounts': result['batikDiagnosticOnlyCounts'],
        'selectedGapFillCases': result['selectedGapFillCases'],
        'remainingMandatoryFamilies': result['remainingMandatoryFamilies'],
        'audioDownloaded': False, 'audioPcmDecoded': False, 'newNeuralRuns': 0, 'RobustSessionRuns': 0,
        'primaryQualificationFreeze': 'NOT_CREATED',
        'ContinuousRegression': {'engineering': 'NOT_STARTED', 'musicalReplay': 'NOT_STARTED',
                                 'controllerReplay': 'NOT_STARTED', 'semanticParity': 'NOT_STARTED'},
        'StageA': 'NOT_STARTED', 'StageB': 'NOT_STARTED',
        'safetyCounters': 'NOT_MEASURED', 'usabilityMetrics': 'NOT_MEASURED',
        'HMs': 50, 'HStatus': 'CANDIDATE_NOT_QUALIFIED',
        'frozenFileChanges': changed,
        'focusedTests': read(OUT / 'focused-tests-review.json'),
        'capabilities': {'Continuous': 'MODEL_NOT_VALIDATED', 'STEP': 'ATTEMPT_ANALYZER_NOT_VALIDATED',
                         'productionMicrophone': False, 'D4': False},
        'githubStatusAuthority': 'github-receipt.json at evidence commit plus independent final-head-github.json query after receipt push; local tests are not CI',
        'disposition': result['disposition'],
        'nextAllowedPhase': 'INDEPENDENT_AUDIT_THEN_SEPARATELY_AUTHORIZED_AUDIO_SOURCE_CODEC_PCM_PROVENANCE_PROTOCOL' if not result['remainingMandatoryFamilies']
            else 'INDEPENDENT_AUDIT_THEN_USER_AUTHORIZATION_REQUIRED_FOR_ANOTHER_TRUTH_SOURCE_NO_DATASET_SHOPPING',
        'limitations': ['Metadata opportunities are not causal READY/BUSY or acoustic success.',
            'MIDI end-of-track is symbolic extent, not measured audio duration.',
            'Audio SHA256, alignment, codec PCM identity and exact input preservation not measured.',
            'No model-independent absence-from-training proof; only no documented overlap in inspected declaration.',
            'No universal strike safety, microphone/hardware, UX SLO or commercial qualification.']}
    save(OUT / 'assessment.json', value)
    print({'disposition': value['disposition'], 'remainingMandatoryFamilies': value['remainingMandatoryFamilies']})


def receipt():
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head != remote or protected_diff():
        raise ValueError('REMOTE_OR_PROTECTED_DIFF_MISMATCH')
    value = {'evidenceCommit': head, 'remoteHead': remote, 'startingRemoteHead': START,
             'completeCommitChain': chain(), 'productionDiff': '', 'v3HistoricalDiff': '',
             'github': github_snapshot(head), 'disposition': read(OUT / 'assessment.json')['disposition']}
    save(OUT / 'github-receipt.json', value)
    print(value['github'])


def final():
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head != remote or protected_diff() or git('status', '--porcelain'):
        raise ValueError('FINAL_REMOTE_DIFF_OR_WORKTREE_MISMATCH')
    github = github_snapshot(head)
    value = read(OUT / 'assessment.json') | {'endingRemoteHead': remote, 'finalHead': head,
            'completeCommitChain': chain(), 'worktreeClean': True, 'github': github,
            'finalRemoteVerifiedAt': datetime.now(timezone.utc).isoformat()}
    save(WORK / 'final-report.json', value)
    save(WORK / 'final-head-github.json', github)
    print({'finalHead': head, 'endingRemoteHead': remote, 'github': github,
           'finalReport': (WORK / 'final-report.json').relative_to(ROOT).as_posix()})


if __name__ == '__main__':
    {'assessment': assessment, 'receipt': receipt, 'final': final}[sys.argv[1]]()
