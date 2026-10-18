"""Filename-only historical identity references; never returns acoustic content."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'backend/research/reports/step_waiting_h50_holdout_v3'
data = json.loads((OUT/'source-inventory.json').read_text(encoding='utf-8'))
rows = []
for source in data['recordings']:
    if not source['primaryEligible']:
        continue
    ident = source['recordingId']
    patterns = [ident,source['audio']['sha256']]
    if ident.lower().endswith('.wav'):
        patterns.append(ident[:-4])
    args = ['rg','--files-with-matches','--no-ignore','--ignore-case','--fixed-strings']
    for pattern in patterns:
        args.extend(['-e',pattern])
    args.extend(['backend/research/reports','backend/data/work','-g','*.json','-g','*.jsonl','-g','*.md','-g','*.txt',
                 '-g','!source-inventory*.json','-g','!prior-reference-index.json'])
    result = subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    if result.returncode not in (0,1):
        raise RuntimeError('REFERENCE_PROBE_FAILED:'+result.stderr)
    paths = sorted({line.replace('\\','/') for line in result.stdout.splitlines()
                    if '/step_waiting_h50_holdout_v3/' not in line})
    rows.append({'recordingId':ident,'audioSha256':source['audio']['sha256'],'referencePaths':paths})
result = {'role':'METADATA_IDENTITY_REFERENCE_PATHS_ONLY_NOT_ACOUSTIC_OUTPUT',
          'roots':['backend/research/reports','backend/data/work'],
          'candidateMidiEventsParsed':False,'acousticValuesReturned':False,'rows':rows}
with (OUT/'prior-reference-index.json').open('x',encoding='utf-8',newline='\n') as stream:
    json.dump(result,stream,indent=2);stream.write('\n')
for row in rows:
    print(json.dumps({'recordingId':row['recordingId'],'referencePaths':row['referencePaths']}))
