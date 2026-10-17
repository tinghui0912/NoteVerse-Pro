import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'../../../..'),read=p=>JSON.parse(readFileSync(path.join(ROOT,p)));
test('fixed50 contract separates READY recognition from suppression without retuning',()=>{
 const c=read('backend/research/step_waiting_topology_v3/contract.json');assert.equal(c.gestureWidthMs,50);assert.equal(c.readyTopologies.length,6);
 assert.equal(c.model.sha256,'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3');assert.equal(c.model.automaticFallback,false);
 assert.equal(c.retry,'RETRY_CLASSIFIER_NOT_IMPLEMENTED');
});
test('each metadata topology has two independent recordings; core occurrences are not reused',()=>{
 const i=read('backend/data/work/step_waiting_topology_v3/metadata-v4/inventory.json'),c=read('backend/research/step_waiting_topology_v3/contract.json'),used=new Set();
 assert.deepEqual(i.missing,[]);assert.equal(i.acousticOutputsOpened,false);
 for(const k of c.readyTopologies.concat(c.negativeTopologies)){
  const cases=i.selections[k];assert.equal(cases.length,2);assert.equal(new Set(cases.map(x=>x.source.recordingId)).size,2);
  for(const x of cases){const key=x.source.recordingId+':'+(x.case.groupIndex??'guard'+x.case.guardIndex);assert.equal(used.has(key),false);used.add(key);}
 }
 const ids=new Set(i.excludedReceipts.map(s=>s.recordingId)),audio=new Set(i.excludedReceipts.map(s=>s.audioSha256)),midi=new Set(i.excludedReceipts.map(s=>s.midiSha256));
 for(const cases of Object.values(i.selections))for(const x of cases){assert.equal(ids.has(x.source.recordingId),false);assert.equal(audio.has(x.source.audioSha256),false);assert.equal(midi.has(x.source.midiSha256),false);}
 assert.equal(i.contractSha256,createHash('sha256').update(readFileSync(path.join(ROOT,'backend/research/step_waiting_topology_v3/contract.json'))).digest('hex'));
});
test('canonical Continuous runner is reused directly, not forked per phase',()=>{
 const text=readFileSync(path.join(ROOT,'apps/customer-web/scripts/step-waiting-topology-v3/regression.mjs'),'utf8');
 assert.match(text,/qualification\/continuous-regression/);assert.doesNotMatch(text,/chromium|createServer|page\.evaluate/);
});
