import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'../../../..');
test('the single frozen width is 50ms; no alternative budget is executable in this phase',()=>{
 const c=JSON.parse(readFileSync(path.join(ROOT,'backend/research/step_waiting_attempt_v2/contract.json')));
 assert.equal(c.STEP_ACOUSTIC_GESTURE_WIDTH_MS,50);assert.equal(c.model.sha256,'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3');
 assert.equal(c.model.automaticFallback,false);
});
test('old copied Continuous runners are archived exact, with no forwarding entrypoints',()=>{
 const manifest=JSON.parse(readFileSync(path.join(ROOT,'backend/research/history/continuous-browser-runners-before-canonical-v1/manifest.json')));
 assert.equal(manifest.files.length,12);
 for(const f of manifest.files){const bytes=readFileSync(path.join(ROOT,f.path));assert.equal(bytes.length,f.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.equal(existsSync(path.join(ROOT,f.originalPath)),false);}
 const runner=readFileSync(path.join(ROOT,'apps/customer-web/scripts/qualification/continuous-regression.mjs'),'utf8');
 assert.match(runner,/export async function runEngineering/);assert.match(runner,/export async function runMusical/);
 const wrapper=readFileSync(path.join(ROOT,'apps/customer-web/scripts/step-waiting-attempt-v2/regression.mjs'),'utf8');
 assert.doesNotMatch(wrapper,/chromium\.launch|createServer|page\.evaluate/);
});
test('qualification jobs disclose source chronology only, no MIDI or target labels',()=>{
 const data=JSON.parse(readFileSync(path.join(ROOT,'backend/data/work/step_waiting_attempt_v2/v2/audio_only/jobs.json')));
 assert.equal(data.jobs.length,30);
 for(const job of data.jobs){assert.ok([44100,48000].includes(job.rate));assert.ok(job.regionStartSourceSample>job.sourceOriginSample);
  for(const key of Object.keys(job))assert.doesNotMatch(key,/pitch|midi|truth|family|target/i);}
});
test('source-disjoint metadata audit is fixed before any acoustic output',()=>{
 const audit=JSON.parse(readFileSync(path.join(ROOT,'backend/data/work/step_waiting_attempt_v2/v2/metadata-audit.json')));
 assert.equal(audit.sourceDisjoint,true);assert.equal(audit.acousticOutputOpened,false);assert.deepEqual(audit.missingFamilies,[]);
 const excluded=new Set(audit.excludedSources.map(s=>s.recordingId));for(const id of audit.selectedSourceIds)assert.equal(excluded.has(id),false);
});
