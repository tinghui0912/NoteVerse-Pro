"""Create/verify the selector-only freeze. Does not read candidate MIDI."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[3]
PHASE_DIR='backend/research/step_waiting_h50_holdout_v3'
REPORT_DIR='backend/research/reports/step_waiting_h50_holdout_v3'
FREEZE=REPORT_DIR+'/selector-freeze.json'


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',', ':'),ensure_ascii=True,allow_nan=False).encode()


def main():
    if sys.argv[1]=='create':
        if git('status','--porcelain'): raise ValueError('UNCOMMITTED_SOURCE')
        files=git('ls-files',PHASE_DIR,REPORT_DIR).splitlines()
        rows=[{'path':p,'sha256':sha256((ROOT/p).read_bytes()).hexdigest()} for p in files]
        value={'role':'TOPOLOGY_SELECTOR_CONTRACT_FREEZE_NOT_ACOUSTIC_FREEZE',
               'implementationCommit':git('rev-parse','HEAD'),'files':rows,
               'protectedTrees':{p:git('rev-parse','HEAD:'+p) for p in ['apps/customer-web/src','apps/customer-web/public','backend/app']},
               'newNeuralRuns':0,'candidateMidiEventsParsed':False}
        value['freezeCanonicalSha256']=sha256(canonical(value)).hexdigest()
        with (ROOT/FREEZE).open('x',encoding='utf-8',newline='\n') as f:
            json.dump(value,f,indent=2);f.write('\n')
        print(json.dumps({'path':FREEZE,'freezeCanonicalSha256':value['freezeCanonicalSha256']}))
    elif sys.argv[1]=='verify':
        value=json.loads((ROOT/FREEZE).read_text(encoding='utf-8'))
        claimed=value.pop('freezeCanonicalSha256')
        if sha256(canonical(value)).hexdigest()!=claimed: raise ValueError('SELECTOR_FREEZE_HASH')
        commit=git('log','-1','--format=%H','--',FREEZE)
        subprocess.run(['git','fetch','origin','codex/customer-web-delivery-boundary'],cwd=ROOT,check=True)
        remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
        if remote!=commit or git('rev-parse','HEAD')!=commit: raise ValueError('REMOTE_SELECTOR_FREEZE_MISMATCH')
        for row in value['files']:
            if sha256((ROOT/row['path']).read_bytes()).hexdigest()!=row['sha256']: raise ValueError('FROZEN_SELECTOR_FILE_CHANGED:'+row['path'])
        if git('diff','--name-only','4a2e2e15c266d4b3bd6f23006cefe59d8e16e313','HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app'):
            raise ValueError('PROTECTED_PRODUCTION_CHANGED')
        proof={'freezeCommit':commit,'remoteHead':remote,'freezeCanonicalSha256':claimed,
               'remoteVerifiedAt':datetime.now(timezone.utc).isoformat(),'candidateMidiEventsParsed':False,
               'role':'SELECTOR_ONLY_PRE_MIDI_REMOTE_PROOF_NOT_ACOUSTIC_QUALIFICATION'}
        time.sleep(.002)
        with (ROOT/REPORT_DIR/'selector-remote-proof.json').open('x',encoding='utf-8',newline='\n') as f:
            json.dump(proof,f,indent=2);f.write('\n')
        print(json.dumps(proof))


if __name__=='__main__': main()
