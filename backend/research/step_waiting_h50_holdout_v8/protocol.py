import security
from pathlib import Path, PurePosixPath, PureWindowsPath
from datetime import datetime, timezone
from hashlib import sha256
import json
import subprocess
import sys
import re
import shutil
from urllib.request import Request, urlopen
from projection import Projection
from taxonomy import classify

ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'backend/research/reports/step_waiting_h50_holdout_v8'
START='888b957864b704a3536a1dd10235e188a46ac6fe'
PRIMARY='570114cbe1f11983d6b07956078b4a655275b976'
PRIMARY_SHA='4a0264d06939fab1c12f1199be1903bc089cbe9fa0f0bf06f1456c4faf298b57'
EXECUTION='9406d68acab9f4f66aac6d38feb7473aeecc5ac1'
EXECUTION_SHA='86d3b68d2a0dd405769e4cd2317fa8b70d6a42247de99d37ca1ad0c55d2512ed'
EVIDENCE='5c3f62de73646e81d01ef8b6acbd647cc6d8046a'
V7='backend/research/reports/step_waiting_h50_holdout_v7/'
ACOUSTIC=V7+'stage-a/acoustic.json'
SEAL=V7+'stage-a/acoustic-seal.json'
ACOUSTIC_SHA='61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1'
SEAL_SHA='5ffdb33b8f34791249f40e8c7b6c778b6d93a5f362b305b77120269ceb933f85'
ORT_PATH='apps/customer-web/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs'
ORT_SHA='2fb14505d39926e4c544de8c57fe59a2f2bc74caba6f71890be9afecc5046758'
CANONICAL='apps/customer-web/scripts/qualification/continuous-regression.mjs'
SOURCES={'entry':'backend/research/step_waiting_h50_holdout_v7/entry.ts',
    'worker':'apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts',
    'session':'apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts','canonical':CANONICAL,
    'dry':'backend/research/step_waiting_h50_holdout_v7/dry-runtime.ts',
    'runner':'backend/research/step_waiting_h50_holdout_v7/stage-a-runner.mjs'}
PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app']+[f'backend/research/{p}step_waiting_h50_holdout_v{n}' for n in range(3,8) for p in ('','reports/')]
READS=[]
GIT_EXE=shutil.which('git')


def now(): return datetime.now(timezone.utc).isoformat()
def digest(data): return sha256(data).hexdigest()
def canonical(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def git(*args): return subprocess.check_output(['git',*args],executable=GIT_EXE,cwd=ROOT,text=True).strip()
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8',newline='\n') as file: json.dump(value,file,indent=2,allow_nan=False);file.write('\n')
def portable(value):
    if not isinstance(value,str) or not value or '\\' in value or ':' in value or PureWindowsPath(value).drive or PurePosixPath(value).is_absolute() or any(p in ('','.','..') for p in value.split('/')) or PurePosixPath(value).as_posix()!=value:
        raise ValueError('NONPORTABLE_REPOSITORY_PATH')
    (ROOT/value).resolve().relative_to(ROOT.resolve())
    return value
def raw(path):
    portable(path);READS.append({'path':path,'mode':'RAW_BYTES_ONLY'});return (ROOT/path).read_bytes()
def local(path): return portable(path.relative_to(ROOT).as_posix())


def project(path,schema,post=False):
    portable(path)
    post_files={ACOUSTIC,SEAL,'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json',
        'backend/data/work/step_waiting_h50_holdout_v7/stage-a/bundle-inputs.json',
        'backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json'}
    if path in post_files:
        if not post: raise PermissionError('STAGE_A_METADATA_PROHIBITED_BEFORE_REMOTE_TAXONOMY_FREEZE')
        require_remote()
    allowed=post_files|{V7+'continuous-musical.json',V7+'continuous-gate.json',
        'backend/research/reports/step_waiting_h50_holdout_v6/primary-acoustic-qualification-freeze.json',
        V7+'execution-protocol-freeze.json'}
    if path not in allowed: raise PermissionError('SEMANTIC_FILE_OPEN_DENIED')
    READS.append({'path':path,'mode':'WHITELISTED_METADATA_PROJECTION','schema':schema})
    parser=Projection((ROOT/path).read_text(encoding='utf-8'));value=parser.project(schema)
    return value


def own_json(file):
    file.resolve().relative_to(HERE.resolve()) if file.parent==HERE else file.resolve().relative_to(OUT.resolve())
    READS.append({'path':local(file),'mode':'V8_OWN_AUDIT_METADATA'})
    return json.loads(file.read_text(encoding='utf-8'))


def github(head):
    credential=subprocess.check_output(['git','credential','fill'],executable=GIT_EXE,cwd=ROOT,input='protocol=https\nhost=github.com\n\n',text=True)
    token=next(line[9:] for line in credential.splitlines() if line.startswith('password='))
    base='https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'
    def get(url):
        with urlopen(Request(base+url,headers={'User-Agent':'NoteVerse-audit-only','Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}),timeout=60) as response:return json.load(response)
    combined=get('commits/'+head+'/status');statuses=get('commits/'+head+'/statuses?per_page=100');runs=get('actions/runs?head_sha='+head+'&per_page=100')
    return {'head':head,'queriedAt':now(),'combinedState':combined['state'],'statuses':statuses,'workflow_runs':runs['workflow_runs'],
        'workflowRunTotalCount':runs['total_count'],'ciInterpretation':'NOT CI PASS' if combined['state']=='pending' and not statuses and not runs['total_count'] else 'ACTUAL_GITHUB_RESULTS_ONLY'}


def unchanged():
    if git('diff','--name-only',START,'--',*PROTECTED):raise ValueError('IMMUTABLE_HISTORY_OR_PRODUCTION_CHANGED')


def verify_manifest(path,expected):
    # Freeze metadata is allowed; all bound truth/audio assets are raw-hashed only.
    value=project(path,{'freezeCanonicalSha256':True,'files':[{'path':True,'sha256':True}]})
    full=json.loads(raw(path))
    claimed=full.pop('freezeCanonicalSha256')
    if claimed!=expected or digest(canonical(full))!=claimed:raise ValueError('ACCEPTED_FREEZE_IDENTITY_MISMATCH')
    for row in value['files']:
        if digest(raw(row['path']))!=row['sha256']:raise ValueError('FROZEN_INPUT_HASH_MISMATCH:'+row['path'])
    return value


def identities():
    unchanged()
    for commit in (PRIMARY,EXECUTION,EVIDENCE):
        if git('merge-base',commit,'HEAD')!=commit:raise ValueError('ACCEPTED_COMMIT_NOT_ANCESTOR')
    primary=verify_manifest('backend/research/reports/step_waiting_h50_holdout_v6/primary-acoustic-qualification-freeze.json',PRIMARY_SHA)
    execution=verify_manifest(V7+'execution-protocol-freeze.json',EXECUTION_SHA)
    for path,expected in ((ACOUSTIC,ACOUSTIC_SHA),(SEAL,SEAL_SHA),(ORT_PATH,ORT_SHA)):
        if digest(raw(path))!=expected:raise ValueError('STEP_WAITING_H50_STAGE_A_SEAL_INTEGRITY_FAILURE')
    for path in (ACOUSTIC,SEAL):
        committed=subprocess.check_output(['git','show',EVIDENCE+':'+path],executable=GIT_EXE,cwd=ROOT)
        if digest(committed)!=digest(raw(path)):raise ValueError('EVIDENCE_COMMIT_EXACT_BYTES_MISMATCH')
    return {'primaryFiles':len(primary['files']),'executionFiles':len(execution['files']),'hashMismatches':0,
        'v7AcousticOutputSha256':ACOUSTIC_SHA,'v7AcousticSealSha256':SEAL_SHA,'v7EvidenceCommit':EVIDENCE}


def static_architecture():
    texts={key:raw(path).decode('utf-8') for key,path in SOURCES.items()}
    patterns={'productWorkerConstructionSites':('entry',r"new Worker\('/worker\.js'"),
        'productWorkerWrapperSites':('entry',r'new AcousticModelWorker\(native\)'),
        'acousticModelSessionOwners':('worker',r'new AcousticModelSession\(\)'),
        'inferenceSessionCreateSites':('session',r'ort\.InferenceSession\.create\(')}
    counts={key:len(re.findall(pattern,texts[source])) for key,(source,pattern) in patterns.items()}
    if any(n!=1 for n in counts.values()):raise ValueError('STATIC_OWNERSHIP_ARCHITECTURE_NOT_ESTABLISHED')
    if 'private session: ort.InferenceSession | null' not in texts['session'] or 'this.loads++' not in texts['session']:raise ValueError('SESSION_OWNERSHIP_SOURCE_DRIFT')
    existing="rows.some(r => r.type === 'worker-created' && r.url.endsWith('/worker.js'))"
    if existing not in texts['canonical']:raise ValueError('CANONICAL_WORKER_PRESENCE_GATE_NOT_FOUND')
    if 'workers!==1' not in texts['runner']:raise ValueError('V7_RAW_CARDINALITY_GATE_NOT_FOUND')
    if 'assert.throws(()=>owner.worker())' not in texts['dry'] or 'assert.throws(()=>owner.session())' not in texts['dry']:raise ValueError('V7_PRODUCT_OWNERSHIP_TEST_NOT_FOUND')
    return counts|{'sources':{k:{'path':v,'sha256':digest(raw(v))} for k,v in SOURCES.items()},
        'canonicalRequirement':'At least one observed production /worker.js, not total page Worker count == 1',
        'v7TestGap':'QUALIFICATION_HARNESS_WORKER_TAXONOMY_TEST_GAP',
        'v7TestGapDescription':'Dry RunOwnership tests cover second product Worker/session; no raw browser event versus product/ORT taxonomy test existed.'}


def continuous_witness():
    value=project(V7+'continuous-musical.json',{'status':True,'countComplete':True,'actualModelRuns':True,
        'results':[{'id':True,'rate':True,'actualModelRuns':True,'status':True}],
        'diagnostics':[{'id':True,'rate':True,'type':True,'url':True}]})
    gate=project(V7+'continuous-gate.json',{'status':True,'engineeringPass':True,'musicalPass':True,'productionControllerPass':True,'semanticDiffs':[True]})
    cells=[]
    for cell in value['results']:
        urls=[d['url'] for d in value['diagnostics'] if d.get('type')=='worker-created' and d.get('id')==cell['id'] and d.get('rate')==cell['rate']]
        counts=classify(urls);cells.append(cell|counts)
    if len(cells)!=8 or any(c['product']!=1 or c['ort']!=3 or c['unexpected'] for c in cells) or gate!={'status':'PASS','engineeringPass':8,'musicalPass':8,'productionControllerPass':'PASS','semanticDiffs':[]}:
        save(OUT/'continuous-topology-failure.json',{'cells':cells,'gate':gate,'disposition':'STEP_WAITING_H50_WORKER_TAXONOMY_NOT_INDEPENDENTLY_SUPPORTED'})
        raise ValueError('STEP_WAITING_H50_WORKER_TAXONOMY_NOT_INDEPENDENTLY_SUPPORTED')
    return {'cellsChecked':8,'cellsWithExactlyOneProductWorker':8,'cellsWithUnexpectedWorkers':0,
        'observedOrtRuntimeWorkerCounts':[c['ort'] for c in cells],'unexpectedWorkers':0,'continuousGateStatus':gate['status'],
        'musicalPass':gate['musicalPass'],'productionControllerPass':gate['productionControllerPass'],'semanticDiffs':gate['semanticDiffs'],
        'cells':cells,'requirementScope':'The 3-per-cell ORT count is an observation in immutable evidence, not a universal runtime cardinality rule.'}


def setup():
    if git('rev-parse','HEAD')!=START or git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]!=START:raise ValueError('STARTING_HEAD_MISMATCH')
    OUT.mkdir(parents=True,exist_ok=True)
    save(OUT/'starting-gate.json',{'localHead':START,'remoteHead':START,'mergeBase':git('merge-base','HEAD',START),'ahead':0,'behind':0,
        'completeCommitChain':[],'productionDiff':'','github':github(START)})
    initial=identities();architecture=static_architecture();witness=continuous_witness()
    save(OUT/'accepted-identities.json',initial);save(OUT/'static-architecture.json',architecture);save(OUT/'continuous-taxonomy-witness.json',witness)
    save(OUT/'pre-freeze-read-ledger.json',{'reads':READS,'stageAAccountingOpened':False,'acousticNotesDecodedOrInspected':False,
        'truthOpened':False,'newNeuralRuns':0,'RobustSessionRuns':0})
    print({'acceptedIdentities':initial,'staticArchitecture':{k:v for k,v in architecture.items() if isinstance(v,int)},'continuousCells':witness['cellsChecked']})


def freeze():
    unchanged()
    if git('status','--porcelain'):raise ValueError('COMMIT_TOOLING_FIRST')
    if own_json(OUT/'synthetic-tests.json')['failed']:raise ValueError('SYNTHETIC_TESTS_FAILED')
    identities();static_architecture();continuous_witness()
    paths=git('ls-files','--',local(HERE),local(OUT)).splitlines()
    paths += list(SOURCES.values())+[ORT_PATH,V7+'execution-contract.json',V7+'execution-protocol-freeze.json',
        V7+'continuous-musical.json',V7+'continuous-gate.json',ACOUSTIC,SEAL,
        'backend/research/reports/step_waiting_h50_holdout_v6/primary-acoustic-qualification-freeze.json',
        'backend/data/work/step_waiting_h50_holdout_v7/stage-a/worker.js',
        'backend/data/work/step_waiting_h50_holdout_v7/stage-a/bundle-inputs.json',
        'backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json',
        'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json']
    value={'role':'WORKER_ACCOUNTING_TAXONOMY_CORRECTION_FREEZE','pathSchema':'REPO_RELATIVE_POSIX_V1','startingHead':START,
        'implementationCommit':git('rev-parse','HEAD'),'createdAt':now(),'files':[{'path':portable(p),'sha256':digest(raw(p))} for p in sorted(set(paths))],
        'taxonomyContractSha256':digest(raw(local(HERE/'worker-taxonomy-contract.json'))),'newNeuralRuns':0,'RobustSessionRuns':0,
        'originalV7GateOutcome':'FAIL','StageB':'NOT_STARTED'}
    value['freezeCanonicalSha256']=digest(canonical(value));save(OUT/'worker-taxonomy-freeze.json',value);print(value['freezeCanonicalSha256'])


def verify_files(value):
    payload=dict(value);claimed=payload.pop('freezeCanonicalSha256')
    if digest(canonical(payload))!=claimed:raise ValueError('TAXONOMY_FREEZE_DIGEST_MISMATCH')
    for row in value['files']:
        if digest(raw(row['path']))!=row['sha256']:raise ValueError('FROZEN_TAXONOMY_FILE_CHANGED')


def verify_remote():
    subprocess.check_output(['git','fetch','origin','codex/customer-web-delivery-boundary'],executable=GIT_EXE,cwd=ROOT)
    value=own_json(OUT/'worker-taxonomy-freeze.json');verify_files(value);unchanged()
    commit=git('log','-1','--format=%H','--',local(OUT/'worker-taxonomy-freeze.json'));remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if commit!=remote or git('rev-parse','HEAD')!=commit:raise ValueError('REMOTE_TAXONOMY_FREEZE_MISMATCH')
    proof={'freezeCommit':commit,'remoteHead':remote,'freezeSha256':value['freezeCanonicalSha256'],'remoteVerifiedAt':now(),
        'newNeuralRuns':0,'RobustSessionRuns':0,'StageB':'NOT_STARTED'}
    save(OUT/'taxonomy-remote-proof.json',proof);print(proof)


def require_remote():
    proof=own_json(OUT/'taxonomy-remote-proof.json');value=own_json(OUT/'worker-taxonomy-freeze.json')
    if proof['remoteHead']!=proof['freezeCommit'] or proof['freezeSha256']!=value['freezeCanonicalSha256'] or not proof['remoteVerifiedAt']<now():raise ValueError('REMOTE_TAXONOMY_PROOF_REQUIRED')
    verify_files(value);unchanged();return proof


if __name__=='__main__': {'setup':setup,'freeze':freeze,'verify':verify_remote}[sys.argv[1]]()
