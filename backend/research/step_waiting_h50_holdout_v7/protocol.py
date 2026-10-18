"""Outer byte-integrity and remote proofs. Never runs or scores H50 audio."""
import sys
from pathlib import Path
import importlib.util
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'step_waiting_h50_holdout_v6'))
from contracts import ROOT, digest, canonical, read, save, git, now
from portable import validate_portable_freeze_manifest, repo_relative_posix
spec=importlib.util.spec_from_file_location('immutable_v6_metadata_api',Path(__file__).resolve().parents[1]/'step_waiting_h50_holdout_v6/protocol.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
HERE=Path(__file__).resolve().parent
OUT=ROOT/'backend/research/reports/step_waiting_h50_holdout_v7'
WORK=ROOT/'backend/data/work/step_waiting_h50_holdout_v7'
V6=ROOT/'backend/research/reports/step_waiting_h50_holdout_v6'
START='44c464e6d26631d777941eff52f1bef55fad2a3f'
PRIMARY='570114cbe1f11983d6b07956078b4a655275b976'
PRIMARY_SHA='4a0264d06939fab1c12f1199be1903bc089cbe9fa0f0bf06f1456c4faf298b57'
JOBS='backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json'
BASE='backend/research/reports/capture_aggregation/accepted-v2'
MODEL='backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx'
FIXTURE='backend/data/work/xc6_capture/fake-device.wav'
PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app']+[f'backend/research/{p}step_waiting_h50_holdout_v{n}' for n in range(3,7) for p in ('','reports/')]


def primary_integrity():
    if git('merge-base',PRIMARY,'HEAD')!=PRIMARY: raise ValueError('PRIMARY_NOT_ANCESTOR')
    freeze=read(V6/'primary-acoustic-qualification-freeze.json')
    if (freeze['role'],freeze['HMs'],freeze['newNeuralRuns'],freeze['RobustSessionRuns'],len(freeze['files']),freeze['freezeCanonicalSha256'])!=('PRIMARY_ACOUSTIC_QUALIFICATION_FREEZE',50,0,0,254,PRIMARY_SHA):
        raise ValueError('PRIMARY_IDENTITY_MISMATCH')
    count=validate_portable_freeze_manifest(freeze)
    allowed={'primary-freeze-remote-proof.json','primary-freeze-host-preflight.json','primary-freeze-container-preflight.json','assessment.json','assessment.md','github-receipt.json'}
    changes=git('diff','--name-status',PRIMARY,START).splitlines()
    prefix='backend/research/reports/step_waiting_h50_holdout_v6/'
    if any(not row.startswith('A\t'+prefix) or row.split('\t')[1][len(prefix):] not in allowed for row in changes):
        raise ValueError('POST_PRIMARY_MUTATION')
    for name in ('remote-proof','host-preflight','container-preflight'):
        receipt=read(V6/('primary-freeze-'+name+'.json'))
        if receipt['freezeCommit']!=PRIMARY or receipt['freezeSha256']!=PRIMARY_SHA: raise ValueError('HISTORICAL_PROOF_MISMATCH')
        if name!='remote-proof' and (receipt['pathsChecked'],receipt['hashMismatches'],receipt['backslashManifestPaths'],receipt['status'])!=(254,0,0,'PASS'):
            raise ValueError('HISTORICAL_PREFLIGHT_FAILED')
        if name=='container-preflight' and receipt['network']!='none': raise ValueError('CONTAINER_NOT_ISOLATED')
    if git('diff','--name-only',START,'--',*PROTECTED): raise ValueError('PRODUCTION_OR_HISTORY_MUTATION')
    job_sha=next(r['sha256'] for r in freeze['files'] if r['path']==JOBS)
    return {'status':'PASS','freezeCommit':PRIMARY,'freezeSha256':PRIMARY_SHA,'pathsChecked':count,'hashMismatches':0,
        'postFreezeChanges':changes,'opaqueJobManifestSha256':job_sha,'truthFilesParsed':False,
        'inputPreservationAcceptedFacts':'9 cases / 18 jobs / 228 windows / mismatches 0; input-preservation artifact verified by exact raw hash, not truth-side parsing'}


def setup():
    if git('rev-parse','HEAD')!=START or git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]!=START:
        raise ValueError('STARTING_HEAD_MISMATCH')
    WORK.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
    integrity=primary_integrity()
    save(OUT/'starting-gate.json',{'localHead':START,'remoteHead':START,'mergeBase':git('merge-base','HEAD',START),'ahead':0,'behind':0,
        'completeCommitChain':[],'productionDiff':'','github':api.github(START)})
    save(OUT/'primary-integrity.json',integrity)
    if digest((ROOT/'backend/research/reports/capture_aggregation_v2_freeze.json').read_bytes())!='3f24728b4043be0eecba4ddc3774d1ff89fc5d068bf1a44bb09324106941326f':
        raise ValueError('CONTINUOUS_BASELINE_FREEZE_MISMATCH')
    ort='apps/customer-web/node_modules/onnxruntime-web/'
    assets={'/model.onnx':MODEL,'/fir-44100.f32':'apps/customer-web/public/model-assets/practice-acoustic/fir-160-441.f32',
        '/fir-48000.f32':'apps/customer-web/public/model-assets/practice-acoustic/fir-1-3.f32'}
    for name in ('ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'):
        assets['/ort/'+name]=ort+'dist/'+name
    rows={url:{'path':repo_relative_posix(p),'sha256':digest((ROOT/p).read_bytes()),'bytes':(ROOT/p).stat().st_size} for url,p in assets.items()}
    if rows['/model.onnx']['sha256']!='4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3' or rows['/model.onnx']['bytes']!=98689283:
        raise ValueError('MODEL_BYTES_MISMATCH')
    if read(ROOT/(ort+'package.json'))['version']!='1.20.1': raise ValueError('ORT_VERSION_MISMATCH')
    save(HERE/'stage-a-assets.json',{'assets':rows,'opaqueManifest':JOBS,'opaqueManifestSha256':integrity['opaqueJobManifestSha256'],
        'primaryFreezeCommit':PRIMARY,'primaryFreezeSha256':PRIMARY_SHA,'jobsExpected':18,'windowsExpected':228,
        'modelIdentity':'robust-browser-engineering-default-xc4-v1','ortVersion':'1.20.1','provider':'webgpu','automaticFallback':False,
        'graphOptimization':'disabled','scientificDisposition':'STATISTICAL_TIE / NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER'})
    print(integrity)


def freeze():
    if git('status','--porcelain'): raise ValueError('COMMIT_TOOLING_BEFORE_FREEZE')
    primary_integrity()
    test=read(OUT/'tests-pre.json')
    if test['failed'] or test['dryModelWindows']!=228: raise ValueError('TESTS_NOT_PASS')
    primary=read(V6/'primary-acoustic-qualification-freeze.json')
    paths=[r['path'] for r in primary['files']]
    paths+=git('ls-files','--','apps/customer-web','backend/app',repo_relative_posix(HERE),repo_relative_posix(OUT),
        'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs','backend/research/browser_runtime/xc1_runtime_selection.mjs').splitlines()
    paths += [repo_relative_posix(V6/'primary-acoustic-qualification-freeze.json'),'backend/research/reports/capture_aggregation_v2_freeze.json',
        BASE+'/browser.json',BASE+'/musical.json',BASE+'/parity.json',MODEL,FIXTURE,'backend/data/work/product_completion_replay/v1/audio_only/manifest.json',
        'backend/data/work/product_completion_replay/v4/truth.json','apps/customer-web/node_modules/onnxruntime-web/package.json',
        'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright/package.json',
        'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/package.json']
    continuous=read(ROOT/'backend/data/work/product_completion_replay/v1/audio_only/manifest.json')
    paths += [v['path'] for c in continuous['clips'] for v in c['pcm'].values()]
    paths += [r['path'] for r in read(HERE/'stage-a-assets.json')['assets'].values()]
    paths += [repo_relative_posix(WORK/p) for p in ('stage-a/entry.js','stage-a/worker.js','stage-a/bundle-inputs.json','dry-runtime.mjs')]
    files=[{'path':repo_relative_posix(p),'sha256':digest((ROOT/p).read_bytes())} for p in sorted(set(paths))]
    value={'role':'H50_QUALIFICATION_EXECUTION_PROTOCOL_FREEZE','pathSchema':'REPO_RELATIVE_POSIX_V1','startingHead':START,
        'implementationCommit':git('rev-parse','HEAD'),'primaryFreezeCommit':PRIMARY,'primaryFreezeSha256':PRIMARY_SHA,
        'files':files,'newNeuralRuns':0,'RobustSessionRuns':0,'StageB':'PROHIBITED_THIS_PHASE'}
    value['freezeCanonicalSha256']=digest(canonical(value));validate_portable_freeze_manifest(value)
    save(OUT/'execution-protocol-freeze.json',value);print(value['freezeCanonicalSha256'])


def verify():
    primary_integrity();freeze=read(OUT/'execution-protocol-freeze.json');validate_portable_freeze_manifest(freeze)
    commit=git('log','-1','--format=%H','--',repo_relative_posix(OUT/'execution-protocol-freeze.json'))
    remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if remote!=commit or git('rev-parse','HEAD')!=commit: raise ValueError('REMOTE_EXECUTION_FREEZE_MISMATCH')
    proof={'freezeCommit':commit,'remoteHead':remote,'freezeSha256':freeze['freezeCanonicalSha256'],'remoteVerifiedAt':now(),
        'primaryFreezeCommit':PRIMARY,'primaryFreezeSha256':PRIMARY_SHA,
        'stageAAssetsSha256':digest((HERE/'stage-a-assets.json').read_bytes()),
        'bundleManifestSha256':digest((WORK/'stage-a/bundle-inputs.json').read_bytes())}
    return proof


if __name__=='__main__':
    if sys.argv[1]=='setup': setup()
    elif sys.argv[1]=='freeze': freeze()
    elif sys.argv[1]=='verify': print(__import__('json').dumps(verify()))
    elif sys.argv[1]=='integrity': print(__import__('json').dumps(primary_integrity()))
    elif sys.argv[1]=='github': print(__import__('json').dumps(api.github(git('rev-parse','HEAD'))))
    elif sys.argv[1]=='receipt':
        head=git('rev-parse','HEAD');value={'head':head,'completeCommitChain':git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),'github':api.github(head)}
        save(OUT/'github-receipt.json',value);print(value['github'])
