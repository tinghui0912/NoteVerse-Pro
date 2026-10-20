import assert from 'node:assert/strict';
import { bytes,load,save,OUT,DIR,START,git,now,zero } from './io.mjs';
import { scope,bundles,inputs,verify } from './audit.mjs';

const mode=process.argv[2]??'pre',tests=[];
const test=async(name,fn)=>{await fn();tests.push({name,result:'LOCAL_PASS'});};
if(mode==='pre'){
  await test('exact starting HEAD, accepted evidence hashes and only allowed production changes',async()=>{
    await scope();assert.equal(git('rev-parse','HEAD'),START);assert.equal(git('rev-parse','origin/codex/customer-web-delivery-boundary'),START);
  });
  const built=await bundles();
  await test('emitted assembler graph contains only production assembler and source/sample timebase',()=>{
    const b=built.find(b=>b.name==='assembler');assert.equal(b.graph.length,3);
    assert.ok(!b.graph.some(p=>/artifact|step-runtime|decoder|research\/step_waiting/.test(p)));
  });
  await test('replay graph reaches actual runtime v6, not historical assembly or acoustic executors',()=>{
    const b=built.find(b=>b.name==='domain');assert.ok(b.graph.some(p=>p.endsWith('/step-runtime.ts')));
    assert.ok(b.graph.some(p=>p.endsWith('/step-acoustic-attempt-assembler.ts')));
    assert.ok(!b.graph.some(p=>/model-inference|onnxruntime|source-analysis-runtime|assembly\.ts|decoder/.test(p)));
  });
  await test('all frontier envelopes are uniquely derived from immutable source origin and unchanged window geometry',async()=>{
    const jobs=(await load(inputs.acoustic)).trace.results,meta=(await load(inputs.windows)).windows,preservation=(await load(inputs.preservation)).results;
    for(const job of jobs){
      const windows=meta.filter(w=>w.jobId===job.jobId),source=preservation.find(j=>j.jobId===job.jobId);assert.ok(source);
      assert.equal(windows.length,job.publications.length);assert.equal(windows[0].sourceOriginSample,source.sourceOriginSample);
      let previous=-Infinity;
      for(const [i,p]of job.publications.entries()){
        assert.deepEqual(p.window,windows[i].runtimeWindow);assert.equal(p.sourceSampleRateHz,windows[i].sourceRateHz);
        const frontier=source.sourceOriginSample+p.window.ownedEndTarget*p.sourceSampleRateHz/16000;
        assert.ok(Number.isFinite(frontier)&&frontier>=previous);
        for(const o of p.observations)assert.ok(o.sourceEventSample>=previous&&o.sourceEventSample<frontier);
        previous=frontier;
      }
    }
  });
  await test('expected current baseline is V7 600/170 lineage and all 34 frozen attempts remain present',async()=>{
    const v15=await load(inputs.v15),v18=await load(inputs.v18);assert.equal(v15.cells.flatMap(c=>c.traces).length,34);
    assert.equal(v18.rows.length,34);assert.equal(v18.cells.length,22);
    assert.ok(Object.values(inputs).every(p=>!p.includes('robust_geometry_v23')));
  });
  await test('only ordinary EVIDENCE is forwarded after assembly; historical answers never choose evidence kind',async()=>{
    const source=(await bytes(DIR+'/replay.mjs')).toString();
    assert.ok(source.includes('h.owner.completeAttempt(pending.identity,pending.evidence)'));
    assert.ok(!source.includes("kind:'RETRY'")&&!source.includes('decodeRobustPiano')&&!source.includes('new WaitingTopologyGate'));
  });
  await test('MIDI/controller/hook/runtime v6/Continuous production bytes are unchanged',()=>{
    const changed=git('diff','--name-only',START,'--','apps/customer-web/src').split('\n');
    assert.ok(changed.every(p=>!p||p.endsWith('/source-publication.ts')||p.endsWith('/step-architecture.test.ts')));
  });
  await save(OUT+'/preflight-tests.json',{completedAt:now(),tests,count:tests.length,result:'LOCAL_PASS',zero});
}else{
  await verify();
  await test('34 complete assembly comparisons, row verdicts and domain source samples preserved',async()=>{
    const r=await load(OUT+'/migration-replay-results.json'),freeze=await load(OUT+'/migration-protocol-freeze.json');
    assert.equal(r.rows.length,34);assert.equal(r.assembliesChecked,34);assert.equal(r.semanticAssemblyDifferences.length,0);
    assert.deepEqual(r.verdicts,freeze.contract.verdictParity);assert.deepEqual(r.classifications,freeze.contract.physicalClassificationParity);
    assert.deepEqual(r.zero,zero);assert.equal(r.externalP2Executions,0);
    for(const row of r.rows){assert.equal(row.submittedEvidence.kind,'EVIDENCE');assert.equal(row.assemblyParity,true);
      assert.equal(row.record.captureEndSessionTime.sampleIndex,row.assembly.endSourceSample);
      assert.equal(row.identity.attemptStartSessionTime.sampleIndex,row.assembly.anchorSourceSample);
      assert.equal(row.domainTrace.postVerdict.step.attemptState,'POST_VERDICT');}
    assert.ok(r.proof.remoteVerifiedAt<r.startedAt);
  });
  await save(OUT+'/post-replay-tests.json',{completedAt:now(),tests,result:'LOCAL_PASS',zero,productReplayReruns:0});
}
console.log(JSON.stringify({mode,tests:tests.length,result:'LOCAL_PASS',zero}));
