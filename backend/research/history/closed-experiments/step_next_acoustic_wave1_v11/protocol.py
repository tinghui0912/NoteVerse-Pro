"""Wave-1 provenance/freezes only; never imports or invokes a neural runtime."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'step_waiting_h50_holdout_v8'))
import protocol as p
import json
import zipfile
import hashlib
import subprocess

ROOT=p.ROOT
HERE=Path(__file__).resolve().parent
OUT=ROOT/'backend/research/reports/step_next_acoustic_wave1_v11'
WORK=ROOT/'backend/data/work/step_next_acoustic_wave1_v11'
START='8e7762122b924f265ec0c8ebe615c9930439c6d6'
LABEL='DEVELOPMENT_ONLY_NOT_QUALIFICATION'
FULL='backend/research/reports/phase9g_xc1_r3d_full_take_manifest_f5_2026-10-15.json'
SANITIZED='backend/research/reports/phase9g_xc1_r3d_sanitized_stage_a_manifest_f5_2026-10-15.json'
PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app']+[f'backend/research/{a}step_waiting_h50_holdout_v{n}' for n in range(3,11) for a in ('','reports/')]

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while b:=f.read(1024*1024):h.update(b)
    return h.hexdigest()
def load(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
def own(name):return load(p.local(OUT/name))
def save(name,value):p.save(OUT/name,value)
def unchanged():
    if p.git('diff','--name-only',START,'--',*PROTECTED):raise ValueError('PRODUCTION_OR_IMMUTABLE_HISTORY_MUTATED')
def files(rows):
    for row in rows:
        p.portable(row['path'])
        if sha(ROOT/row['path'])!=row['sha256']:raise ValueError('FROZEN_FILE_MISMATCH:'+row['path'])

def setup():
    head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=START or remote!=START:raise ValueError('STARTING_HEAD_MISMATCH')
    unchanged();save('starting-gate.json',{'localHead':head,'remoteHead':remote,'mergeBase':p.git('merge-base',head,remote),'ahead':0,'behind':0,
        'completeCommitChain':[],'productionDiff':[],'github':p.github(head),'recordedAt':p.now(),'newNeuralRuns':0})
    closure=load('backend/research/reports/step_waiting_h50_holdout_v10/closure-manifest.json');files(closure['files'])
    p.identities()
    decoder='backend/research/browser_runtime/xc2_decoders.mjs'
    if sha(ROOT/decoder)!='4a81ac847b62485ff1ed13e865736b418c798515abd886b0fdef7dfdd992efbf':raise ValueError('DECODER_B_SOURCE_MISMATCH')
    models=[{'id':'ROBUST_RAW','path':'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx',
        'sha256':'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3','bytes':98689283},
        {'id':'BYTEDANCE_ORIGINAL_FIXED1820','path':'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx',
        'sha256':'6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5','bytes':98691493}]
    for row in models:
        if (ROOT/row['path']).stat().st_size!=row['bytes'] or sha(ROOT/row['path'])!=row['sha256']:raise ValueError('MODEL_ASSET_MISMATCH')
    checkpoint=ROOT/'models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth'
    if sha(checkpoint)!='c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141':raise ValueError('ORIGINAL_CHECKPOINT_MISMATCH')
    original=load('backend/data/work/bytedance_browser_runtime_feasibility/report.json')
    if original['export']['input_shape']!=[1,29120] or original['export']['onnx_size_bytes']!=98691493:raise ValueError('ORIGINAL_PROVENANCE_INPUT_DRIFT')
    full=load(FULL);san=load(SANITIZED)
    if full['takeCount']!=50 or len(full['takes'])!=50 or len(san['takes'])!=50 or san['implementationCommit']!='a75e11ada043859c1fb07e992cfd6bdd94b5c521':raise ValueError('LAYER_B_IDENTITY_DRIFT')
    archive=ROOT/'backend/data/work/smd_v2/SMD-piano_v2.zip'
    verified=[]
    with zipfile.ZipFile(archive) as z:
        for take,s in zip(full['takes'],san['takes']):
            if take['takeId']!=s['takeId'] or take['workId']!=s['workId'] or take['acousticWavSha256']!=s['sourceAcousticWavSha256'] or take['canonicalPcm']['sha256']!=s['canonicalPcm']['sha256']:raise ValueError('LAYER_B_PAIRING_DRIFT')
            pcm=ROOT/s['canonicalPcm']['sourceRelativePath']
            if pcm.stat().st_size!=s['canonicalPcm']['byteSize'] or sha(pcm)!=s['canonicalPcm']['sha256']:raise ValueError('LAYER_B_PCM_MISMATCH:'+s['takeId'])
            h=hashlib.sha256()
            with z.open(take['acousticWavRelativePath']) as f:
                while b:=f.read(1024*1024):h.update(b)
            if h.hexdigest()!=take['acousticWavSha256']:raise ValueError('LAYER_B_WAV_MISMATCH')
            verified.append({'takeId':take['takeId'],'workId':take['workId'],'wavSha256':h.hexdigest(),'pcmPath':s['canonicalPcm']['sourceRelativePath'],
                'pcmSha256':s['canonicalPcm']['sha256'],'frames':s['canonicalPcm']['sampleCount'],'historicalInterior':s['scoreableInterior']})
    save('preflight.json',{'status':'PASS','label':LABEL,'models':models,'originalStaticAdmissibility':'PASS',
        'originalClassification':'HISTORICAL_THRESHOLDS_ENGINEERING_BRIDGE_NOT_RECALIBRATED',
        'originalProvenance':{'report':'backend/data/work/bytedance_browser_runtime_feasibility/report.json','sha256':sha(ROOT/'backend/data/work/bytedance_browser_runtime_feasibility/report.json'),
            'exportSource':'backend/research/tools/evaluate_bytedance_browser_runtime_feasibility.py','exportSourceSha256':sha(ROOT/'backend/research/tools/evaluate_bytedance_browser_runtime_feasibility.py'),
            'checkpointSha256':sha(checkpoint),'input':[1,29120],'output':[1,183,88],'bridge':'Production decodeRobustPiano(raw,start,{onsetThreshold:.20,frameThreshold:.10}); production source-domain projection and planner geometry, no target access.'},
        'layerB':verified,'sourceManifests':[{'path':q,'sha256':sha(ROOT/q)} for q in (FULL,SANITIZED)],
        'modelRuns':0,'selectedPcmDecoded':False,'freshHoldoutSelected':False})
    print({'status':'PASS','takes':len(verified),'originalStaticAdmissibility':'PASS','newNeuralRuns':0})

def freeze():
    unchanged()
    if p.git('status','--porcelain'):raise ValueError('COMMIT_TOOLING_FIRST')
    if own('tests.json')['failed']:raise ValueError('PRE_FREEZE_TESTS_FAILED')
    assets=load(p.local(HERE/'stage-a-assets.json'));manifest=load(assets['audioManifest'])
    paths=p.git('ls-files','--',p.local(HERE),p.local(OUT)).splitlines()
    paths += [r['path'] for r in assets['assets'].values()]+[assets['audioManifest'],
        'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json',
        'backend/research/reports/step_waiting_h50_holdout_v6/audio-bound-cases.json',
        'backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json',
        'backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json',
        'backend/research/reports/step_waiting_h50_holdout_v9/counter-denominator-contract.json',
        'backend/research/reports/step_waiting_h50_holdout_v9/stage-a-capture-watermark-reconstruction.json',p.ACOUSTIC,p.SEAL,FULL,SANITIZED,
        'backend/research/reports/step_waiting_h50_holdout_v10/primary-qualification-closure.json',
        'backend/research/reports/step_waiting_h50_holdout_v10/exposure-transition.json',
        'backend/research/reports/step_waiting_h50_holdout_v10/existing-acoustic-candidate-inventory.json',
        'backend/research/reports/step_waiting_h50_holdout_v10/fresh-holdout-design.json']
    for job in manifest['jobs']:paths.append(job['pcmPath'])
    for g in load(p.local(WORK/'bundle-graphs.json')):
        paths+=g['inputs'];paths.append(p.local(WORK/g['output']))
    paths+=['backend/research/browser_runtime/xc2_decoders.mjs','backend/research/browser_runtime/xc1_robust_decoder.mjs',
        'backend/research/xc1_scientific_bakeoff.py','backend/research/tools/phase9g_xc1_r3d_stage_b.py',
        'backend/research/step_waiting_h50_holdout_v9/evaluate.ts','backend/research/step_waiting_h50_holdout_v9/domain.ts',
        'backend/research/step_waiting_h50_holdout_v7/source-execution.ts',
        'backend/research/step_waiting_topology_v3/assembly.ts',p.local(WORK/'bundle-graphs.json')]
    value={'role':'WAVE1_EXPOSED_DEVELOPMENT_PROTOCOL_FREEZE','label':LABEL,'startingRemoteHead':START,'createdAt':p.now(),
        'implementationCommit':p.git('rev-parse','HEAD'),'candidateBudget':2,'budget':own('planned-budget.json'),'newNeuralRuns':0,
        'files':[{'path':p.portable(q),'sha256':sha(ROOT/q)} for q in sorted(set(paths))]}
    value['freezeCanonicalSha256']=p.digest(p.canonical(value));save('development-protocol-freeze.json',value);print(value['freezeCanonicalSha256'])

def verify_freeze():
    unchanged();f=own('development-protocol-freeze.json');v=dict(f);expected=v.pop('freezeCanonicalSha256')
    if p.digest(p.canonical(v))!=expected:raise ValueError('FREEZE_CANONICAL_MISMATCH')
    files(f['files']);return f

def remote():
    subprocess.check_output(['git','fetch','origin','codex/customer-web-delivery-boundary'],executable=p.GIT_EXE,cwd=ROOT)
    f=verify_freeze();head=p.git('rev-parse','HEAD');commit=p.git('log','-1','--format=%H','--',p.local(OUT/'development-protocol-freeze.json'))
    if head!=commit or p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]!=commit:raise ValueError('REMOTE_FREEZE_MISMATCH')
    proof={'freezeCommit':commit,'remoteHead':commit,'freezeSha256':f['freezeCanonicalSha256'],'remoteVerifiedAt':p.now(),'newNeuralRuns':0}
    save('execution-permission.json',proof|{'assetsSha256':sha(HERE/'stage-a-assets.json'),'audioManifestSha256':sha(ROOT/load(p.local(HERE/'stage-a-assets.json'))['audioManifest'])})
    print(proof)

if __name__=='__main__':{'setup':setup,'freeze':freeze,'remote':remote,'verify':verify_freeze}[sys.argv[1]]()
