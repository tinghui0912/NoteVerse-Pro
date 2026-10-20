"""Audio-only Stage A: execute the original historical baseline unchanged via AST."""
import ast
from collections import deque
from dataclasses import dataclass
import hashlib
import json
import sys
import types
import numpy as np
from audit import ROOT, WORK, save

def historical_types():
    path = ROOT/'backend/research/tools/retired/evaluate_causal_physical_strike_trigger.py.txt'
    tree = ast.parse(path.read_text())
    names = {'StrikeCandidate','FrameTrace','DetectorConfig','CausalPcmStrikeDetector','_median_or_zero','_rms_history_stats'}
    selected = [node for node in tree.body if isinstance(node,(ast.ClassDef,ast.FunctionDef)) and node.name in names]
    assert {node.name for node in selected} == names
    module = types.ModuleType('unchanged_historical_detector')
    module.__dict__.update({'np':np,'deque':deque,'dataclass':dataclass})
    sys.modules[module.__name__] = module
    exec(compile(ast.Module(body=selected,type_ignores=[]),str(path),'exec'),module.__dict__)
    return module

def main():
    proof = json.loads((WORK/'development/baselineExecutionProof.json').read_text())
    file = WORK/'development/browser.json'
    seal = json.loads((WORK/'development/browser-seal.json').read_text())
    assert hashlib.sha256(file.read_bytes()).hexdigest() == seal['sha256']
    browser = json.loads(file.read_text())
    assert browser['status'] == 'AUDIO_ONLY_BROWSER_EXECUTION_SEALED'
    jobs = {(j['id'],j['rate']):j for j in json.loads((WORK/'development/audio_only/jobs.json').read_text())['jobs']}
    module = historical_types()
    results = []
    for cell in browser['result']['results']:
        job = jobs[(cell['id'],cell['rate'])]
        raw = (ROOT/cell['baselinePcm']['path']).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == cell['baselinePcm']['sha256']
        pcm = np.frombuffer(raw,dtype='<f4')
        detector = module.CausalPcmStrikeDetector()
        for start in range(0,len(pcm),683): detector.ingest(pcm[start:start+683])
        tokens = []
        for c in detector.candidates:
            if not job['ownedStartTarget'] <= c.candidate_anchor_sample < job['ownedStartTarget']+job['ownedSamples']: continue
            tokens.append({'candidateId':f"{job['sourceDomainId']}:historical:{c.candidate_anchor_sample}",
                'sourceDomainId':job['sourceDomainId'],'detectorIdentity':'historical',
                'sourceAnchorSample':job['sourceOriginSample']+c.candidate_anchor_sample*job['rate']/16000,
                'evidenceAvailableThroughSourceSample':job['sourceOriginSample']+int(np.ceil(c.candidate_emit_sample*job['rate']/16000))+(28 if job['rate']==44100 else 30)})
        results.append({'id':job['id'],'rate':job['rate'],'tokens':tokens})
    baseline_path = WORK/'development/baseline.json'
    save(baseline_path,{**proof,'developmentExecutionProof':proof,'results':results,
        'historicalSourceSha256':hashlib.sha256((ROOT/'backend/research/tools/retired/evaluate_causal_physical_strike_trigger.py.txt').read_bytes()).hexdigest(),
        'extraction':'unchanged AST nodes only; unavailable external benchmark helper imports excluded',
        'config':module.DetectorConfig().__dict__,'newNeuralRuns':0,'truthRead':False})
    save(WORK/'development/candidate-stream-seal.json',{**proof,'sealedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        'files':[{'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [file,baseline_path]],
        'truthOpenedByStageA':False})
    print(json.dumps({'baselineCells':len(results),'truthRead':False}))

if __name__ == '__main__': main()
