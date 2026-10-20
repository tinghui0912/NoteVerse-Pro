import security
import re
import protocol as p
from taxonomy import classify, ownership

SCALARS=lambda *names:{name:True for name in names}
WINDOW=SCALARS('jobIndex','regionIndex','windowIndex','ownedStartTarget','ownedEndTarget','startSample','endSample')
INPUT=SCALARS('windowIndex','start','end','samples','actualSha256','expectedSha256','sourceOriginSample','sourceInputStart','sourceInputEnd','gatePassedAt')|{'runtimeWindow':WINDOW}
FLAGS=SCALARS('truthOpened','midiOpened','scenarioOpened','targetOpened','productVerdictComputed')
SCHEMA=SCALARS('status','actualModelRuns','modelRunCountComplete','attemptedRuns','workerConstructions','modelSessionLoads',
    'jobsCompleted','windowsCompleted','modelInputMismatches','forbiddenRequests','failure','ORT','modelIdentity')|FLAGS|{
    'truthBearingBundleInputs':[True],
    'GPU':{'info':SCALARS('vendor','architecture','device','description'),'isFallbackAdapter':True},
    'diagnostics':[SCALARS('type','url','at')],
    'requests':[SCALARS('url','allowed')], 'dataReads':[SCALARS('file','at')],
    'trace':SCALARS('status','actualModelRuns','modelRunCountComplete','attemptedRuns','workerConstructions','modelSessionLoads','unresolvedRuns','failure')|{
        'model':SCALARS('actualSessionLoadCount','modelSha256','modelByteSize','executionProvider','automaticFallback','ortWebVersion'),
        'results':[SCALARS('jobId','sourceDomainId','sourceRateHz','windowsCompleted','status')|{'inputs':[INPUT],
            'snapshot':SCALARS('state','outstanding','failureCode')|{'counts':SCALARS('windowsStarted','windowsPublished','regionsStarted')}}],
        'transactions':[SCALARS('direction','type','transactionIndex','id','error','actualSessionRunCount')|{'runtimeWindow':WINDOW,'workerWindow':WINDOW}]
    }
}


def require(condition,message):
    if not condition:raise ValueError(message)


def audit():
    proof=p.require_remote();started=p.now();p.identities()
    static=p.own_json(p.OUT/'static-architecture.json');continuous=p.continuous_witness()
    a=p.project(p.ACOUSTIC,SCHEMA,post=True)
    seal=p.project(p.SEAL,SCALARS('status','acousticSha256','truthNotServed','serverForbiddenRequestCount','actualModelRuns','modelRunCountComplete')|FLAGS|{'truthBearingBundleInputs':[True]},post=True)
    t=a['trace'];m=t['model']
    counts=classify([d['url'] for d in a['diagnostics'] if d.get('type')=='worker-created'])
    verdict=ownership(counts,t['workerConstructions'],t['modelSessionLoads'],m['actualSessionLoadCount'])
    require(verdict=='PASS',verdict)
    require(a['workerConstructions']==counts['total'] and a['modelSessionLoads']==1,'BROWSER_AND_TRACE_ACCOUNTING_DISAGREEMENT')
    require(a['status']==seal['status']=='BLOCKED_AUDIO_OUTPUT_SEALED','ORIGINAL_SEAL_STATUS_CHANGED')
    require('STAGE_A_EXECUTION_OR_ACCOUNTING_FAILURE' in a['failure'] and t['failure'] is None and t['status']=='ACOUSTIC_OUTPUT_SEALED','ORIGINAL_BLOCKER_NOT_ACCOUNTING_ONLY')
    require(a['jobsCompleted']==18 and a['windowsCompleted']==228 and a['actualModelRuns']==t['actualModelRuns']==228,
        'ACOUSTIC_EXECUTION_INCOMPLETE')
    require(a['modelRunCountComplete'] is True and t['modelRunCountComplete'] is True and t['attemptedRuns']==228 and t['unresolvedRuns']==0 and a['modelInputMismatches']==0,
        'ACOUSTIC_RUN_ACCOUNTING_NOT_COMPLETE')
    require(m['modelSha256']=='4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3' and m['modelByteSize']==98689283
        and m['executionProvider']=='webgpu' and m['automaticFallback'] is False and m['ortWebVersion']=='1.20.1' and a['ORT']=='1.20.1','FROZEN_MODEL_IDENTITY_FAILURE')
    info=a['GPU']['info'];hardware=' '.join(str(info.get(k,'')) for k in ('vendor','architecture','device','description'))
    require(bool(info.get('vendor')) and not re.search('software|swiftshader|llvmpipe',hardware,re.I) and a['GPU'].get('isFallbackAdapter') is not True,'HARDWARE_WEBGPU_NOT_ESTABLISHED')
    require(all(a.get(k) is False and seal.get(k) is False for k in FLAGS),'TRUTH_ISOLATION_FAILURE')
    require(seal['truthNotServed'] is True and a['truthBearingBundleInputs']==seal['truthBearingBundleInputs']==[] and a['forbiddenRequests']==seal['serverForbiddenRequestCount']==0,'TRUTH_ISOLATION_FAILURE')
    require(seal['acousticSha256']==p.ACOUSTIC_SHA and seal['actualModelRuns']==228 and seal['modelRunCountComplete'] is True,'ORIGINAL_SEAL_ACCOUNTING_FAILURE')
    jobs_path='backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json'
    jobs=p.project(jobs_path,{'schema':True,'jobs':[SCALARS('jobId','pcmPath','sourceDomainId','sourceRateHz','sourceOriginSample')|{
        'expectedModelInputs':[SCALARS('windowIndex','start','end','sha256')]}]},post=True)
    require(jobs['schema']=='AUDIO_ONLY_OPAQUE_JOBS_NO_TRUTH_NO_TARGET_NO_FAMILY' and len(jobs['jobs'])==18,'OPAQUE_INPUT_MANIFEST_FAILURE')
    require(len(t['results'])==18,'JOB_RESULT_COUNT_FAILURE')
    checked=0
    for job,result in zip(jobs['jobs'],t['results']):
        expected=job['expectedModelInputs']
        require(result['jobId']==job['jobId'] and result['sourceDomainId']==job['sourceDomainId'] and result['sourceRateHz']==job['sourceRateHz'] and result['status']=='PASS','SOURCE_DOMAIN_ACCOUNTING_FAILURE')
        require(len(result['inputs'])==len(expected)==result['windowsCompleted']==result['snapshot']['counts']['windowsStarted']==result['snapshot']['counts']['windowsPublished'],'WINDOW_COUNT_FAILURE')
        require(result['snapshot']['state']=='SEALED' and result['snapshot']['outstanding']==0 and result['snapshot']['failureCode'] is None and result['snapshot']['counts']['regionsStarted']==1,'SOURCE_RUNTIME_NOT_SEALED')
        for actual,frozen in zip(result['inputs'],expected):
            require(actual['actualSha256']==actual['expectedSha256']==frozen['sha256'] and actual['samples']==29120,'FROZEN_INPUT_HASH_FAILURE')
            require(actual['windowIndex']==actual['runtimeWindow']['windowIndex']==frozen['windowIndex'] and actual['start']==actual['runtimeWindow']['startSample']==frozen['start'] and actual['end']==actual['runtimeWindow']['endSample']==frozen['end'],'FROZEN_INPUT_COORDINATE_FAILURE')
            require(actual['sourceOriginSample']==job['sourceOriginSample'],'SOURCE_ORIGIN_MUTATION')
            checked+=1
    require(checked==228,'FROZEN_INPUT_COUNT_FAILURE')
    requests=[x for x in t['transactions'] if x.get('direction')=='request'];responses=[x for x in t['transactions'] if x.get('direction')=='response']
    inferences=[x for x in requests if x.get('type')=='INFER']
    require(sum(x.get('type')=='LOAD' for x in requests)==1 and len(inferences)==228,'MODEL_TRANSACTION_COUNT_FAILURE')
    require([x['transactionIndex'] for x in inferences]==list(range(228)),'MODEL_TRANSACTION_ORDER_FAILURE')
    require([x['actualSessionRunCount'] for x in responses if x.get('actualSessionRunCount') is not None]==list(range(1,229)),'MODEL_RESPONSE_RUN_COUNT_FAILURE')
    require(len({x['id'] for x in responses})==len(responses) and all(x.get('error') is None for x in responses),'WORKER_RESPONSE_FAILURE')
    for x in inferences:
        require(x['workerWindow']['jobIndex']==x['transactionIndex'] and {k:v for k,v in x['workerWindow'].items() if k!='jobIndex'}=={k:v for k,v in x['runtimeWindow'].items() if k!='jobIndex'},'SOURCE_IDENTITY_REWRITTEN_BY_TRANSACTION')
    bundle_path='backend/data/work/step_waiting_h50_holdout_v7/stage-a/bundle-inputs.json'
    bundles=p.project(bundle_path,{'truthBearingBundleInputs':[True],'graphs':[SCALARS('entry','output','sha256')|{'inputs':[True]}]},post=True)
    require(bundles['truthBearingBundleInputs']==[],'TRUTH_BUNDLE_FAILURE')
    worker=next(g for g in bundles['graphs'] if g['output']=='stage-a/worker.js')
    require(worker['entry']==p.SOURCES['worker'] and p.SOURCES['worker'] in worker['inputs'],'PRODUCT_WORKER_BUNDLE_PROVENANCE_FAILURE')
    require(p.digest(p.raw('backend/data/work/step_waiting_h50_holdout_v7/stage-a/worker.js'))==worker['sha256'],'PRODUCT_WORKER_BUNDLE_HASH_FAILURE')
    forbidden=re.compile(r'step-runtime|step-practice-controller|continuous-practice-controller|WaitingTopologyGate|selector|scorer|product-replay|midi-parser|scenario-manifest',re.I)
    require(not any(forbidden.search(v) for g in bundles['graphs'] for v in g['inputs']),'TRUTH_BUNDLE_FAILURE')
    asset_path='backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json'
    asset_names=['/model.onnx','/fir-44100.f32','/fir-48000.f32','/ort/ort.webgpu.min.mjs','/ort/ort-wasm-simd-threaded.jsep.mjs','/ort/ort-wasm-simd-threaded.jsep.wasm']
    assets=p.project(asset_path,{'assets':{name:SCALARS('path','sha256','bytes') for name in asset_names}},post=True)['assets']
    require(assets['/ort/ort-wasm-simd-threaded.jsep.mjs']['sha256']==p.ORT_SHA and assets['/ort/ort-wasm-simd-threaded.jsep.mjs']['path']==p.ORT_PATH,'ORT_RUNTIME_ASSET_BINDING_FAILURE')
    allowed_urls={'/','/entry.js','/worker.js'}|set(asset_names)|{'/pcm/'+job['jobId'] for job in jobs['jobs']}
    require(all(r['allowed'] is True and r['url'] in allowed_urls for r in a['requests']),'TRUTH_HTTP_EXPOSURE_FAILURE')
    allowed_reads={asset_path,p.V7+'stage-a-permission.json',p.V7+'continuous-gate.json',jobs_path,bundle_path,
        'backend/data/work/step_waiting_h50_holdout_v7/stage-a/entry.js','backend/data/work/step_waiting_h50_holdout_v7/stage-a/worker.js'}
    allowed_reads|={v['path'] for v in assets.values()}|{job['pcmPath'] for job in jobs['jobs']}
    require(all(r['file'] in allowed_reads for r in a['dataReads']),'TRUTH_FILESYSTEM_EXPOSURE_FAILURE')
    outcome={'phase':'PRACTICE_STEP_H50_STAGE_A_WORKER_ACCOUNTING_TAXONOMY_ADJUDICATION_NO_NEURAL_NO_TRUTH',
        'startingRemoteHead':p.START,'workerTaxonomyFreezeCommit':proof['freezeCommit'],'workerTaxonomyFreezeSha256':proof['freezeSha256'],
        'workerTaxonomyRemoteVerifiedAt':proof['remoteVerifiedAt'],'adjudicationStartedAt':started,'adjudicationCompletedAt':p.now(),
        'productionDiff':'','v3Diff':'','v4Diff':'','v5Diff':'','v6Diff':'','v7Diff':'',
        'v6PrimaryFreezeCommit':p.PRIMARY,'v6PrimaryFreezeSha256':p.PRIMARY_SHA,'v7ExecutionFreezeCommit':p.EXECUTION,'v7ExecutionFreezeSha256':p.EXECUTION_SHA,
        'v7OriginalDisposition':'STEP_WAITING_H50_STAGE_A_ACOUSTIC_EXECUTION_BLOCKED','v7OriginalSealStatus':seal['status'],
        'v7AcousticOutputSha256':p.ACOUSTIC_SHA,'v7AcousticSealSha256':p.SEAL_SHA,'v7EvidenceCommit':p.EVIDENCE,
        'taxonomy':p.own_json(p.HERE/'worker-taxonomy-contract.json'),'staticArchitecture':static,'canonicalContinuousWitness':continuous,
        'v7StageAAccounting':{'jobsCompleted':18,'windowsCompleted':228,'actualModelRuns':228,'modelRunCountComplete':True,'unresolvedRuns':0,
            'modelInputMismatches':0,'frozenInputHashesIndependentlyChecked':checked,
            'productAcousticWorkerConstructionsFromTrace':t['workerConstructions'],'browserProductWorkerEvents':counts['product'],
            'observedOrtRuntimeWorkerEvents':counts['ort'],'totalBrowserWorkerEvents':counts['total'],'unexpectedWorkerEvents':counts['unexpected'],
            'productModelSessionLoads':t['modelSessionLoads'],'modelActualSessionLoadCount':m['actualSessionLoadCount'],'workerClassifications':counts['events']},
        'truthIsolation':FLAGS|{'truthOpened':False,'truthNotServed':True,'midiOpened':False,'scenarioOpened':False,'targetOpened':False,
            'productVerdictComputed':False,'truthBearingBundleInputs':[],'forbiddenRequests':0,'readLedger':'adjudication-read-ledger.json'},
        'originalGateOutcome':'FAIL','failureClassification':'QUALIFICATION_HARNESS_RAW_WORKER_COUNT_CONFLATED_PRODUCT_AND_ORT_RUNTIME_WORKERS',
        'testGapClassification':'QUALIFICATION_HARNESS_WORKER_TAXONOMY_TEST_GAP',
        'correctedProductOwnershipEvaluation':{'productAcousticOwnership':'PASS','modelSessionOwnership':'PASS','acousticExecutionCompleteness':'PASS','frozenInputIntegrity':'PASS','truthIsolation':'PASS'},
        'newNeuralRuns':0,'RobustSessionRuns':0,'v8NewNeuralRuns':0,'v8RobustRuns':0,'acousticOutputReused':True,'acousticOutputModified':False,'acousticOutputRerun':False,
        'StageB':'NOT_STARTED','safetyCounters':'NOT_MEASURED','usabilityMetrics':'NOT_MEASURED','productLatencyMetrics':'NOT_MEASURED',
        'commercialQualification':'NOT_PERFORMED','capabilities':{'Continuous':'MODEL_NOT_VALIDATED','STEP':'ATTEMPT_ANALYZER_NOT_VALIDATED','productionMicrophone':False,'D4':False},
        'disposition':'STEP_WAITING_H50_STAGE_A_ACCOUNTING_DEFECT_ADJUDICATED_DOWNSTREAM_SEAL_ESTABLISHED_TRUTH_NOT_OPENED',
        'nextAllowedPhase':'STOP for independent eligibility-seal audit. Only separate future authorization may verify immutable v7 output and open frozen truth/scenarios for Stage B; no rerun, tuning or microphone integration.',
        'blindEvidenceLimitation':'V7 is the sole fresh blind acoustic execution for this corpus. Any future rerun is exposed regression/reproducibility, never fresh primary holdout.'}
    p.save(p.OUT/'adjudication.json',outcome)
    p.save(p.OUT/'adjudication-read-ledger.json',{'reads':p.READS,'acousticNotePayloadsProjected':False,'truthOpened':False,'newNeuralRuns':0,'RobustSessionRuns':0})
    binding={'v6PrimaryFreezeCommit':p.PRIMARY,'v6PrimaryFreezeSha256':p.PRIMARY_SHA,'v7ExecutionFreezeCommit':p.EXECUTION,'v7ExecutionFreezeSha256':p.EXECUTION_SHA,
        'v7AcousticOutputSha256':p.ACOUSTIC_SHA,'v7AcousticSealSha256':p.SEAL_SHA,'v7EvidenceCommit':p.EVIDENCE,
        'workerTaxonomyFreezeCommit':proof['freezeCommit'],'workerTaxonomyFreezeSha256':proof['freezeSha256'],
        'productionWorkerSessionSourceHashes':static['sources'],
        'canonicalContinuousRunnerSha256':static['sources']['canonical']['sha256'],'v7FreshContinuousGateSha256':p.digest(p.raw(p.V7+'continuous-gate.json')),
        'adjudicationSha256':p.digest(p.raw(p.local(p.OUT/'adjudication.json')))}
    downstream={'role':'STAGE_A_DOWNSTREAM_ELIGIBILITY_SEAL','status':'SEALED_BLIND_STAGE_A_OUTPUT_ELIGIBLE_FOR_FROZEN_STAGE_B_AFTER_ACCOUNTING_ADJUDICATION',
        'sealedAt':p.now(),'bindings':binding,'originalV7Disposition':outcome['v7OriginalDisposition'],'originalV7SealStatus':outcome['v7OriginalSealStatus'],'originalFrozenGateOutcome':'FAIL',
        'correctedProductOwnershipEvaluation':outcome['correctedProductOwnershipEvaluation'],'v8NewNeuralRuns':0,'v8RobustRuns':0,
        'acousticOutputReused':True,'acousticOutputModified':False,'acousticOutputRerun':False,'truthOpened':False,'StageB':'NOT_STARTED'}
    p.save(p.OUT/'downstream-eligibility-seal.json',downstream)
    print({'disposition':outcome['disposition'],'productWorkers':counts['product'],'ortRuntimeWorkersObserved':counts['ort'],'unexpected':counts['unexpected'],'newNeuralRuns':0})


if __name__=='__main__':
    try:audit()
    except Exception as error:
        p.save(p.OUT/'adjudication-failure.json',{'failure':str(error),'newNeuralRuns':0,'RobustSessionRuns':0,'StageB':'NOT_STARTED','truthOpened':False,'readLedger':p.READS})
        raise
