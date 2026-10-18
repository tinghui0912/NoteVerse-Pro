"""Post-execution remote receipt; hashes outputs without opening H50 truth."""
import sys
import protocol as p
from pathlib import Path


def verify_evidence():
    p.primary_integrity()
    p.api.subprocess.run(['git','fetch','origin','codex/customer-web-delivery-boundary'],cwd=p.ROOT,check=True)
    head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote: raise ValueError('REMOTE_EVIDENCE_MISMATCH')
    summary=p.read(p.OUT/'assessment.json')
    seal_file=p.OUT/'stage-a/acoustic-seal.json'
    receipt={'evidenceCommit':head,'remoteHead':remote,'remoteVerifiedAt':p.now(),'primaryFreezeIntegrity':p.primary_integrity(),
        'disposition':summary['disposition'],'acousticSealCommit':'NOT_CREATED','acousticSealSha256':'NOT_CREATED',
        'acousticOutputSha256':'NOT_CREATED','StageB':'NOT_STARTED','truthOpened':False}
    if seal_file.exists():
        seal=p.read(seal_file);data=(p.ROOT/seal['acousticFile']).read_bytes()
        if p.digest(data)!=seal['acousticSha256']: raise ValueError('REMOTE_ACOUSTIC_SEAL_CHANGED')
        for file in (seal_file,p.ROOT/seal['acousticFile']):
            raw=p.api.subprocess.check_output(['git','show',head+':'+file.relative_to(p.ROOT).as_posix()],cwd=p.ROOT)
            if p.digest(raw)!=p.digest(file.read_bytes()): raise ValueError('REMOTE_SEAL_EXACT_BYTES_MISMATCH')
        receipt|={'acousticSealCommit':head,'acousticSealSha256':p.digest(seal_file.read_bytes()),'acousticOutputSha256':p.digest(data),'acousticSealRemoteVerifiedAt':p.now()}
    p.save(p.OUT/'evidence-remote-proof.json',receipt);print(receipt)


def final():
    primary=p.primary_integrity();head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or p.git('status','--porcelain'): raise ValueError('FINAL_REMOTE_OR_WORKTREE_FAILURE')
    value=p.read(p.OUT/'assessment.json')|p.read(p.OUT/'evidence-remote-proof.json')
    value|={'endingRemoteHead':head,'completeCommitChain':p.git('log','--reverse','--format=%H %s',p.START+'..HEAD').splitlines(),
        'primaryFreezeIntegrity':primary,'github':p.api.github(head),'worktreeClean':True}
    p.save(p.WORK/'final-report.json',value)
    print({'finalHead':head,'disposition':value['disposition'],'github':value['github']})


if __name__=='__main__': {'verify':verify_evidence,'final':final}[sys.argv[1]]()
