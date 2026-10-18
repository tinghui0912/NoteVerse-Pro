"""Frozen URL/ownership measurement, independent of all acoustic note outcomes."""
from urllib.parse import urlsplit

PRODUCT='/worker.js'
ORT='/ort/ort-wasm-simd-threaded.jsep.mjs'


def classify(urls):
    rows=[];origins=set()
    for value in urls:
        parsed=urlsplit(value)
        safe=not parsed.query and not parsed.fragment and '\\' not in value
        if parsed.netloc:
            safe=safe and parsed.scheme=='http' and parsed.hostname in ('127.0.0.1','localhost') and parsed.username is None
            origins.add((parsed.scheme,parsed.netloc))
        else: safe=safe and value.startswith('/')
        kind='productAcousticWorker' if safe and parsed.path==PRODUCT else 'ortRuntimeWorker' if safe and parsed.path==ORT else 'unexpectedWorker'
        rows.append({'url':value,'pathname':parsed.path,'classification':kind})
    if len(origins)>1:
        for row in rows: row['classification']='unexpectedWorker'
    return {'product':sum(r['classification']=='productAcousticWorker' for r in rows),
        'ort':sum(r['classification']=='ortRuntimeWorker' for r in rows),
        'unexpected':sum(r['classification']=='unexpectedWorker' for r in rows),'total':len(rows),'events':rows}


def ownership(counts,constructions,sessions,model_loads):
    if counts['product']>1 or constructions>1: return 'STEP_WAITING_H50_STAGE_A_SECOND_PRODUCT_ACOUSTIC_WORKER_CONFIRMED'
    if sessions>1 or model_loads>1: return 'STEP_WAITING_H50_STAGE_A_SECOND_MODEL_SESSION_CONFIRMED'
    if counts['unexpected']: return 'STEP_WAITING_H50_STAGE_A_UNEXPECTED_WORKER_TOPOLOGY'
    return 'PASS' if counts['product']==constructions==sessions==model_loads==1 else 'OWNERSHIP_NOT_ESTABLISHED'
