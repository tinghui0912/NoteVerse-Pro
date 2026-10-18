"""Portable v6 freeze ownership; old evidence is read-only, never normalized."""
import json
import subprocess
import sys
from urllib.request import Request, urlopen
from contracts import *
from portable import SCHEMA, repo_relative_posix, validate_portable_freeze_manifest

V5 = ROOT / 'backend/research/reports/step_waiting_h50_holdout_v5'
V5_TOOLS = ROOT / 'backend/research/step_waiting_h50_holdout_v5'

def credentials():
    text = subprocess.check_output(['git', 'credential', 'fill'], cwd=ROOT, input='protocol=https\nhost=github.com\n\n', text=True)
    return next(line[9:] for line in text.splitlines() if line.startswith('password='))


def fetch(url, limit=50_000_000, api=False):
    headers = {'User-Agent': 'NoteVerse-DSP-only-preparation'}
    if api: headers |= {'Authorization': 'Bearer ' + credentials(), 'Accept': 'application/vnd.github+json'}
    with urlopen(Request(url, headers=headers), timeout=120) as response: data = response.read(limit + 1)
    if len(data) > limit: raise ValueError('DOWNLOAD_SIZE_LIMIT')
    return data


def github(head):
    base = 'https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'
    combined = json.loads(fetch(base + 'commits/' + head + '/status', api=True))
    statuses = json.loads(fetch(base + 'commits/' + head + '/statuses?per_page=100', api=True))
    runs = json.loads(fetch(base + 'actions/runs?head_sha=' + head + '&per_page=100', api=True))
    return {'queriedAt': now(), 'head': head, 'combinedState': combined['state'], 'statuses': statuses,
            'workflow_runs': runs['workflow_runs'], 'workflowRunTotalCount': runs['total_count'],
            'ciInterpretation': 'NOT CI PASS' if combined['state'] == 'pending' and not statuses and not runs['total_count'] else 'ACTUAL_GITHUB_RESULTS_ONLY_NOT_LOCAL_CI'}



def verified_audio():
    old = read(V5 / 'audio-acquisition.json')
    for row in old['objects']:
        path = repo_relative_posix(row['localPath'])
        data = (ROOT / path).read_bytes()
        if len(data) != row['bytes'] or digest(data) != row['audioSha256'] or object_sha(data) != row['actualGitBlobSha1']:
            raise ValueError('SELECTED_MP3_IDENTITY_MISMATCH')
        check_object(row['recordingId'], row['path'], data)
    if len(old['objects']) != 4: raise ValueError('SELECTED_AUDIO_COUNT_CHANGED')
    return old


def unchanged():
    if git('diff', '--name-only', START, '--', *PROTECTED):
        raise ValueError('PRODUCTION_OR_HISTORY_MUTATED')


def audit_intended_diff():
    checks = []
    for name in ('decode.py','prepare.py','scenarios.py','dsp.ts','node-tests.ts','node-tests.mjs','run_tests.py','test_contracts.py'):
        before = (V5_TOOLS / name).read_text(encoding='utf-8').replace('step_waiting_h50_holdout_v5','step_waiting_h50_holdout_v6')
        if name=='run_tests.py': before=before.replace("'testFiles':1", "'testFiles':2")
        after = (HERE / name).read_text(encoding='utf-8')
        if before != after: raise ValueError('UNAUTHORIZED_SEMANTIC_DIFF:' + name)
        checks.append({'path':repo_relative_posix(HERE / name),'source':repo_relative_posix(V5_TOOLS / name),'permittedChange':'output/work phase path only; identical algorithm'})
    for name in ('decoder-contract.json','input-preservation-contract.json'):
        if (HERE / name).read_bytes() != (V5_TOOLS / name).read_bytes(): raise ValueError('FROZEN_CONTRACT_CHANGED')
    return checks


def setup():
    if git('rev-parse','HEAD') != START or git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0] != START:
        raise ValueError('STARTING_HEAD_MISMATCH')
    unchanged(); verify_dependencies()
    if digest((V4/'truth-topology-seal.json').read_bytes()) != '6023fc0cdb5a9bf36769b5f33a4ff1fce8ce220f9d968516bfaf6cfb5f32ee18':
        raise ValueError('V4_SEAL_CHANGED')
    old = verified_audio()
    WORK.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    save(OUT/'starting-gate.json',{'localHead':START,'remoteHead':START,'mergeBase':git('merge-base','HEAD',START),
        'ahead':0,'behind':0,'completeCommitChain':[],'productionDiff':'','github':github(START)})
    for name in ('selected-truth-and-sources.json','publisher-sync-evidence.json','decoder-environment.json'):
        save(OUT/name, read(V5/name))
    save(OUT/'audio-acquisition.json', old | {'v6ExactByteReverifiedAt':now(),'newAudioDownloaded':False,
        'reuseAuthority':'Immutable v5 exact acquisition; no new selection or download'})
    checks=audit_intended_diff()
    save(OUT/'v5-to-v6-intended-diff.json',{'allowedDifferences':['starting HEAD','v6 outputs/work','portable path generation and validation',
        'dual predecode preflight','binding immutable v5 acquisition and historical evidence','v6 freeze and receipts','new portability tests and accurate test-file count'],
        'unchangedSemantics':['decoder byte contract','input-preservation byte contract','H50','all truth selection','all DSP algorithms','all scenarios/scorer'],
        'mechanicallyVerifiedUnchangedAlgorithms':checks,
        'newOwners':['portable.py strict path helper/validator','preflight.py raw byte verification only','protocol.py v6 freeze',
            'contracts.py v6 gate; exposure.py allows accepted v5 acquisition identities; input-preservation.mjs new freeze/gate only'],
        'v5Immutable':True,'newNeuralRuns':0})
    print({'audioObjectsReverified':4,'downloaded':False,'HMs':50})


def freeze(mode):
    if git('status','--porcelain'): raise ValueError('CLEAN_COMMITTED_TREE_REQUIRED')
    unchanged(); audit_intended_diff(); verified_audio()
    if mode == 'predecode':
        if read(OUT/'focused-tests.json')['failed'] or read(OUT/'focused-tests.json')['errors'] or read(OUT/'node-tests.json')['failed']:
            raise ValueError('UNIT_TESTS_FAILED')
    else:
        require_protocol()
        if not read(OUT/'exact-byte-exposure-audit.json')['eligible']: raise ValueError('EXPOSURE_NOT_CLEAR')
        if read(OUT/'actual-audio-context.json')['invalidCases']: raise ValueError('REAL_CONTEXT_INVALID')
        inputs=read(OUT/'input-preservation.json')
        if inputs['totalCases']!=9 or inputs['totalRateJobs']!=18 or inputs['mismatches']: raise ValueError('INPUT_PARITY_GATE_FAILED')
        if read(OUT/'scenario-manifest.json')['totalScenarios']!=20: raise ValueError('SCENARIO_DRIFT')
    prefixes=[repo_relative_posix(HERE),repo_relative_posix(OUT)]
    prefixes += [p for p in PROTECTED if 'step_waiting_h50_holdout_' in p]
    prefixes += ['apps/customer-web/src/lib/practice/acoustic','apps/customer-web/public/model-assets/practice-acoustic']
    paths=git('ls-files','--',*prefixes).splitlines()
    selected=read(V5/'selected-truth-and-sources.json')
    paths += [r['localPath'] for r in verified_audio()['objects']]
    paths += [r['audio']['path'] for r in selected['sources'].values() if r['dataset']=='vienna-4x22']
    if mode == 'primary':
        paths += [r['pcmPath'] for r in read(OUT/'decoded-audio.json')['sources'].values()]
        trials=read(OUT/'source-rate-trials.json')
        paths += [r['path'] for r in trials['sourceTrials'].values()]
        paths += [r['clipPath'] for r in trials['jobs']]
        paths += [repo_relative_posix(WORK/'audio_only/jobs.json')]
    entries=[{'path':repo_relative_posix(p),'sha256':digest((ROOT/p).read_bytes())} for p in sorted(set(paths))]
    bindings={}
    for label,p in {
        'v3SelectorFreeze':ROOT/'backend/research/reports/step_waiting_h50_holdout_v3/selector-freeze.json',
        'v3Scorer':ROOT/'backend/research/step_waiting_h50_holdout_v3/scorer-contract.json',
        'v4TruthTopologySeal':V4/'truth-topology-seal.json',
        'v5BlockedAssessment':V5/'blocked-assessment.json','v5OldAcquisitionFreeze':V5/'audio-acquisition-protocol-freeze.json',
        'v5Acquisition':V5/'audio-acquisition.json','v5Exposure':V5/'exact-byte-exposure-audit.json',
        'v5Publisher':V5/'publisher-sync-evidence.json','decoderContract':V5_TOOLS/'decoder-contract.json',
        'inputPreservationContract':V5_TOOLS/'input-preservation-contract.json'}.items():
        bindings[label]={'path':repo_relative_posix(p),'sha256':digest(p.read_bytes())}
    value={'role':'PORTABLE_PREDECODE_PROTOCOL_FREEZE' if mode=='predecode' else 'PRIMARY_ACOUSTIC_QUALIFICATION_FREEZE',
        'pathSchema':SCHEMA,'startingHead':START,'implementationCommit':git('rev-parse','HEAD'),'files':entries,
        'bindings':bindings,'selectedAudioObjects':verified_audio()['objects'],'HMs':50,'newNeuralRuns':0,'RobustSessionRuns':0}
    value['freezeCanonicalSha256']=digest(canonical(value))
    count=validate_portable_freeze_manifest(value)
    save(OUT/('portable-predecode-protocol-freeze.json' if mode=='predecode' else 'primary-acoustic-qualification-freeze.json'),value)
    print({'files':count,'freezeSha256':value['freezeCanonicalSha256']})


def verify(mode):
    name='portable-predecode-protocol-freeze.json' if mode=='predecode' else 'primary-acoustic-qualification-freeze.json'
    file=OUT/name; value=read(file); validate_portable_freeze_manifest(value)
    subprocess.run(['git','fetch','origin','codex/customer-web-delivery-boundary'],cwd=ROOT,check=True)
    remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    commit=git('log','-1','--format=%H','--',repo_relative_posix(file))
    if remote != commit or git('rev-parse','HEAD') != commit: raise ValueError('REMOTE_FREEZE_MISMATCH_STOP')
    unchanged()
    proof={'freezeCommit':commit,'remoteHead':remote,'freezeSha256':value['freezeCanonicalSha256'],
        'remoteVerifiedAt':now(),'pathSchema':SCHEMA,'newNeuralRuns':0,'RobustSessionRuns':0}
    save(OUT/('portable-predecode-remote-proof.json' if mode=='predecode' else 'primary-freeze-remote-proof.json'),proof)
    print(proof)


if __name__=='__main__':
    if sys.argv[1]=='setup': setup()
    elif sys.argv[1]=='freeze': freeze(sys.argv[2])
    elif sys.argv[1]=='verify': verify(sys.argv[2])
