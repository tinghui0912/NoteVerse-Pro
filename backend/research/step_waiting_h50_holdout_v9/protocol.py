"""V9 metadata/provenance operations. No audio, browser or inference execution."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'step_waiting_h50_holdout_v8'))
import protocol as audit
import json
import subprocess

ROOT=audit.ROOT
HERE=Path(__file__).resolve().parent
OUT=ROOT/'backend/research/reports/step_waiting_h50_holdout_v9'
WORK=ROOT/'backend/data/work/step_waiting_h50_holdout_v9'
START='c5f7dfa5457eff141e74fefcb9f22db920e37d48'
V6='backend/research/reports/step_waiting_h50_holdout_v6/'
V8='backend/research/reports/step_waiting_h50_holdout_v8/'
TRUTH={
 'cases':(V6+'audio-bound-cases.json','745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e'),
 'scenarios':(V6+'scenario-manifest.json','fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55'),
 'mapping':(V6+'input-preservation.json','27d80f956f207366f3739d8277f559f98b7ba85f4f51df7a75b7dd57da2e2c51'),
 'scorer':('backend/research/step_waiting_h50_holdout_v3/scorer-contract.json','b0691e5b8b03a550fd7a869328ffba83107587753a5951d8ae48aa89d9860ddd')}
PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app']+[f'backend/research/{p}step_waiting_h50_holdout_v{n}' for n in range(3,9) for p in ('','reports/')]


def own(name):return json.loads((OUT/name).read_text(encoding='utf-8'))
def save(name,value):audit.save(OUT/name,value)
def unchanged():
    if audit.git('diff','--name-only',START,'--',*PROTECTED):raise ValueError('PRODUCTION_OR_IMMUTABLE_HISTORY_MUTATED')


def identities():
    unchanged();value=audit.identities()
    freeze=json.loads(audit.raw(V8+'worker-taxonomy-freeze.json'))
    if freeze['freezeCanonicalSha256']!='ef8524f3575dcd59d7582ff3e4696e4db90a16ea3545f8ae5f41851df573bb4e':raise ValueError('V8_TAXONOMY_SHA_MISMATCH')
    audit.verify_files(freeze)
    seal_path=V8+'downstream-eligibility-seal.json'
    seal_bytes=audit.raw(seal_path)
    if audit.digest(seal_bytes)!='7256b87d1716cc4eab27e90e0b7746cff138d10acad281dc90ad574d43cc798c':raise ValueError('V8_DOWNSTREAM_SEAL_SHA_MISMATCH')
    if subprocess.check_output(['git','show','80574f39c6608503a478ee7d8488181ada891408:'+seal_path],executable=audit.GIT_EXE,cwd=ROOT)!=seal_bytes:raise ValueError('V8_EVIDENCE_COMMIT_MISMATCH')
    seal=json.loads(seal_bytes)
    if seal['status']!='SEALED_BLIND_STAGE_A_OUTPUT_ELIGIBLE_FOR_FROZEN_STAGE_B_AFTER_ACCOUNTING_ADJUDICATION':raise ValueError('DOWNSTREAM_NOT_ELIGIBLE')
    for commit in ('39b137850103d2226376a170a60155e55250b823','80574f39c6608503a478ee7d8488181ada891408'):
        if audit.git('merge-base',commit,'HEAD')!=commit:raise ValueError('V8_COMMIT_NOT_ANCESTOR')
    for path,sha in TRUTH.values():
        if audit.digest(audit.raw(path))!=sha:raise ValueError('FROZEN_TRUTH_IDENTITY_MISMATCH')
    return value|{'v8TaxonomyFreezeSha256':freeze['freezeCanonicalSha256'],'v8DownstreamSealSha256':audit.digest(seal_bytes),'truthBindingHashesVerified':len(TRUTH)}


def setup():
    head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=START or remote!=START:raise ValueError('STARTING_GATE_MISMATCH')
    save('starting-gate.json',{'localHead':head,'remoteHead':remote,'mergeBase':audit.git('merge-base',head,remote),'ahead':0,'behind':0,
        'completeCommitChain':[],'productionDiff':[],'github':audit.github(head),'recordedAt':audit.now()})
    save('accepted-identities.json',identities())
    save('truth-opening-boundary.json',{'truthOpenedAt':audit.now(),'authority':'v8 downstream eligibility seal verified before opening frozen v6 truth',
        'truthFiles':[{'path':p,'sha256':s} for p,s in TRUTH.values()], 'acousticPayloadOpened':False,'newNeuralRuns':0})
    # Only the explicitly authorized frozen truth owners are opened here.
    values={key:json.loads(audit.raw(path)) for key,(path,_) in TRUTH.items()}
    print({key:{'type':type(v).__name__,'keys':list(v) if isinstance(v,dict) else None} for key,v in values.items()})


def verify_files(value):
    full=dict(value);claimed=full.pop('freezeCanonicalSha256')
    if audit.digest(audit.canonical(full))!=claimed:raise ValueError('EVALUATION_FREEZE_CANONICAL_MISMATCH')
    for row in value['files']:
        if audit.digest(audit.raw(row['path']))!=row['sha256']:raise ValueError('EVALUATION_FROZEN_FILE_CHANGED:'+row['path'])


def freeze():
    identities()
    if audit.git('status','--porcelain'):raise ValueError('COMMIT_TOOLING_BEFORE_FREEZE')
    if own('synthetic-tests.json')['failed'] or (OUT/'acoustic-payload-opening.json').exists():raise ValueError('NOT_PROSPECTIVE_OR_TESTS_FAILED')
    paths=audit.git('ls-files','--',audit.local(HERE),audit.local(OUT)).splitlines()
    paths+=list(audit.SOURCES.values())+[p for p,_ in TRUTH.values()]+[audit.ACOUSTIC,audit.SEAL,
        V6+'primary-acoustic-qualification-freeze.json',audit.V7+'execution-protocol-freeze.json',
        V8+'worker-taxonomy-freeze.json',V8+'downstream-eligibility-seal.json',V8+'downstream-remote-proof.json',
        'backend/research/step_waiting_topology_v3/assembly.ts','backend/research/step_waiting_h50_holdout_v7/source-execution.ts',
        'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json',
        'apps/customer-web/public/model-assets/practice-acoustic/fir-160-441.f32',
        'apps/customer-web/public/model-assets/practice-acoustic/fir-1-3.f32']
    graphs=json.loads((WORK/'bundle-graphs.json').read_text())
    for graph in graphs:paths+=graph['inputs']
    paths += [audit.local(WORK/(name+'.mjs')) for name in ('prepare','tests','evaluate')]+[audit.local(WORK/'bundle-graphs.json')]
    paths += audit.git('ls-files','--','backend/research/step_waiting_h50_holdout_v8').splitlines()
    value={'role':'STAGE_B_EVALUATION_PROTOCOL_FREEZE','startingRemoteHead':START,'implementationCommit':audit.git('rev-parse','HEAD'),
        'createdAt':audit.now(),'pathSchema':'REPO_RELATIVE_POSIX_V1','HMs':50,'capacity':1,
        'acceptedIdentities':own('accepted-identities.json'),'truthOpenedAt':own('truth-opening-boundary.json')['truthOpenedAt'],
        'acousticPublicationPayloadOpened':False,'newNeuralRuns':0,'StageB':'NOT_STARTED','executionPolicy':'ONE_EXECUTION_NO_TUNING_NO_RERUN',
        'files':[{'path':audit.portable(p),'sha256':audit.digest(audit.raw(p))} for p in sorted(set(paths))]}
    value['freezeCanonicalSha256']=audit.digest(audit.canonical(value));save('evaluation-protocol-freeze.json',value)
    print({'freezeCanonicalSha256':value['freezeCanonicalSha256'],'files':len(value['files'])})


def remote():
    subprocess.check_output(['git','fetch','origin','codex/customer-web-delivery-boundary'],executable=audit.GIT_EXE,cwd=ROOT)
    value=own('evaluation-protocol-freeze.json');verify_files(value);identities()
    commit=audit.git('log','-1','--format=%H','--',audit.local(OUT/'evaluation-protocol-freeze.json'))
    head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=commit or remote!=commit:raise ValueError('REMOTE_EVALUATION_FREEZE_MISMATCH')
    proof={'freezeCommit':commit,'remoteHead':remote,'freezeSha256':value['freezeCanonicalSha256'],
        'freezeFileSha256':audit.digest(audit.raw(audit.local(OUT/'evaluation-protocol-freeze.json'))),
        'evaluationRemoteVerifiedAt':audit.now(),'acousticPublicationPayloadOpened':False,'newNeuralRuns':0}
    save('evaluation-remote-proof.json',proof);print(proof)


def final_report():
    identities();verify_files(own('evaluation-protocol-freeze.json'))
    head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote:raise ValueError('FINAL_REMOTE_MISMATCH')
    result=own('stage-b-results.json') if (OUT/'stage-b-results.json').exists() else own('stage-b-execution-failure.json')
    boundaries=own('acoustic-payload-opening.json') if (OUT/'acoustic-payload-opening.json').exists() else {'acousticPayloadOpenedAt':None}
    value=result|{'startingRemoteHead':START,'endingRemoteHead':remote,
        'completeCommitChain':audit.git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),
        'productionDiff':[],'historicalDiffs':{f'v{n}':[] for n in range(3,9)},'allAcceptedIdentities':own('accepted-identities.json'),
        'upstreamFreezeSealIdentities':json.loads((HERE/'evaluation-contract.json').read_text())['upstreamIdentities'],
        'evaluationFreeze':own('evaluation-remote-proof.json'),'truthOpenedAt':own('truth-opening-boundary.json')['truthOpenedAt'],
        'openingBoundary':boundaries,'syntheticTests':own('synthetic-tests.json'),'github':audit.github(head),
        'v7OriginalDisposition':'STEP_WAITING_H50_STAGE_A_ACOUSTIC_EXECUTION_BLOCKED','originalV7GateOutcome':'FAIL',
        'acousticOutputUnchanged':True,'finalVerifiedAt':audit.now()}
    save('evidence-receipt.json',value);print({'head':head,'disposition':value['disposition'],'github':value['github']})


def final_head():
    identities();verify_files(own('evaluation-protocol-freeze.json'))
    head=audit.git('rev-parse','HEAD');remote=audit.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or audit.git('status','--porcelain'):raise ValueError('FINAL_REMOTE_OR_WORKTREE_MISMATCH')
    value=own('evidence-receipt.json')|{'endingRemoteHead':remote,'github':audit.github(head),
        'completeCommitChain':audit.git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),'finalVerifiedAt':audit.now()}
    audit.save(WORK/'final-report.json',value);print({'head':head,'disposition':value['disposition'],'github':value['github']})


if __name__=='__main__':{'setup':setup,'verify':identities,'freeze':freeze,'remote':remote,'receipt':final_report,'final':final_head}[sys.argv[1]]()
