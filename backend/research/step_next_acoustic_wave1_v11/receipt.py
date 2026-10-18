"""Failure receipts only. Does not import any Wave-1 preparation/execution code."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'step_waiting_h50_holdout_v8'))
import protocol as p
import json
import subprocess

ROOT=p.ROOT
OUT=ROOT/'backend/research/reports/step_next_acoustic_wave1_v11'
START='8e7762122b924f265ec0c8ebe615c9930439c6d6'
PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app']+[f'backend/research/{a}step_waiting_h50_holdout_v{n}' for n in range(3,11) for a in ('','reports/')]
def load(path):return json.loads(path.read_text(encoding='utf-8'))
def save(name,value):p.save(OUT/name,value)
def unchanged():
    if p.git('diff','--name-only',START,'--',*PROTECTED):raise ValueError('PROTECTED_SOURCE_CHANGED')
def build():
    unchanged();pre=load(OUT/'preflight.json');failure=load(OUT/'pre-freeze-harness-failure.json')
    contract=load(ROOT/'backend/research/step_next_acoustic_wave1_v11/candidate-contract.json')
    value={'phase':'PRACTICE_STEP_NEXT_ACOUSTIC_WAVE1_EXPOSED_DEVELOPMENT_BAKEOFF','label':'DEVELOPMENT_ONLY_NOT_QUALIFICATION',
      'startingRemoteHead':START,'createdAt':p.now(),'productionDiff':[],'v3-v10Diffs':{f'v{n}':[] for n in range(3,11)},
      'developmentProtocolFreezeCommit':None,'developmentProtocolFreezeSha256':None,'remoteVerifiedAt':None,
      'freezeStatus':'NOT_CREATED_BECAUSE_PREFREEZE_HARNESS_PREPARATION_FAILED',
      'candidateBudget':{'maximumChallengers':2,'declaredChallengers':2,'executedChallengers':0,'controlRole':'NON_SELECTABLE_PARITY_CONTROL'},
      'candidateIdentities':contract,'staticAdmissibility':{'assetIdentityAndHistoricalProvenance':'PASS',
        'completeExecutionAdmission':'NOT_ESTABLISHED_HARNESS_PREFLIGHT_BLOCKED','Original':'NOT_ADMITTED_NO_INFERENCE','scopeCorrection':failure['existingPreflightScopeCorrection']},
      'LayerA':{'role':'KNOWN_FAILURE_REGRESSION_SLICE','jobs':18,'rates':[44100,48000],
        'frozenInputs':[{'path':q,'sha256':p.digest((ROOT/q).read_bytes())} for q in (
         'backend/research/reports/step_waiting_h50_holdout_v6/audio-bound-cases.json',
         'backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json',
         'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json',
         'backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json')],
        'productResults':'NOT_STARTED','knownBlockerRepairStatus':'NOT_EVALUATED','safetyRegressionCounters':'NOT_MEASURED','busyLateDenominators':'NOT_MEASURED'},
      'LayerB':{'role':'EXPOSED_DEVELOPMENT_CORPUS','takesVerified':50,'manifestIdentities':pre['sourceManifests'],
        'verifiedWavPcmTakeIdentities':pre['layerB'],'commonInteriorComputation':'NOT_COMPLETED','broadMetrics':'NOT_MEASURED',
        'metricComparabilityNotes':contract['broadMetrics']},
      'plannedRunBudget':'NOT_FROZEN_PREPARATION_STOPPED_BEFORE_WINDOW_BUDGET_GENERATION',
      'actualRunAccounting':{'RobustModelWindowRuns':0,'OriginalModelWindowRuns':0,'decoderARuns':0,'decoderBRuns':0,
        'OriginalDecoderRuns':0,'hiddenWarmupRuns':0,'unknownRuns':0,'modelSessionLoads':0,'WorkerConstructions':0,'newNeuralRuns':0},
      'RobustAParity':'NOT_STARTED','candidateAcousticSeals':'NOT_CREATED','scoring':'NOT_STARTED',
      'runtimeResourceResults':{'browser':'NOT_STARTED','GPU':'NOT_STARTED','modelLoading':'NOT_STARTED','fallbackAttempts':0,'timing':'NOT_MEASURED','memory':'NOT_MEASURED'},
      'developmentSurvivorSet':{'status':'NOT_EVALUATED_HARNESS_BLOCKED','members':[],'notANoSurvivorFinding':True},
      'tests':'NOT_STARTED_PREFREEZE_PREPARATION_FAILED','failure':failure,
      'winnerSelected':False,'freshHoldoutSelected':False,'qualificationStarted':False,'freshHoldoutDesignUnchanged':True,
      'capabilities':contract['capabilities'],'disposition':'EVALUATION_INTEGRITY_BLOCKED','nextAllowedPhase':failure['nextAllowedPhase']}
    save('assessment.json',value);print({'disposition':value['disposition'],'newNeuralRuns':0,'freeze':'NOT_CREATED'})

def receipt():
    unchanged();head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote:raise ValueError('REMOTE_FAILURE_EVIDENCE_MISMATCH')
    paths=p.git('ls-files','--',p.local(OUT),'backend/research/step_next_acoustic_wave1_v11').splitlines();bindings=[]
    for path in paths:
        local=(ROOT/path).read_bytes();committed=subprocess.check_output(['git','show',head+':'+path],executable=p.GIT_EXE,cwd=ROOT)
        if p.digest(local)!=p.digest(committed):raise ValueError('REMOTE_EVIDENCE_BYTES_MISMATCH')
        bindings.append({'path':path,'sha256':p.digest(local)})
    value={'evidenceCommit':head,'endingRemoteHead':head,'remoteVerifiedAt':p.now(),
      'completeCommitChain':p.git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),'files':bindings,
      'github':p.github(head),'newNeuralRuns':0,'disposition':'EVALUATION_INTEGRITY_BLOCKED'}
    save('github-failure-receipt.json',value);print(value['github'])

def final():
    unchanged();head=p.git('rev-parse','HEAD');remote=p.git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split()[0]
    if head!=remote or p.git('status','--porcelain'):raise ValueError('FINAL_REMOTE_OR_WORKTREE_MISMATCH')
    value=load(OUT/'assessment.json')|{'endingRemoteHead':head,'completeCommitChain':p.git('log','--reverse','--format=%H %s',START+'..HEAD').splitlines(),
      'evidenceRemoteProof':load(OUT/'github-failure-receipt.json'),'github':p.github(head),'finalVerifiedAt':p.now()}
    p.save(ROOT/'backend/data/work/step_next_acoustic_wave1_v11/final-report.json',value);print({'head':head,'disposition':value['disposition'],'github':value['github']})

if __name__=='__main__':{'build':build,'receipt':receipt,'final':final}[sys.argv[1]]()
