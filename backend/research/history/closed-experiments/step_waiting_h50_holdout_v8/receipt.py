import security
import subprocess
import sys
import protocol as p


def verify():
    p.identities();p.require_remote()
    subprocess.check_output(['git','fetch','origin','codex/customer-web-delivery-boundary'],executable=p.GIT_EXE,cwd=p.ROOT)
    head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    seal=p.OUT/'downstream-eligibility-seal.json'
    commit=p.git('log','-1','--format=%H','--',p.local(seal))
    if head!=remote or commit!=head:raise ValueError('REMOTE_DOWNSTREAM_SEAL_MISMATCH')
    remote_bytes=subprocess.check_output(['git','show',head+':'+p.local(seal)],executable=p.GIT_EXE,cwd=p.ROOT)
    sha=p.digest(p.raw(p.local(seal)))
    if p.digest(remote_bytes)!=sha:raise ValueError('REMOTE_DOWNSTREAM_SEAL_EXACT_BYTES_MISMATCH')
    value={'downstreamEligibilitySealCommit':head,'remoteHead':remote,'downstreamEligibilitySealSha256':sha,
        'downstreamEligibilityRemoteVerifiedAt':p.now(),'v7AcousticOutputSha256':p.ACOUSTIC_SHA,'v7AcousticSealSha256':p.SEAL_SHA,
        'v7AcousticOutputModified':False,'newNeuralRuns':0,'RobustSessionRuns':0,'StageB':'NOT_STARTED','truthOpened':False}
    p.save(p.OUT/'downstream-remote-proof.json',value);print(value)


def github():
    head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote:raise ValueError('GITHUB_RECEIPT_HEAD_MISMATCH')
    value={'head':head,'completeCommitChain':p.git('log','--reverse','--format=%H %s',p.START+'..HEAD').splitlines(),'github':p.github(head)}
    p.save(p.OUT/'github-receipt.json',value);print(value['github'])


def final():
    p.identities();p.require_remote();p.unchanged()
    head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or p.git('status','--porcelain'):raise ValueError('FINAL_REMOTE_OR_WORKTREE_MISMATCH')
    value=p.own_json(p.OUT/'adjudication.json')|p.own_json(p.OUT/'downstream-remote-proof.json')
    value|={'endingRemoteHead':head,'completeCommitChain':p.git('log','--reverse','--format=%H %s',p.START+'..HEAD').splitlines(),
        'github':p.github(head),'syntheticTests':p.own_json(p.OUT/'synthetic-tests.json'),'worktreeClean':True}
    # This is metadata only; no PCM or model input is generated.
    target=p.ROOT/'backend/data/work/step_waiting_h50_holdout_v8/final-report.json'
    p.save(target,value);print({'endingRemoteHead':head,'disposition':value['disposition'],'github':value['github']})


if __name__=='__main__': {'verify':verify,'github':github,'final':final}[sys.argv[1]]()
