import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT,DIR,OUT,START,bytes,load,save,hash,now,git } from './io.mjs';
import { scope,baseline,graphGate,verify } from './control.mjs';
import { assertInventory,decodeLE,encodeLE,PAIR_BYTES,TENSOR_BYTES,CORPUS_BYTES } from './wire.mjs';
import { verifyRows,recompute } from '../robust_signed_zero_v22/recompute.mjs';
import { equalEvidence,normalizeSignedZero } from '../robust_signed_zero_v22/numeric.mjs';

const mode=process.argv[2]??'pre',tests=[];
const test=async(name,fn)=>{await fn();tests.push({name,status:'LOCAL_PASS'});};
try{
  await test('exact branch/start ancestry; only V23 changes, production/history unchanged',scope);
  if(mode==='pre'){
    await test('starting local and remote HEAD exact with no ahead/behind',()=>{
      assert.equal(git('rev-parse','HEAD'),START);assert.equal(git('rev-parse','origin/codex/customer-web-delivery-boundary'),START);
      assert.equal(git('rev-list','--left-right','--count','HEAD...origin/codex/customer-web-delivery-boundary'),'0\t0');
    });
    const config=await load(DIR+'/stage-a-config.json'),manifest=await load(OUT+'/inputs.json'),receipt=await load(OUT+'/input-preservation.json');
    const graphs=(await load(OUT+'/bundle-graphs.json')).graphs;
    await test('one fixed geometry candidate, no alternate thresholds or geometry roster',async()=>{
      const c=await load(DIR+'/contract.json');assert.equal(c.candidate,'ROBUST_A_600_120_O030_F005_V23_EXPOSED');
      assert.deepEqual(config.geometry,{ownedMs:600,pastMs:1100,futureMs:120});
      assert.equal(c.onsetThreshold,.30);assert.equal(c.frameThreshold,.05);assert.equal(c.baselineNeuralRuns,0);
    });
    await test('exact 9/18/228 inventory, both rates, every input hash finite Float32 count and readback',async()=>{
      assertInventory(manifest);let inputs=0;
      for(const j of manifest.jobs){
        const b=await bytes(j.inputBlobPath);assert.equal(hash(b),j.inputBlobSha256);
        for(const w of j.windows){const pcm=b.subarray(w.inputByteOffset,w.inputByteOffset+w.inputBytes);
          assert.equal(decodeLE(pcm).length,29120);assert.equal(hash(pcm),w.inputSha256);assert.equal(w.runtimeWindow.endSample-w.runtimeWindow.startSample,29120);inputs++;}
      }
      assert.equal(inputs,228);assert.equal(receipt.baselineAdapterInputMismatches,0);
      assert.equal(new Set(manifest.jobs.map(j=>j.sourceCaseId)).size,9);
    });
    await test('ordinary slots 1100/600/120; partial slots full real 1820; no padding and unchanged source projection',()=>{
      let full=0,partial=0;
      for(const i of receipt.inputs){
        const w=i.runtimeWindow;assert.equal(i.paddingSamples,0);assert.equal(i.realContext,true);
        assert.equal(w.endSample,Math.round(w.ownedEndTarget+120*16));assert.equal(w.startSample,w.endSample-29120);
        assert.ok(Math.abs(i.futureQuantizationSamples)<=.5,'EXACT_PRODUCTION_NEAREST_SAMPLE_RULE');
        if(i.ownedMs===600){full++;assert.equal(i.effectivePastMs,1100);assert.equal(i.futureMs,120);}else{partial++;assert.ok(i.ownedMs<600);}
        const j=manifest.jobs.find(j=>j.jobId===i.jobId);
        assert.equal(i.sourceInputStart,j.sourceOriginSample+w.startSample*i.sourceRateHz/16000);
        assert.equal(i.sourceInputEnd,j.sourceOriginSample+w.endSample*i.sourceRateHz/16000);
      }
      assert.ok(full>0&&partial>0);assert.equal(full+partial,228);
    });
    await test('actual preparation geometry function preserves full/partial ownership with real-length windows',async()=>{
      const g=receipt.preparationGraph;assert.equal(hash(await bytes(g.path)),g.sha256);
      const {candidateWindow}=await import(pathToFileURL(path.join(ROOT,g.path)).href);
      for(const ownedEndTarget of [28800,23000,23000.25]){
        const old={jobIndex:0,regionIndex:0,windowIndex:0,ownedStartTarget:19200,ownedEndTarget,startSample:0,endSample:0};
        const got=candidateWindow(old);assert.equal(got.ownedEndTarget,ownedEndTarget);assert.equal(got.ownedStartTarget,19200);
        assert.equal(got.endSample,Math.round(ownedEndTarget+1920));assert.equal(got.endSample-got.startSample,29120);
      }
    });
    await test('V20/V22 exact baseline identities and target denominator independently verified without runtime',async()=>{await baseline();});
    await test('frozen source graph isolation: capture raw only, no decoder/truth/runtime; noncapture zero neural',()=>{
      for(const g of graphs)graphGate(g.inputs,g.phase);
    });
    const require=createRequire(path.join(ROOT,'apps/customer-web/package.json')),ts=require('typescript');
    function calls(source){
      const ast=ts.createSourceFile('audit.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(ast.parseDiagnostics.length,0);
      const result=[];function visit(n){if(ts.isCallExpression(n)||ts.isNewExpression(n))result.push(n);ts.forEachChild(n,visit);}visit(ast);return {ast,result};
    }
    await test('structural one owner Worker, one model create and one guarded run path; no warmup',async()=>{
      const entry=calls((await bytes(DIR+'/capture-entry.mjs')).toString()),worker=calls((await bytes(DIR+'/capture-worker.mjs')).toString());
      assert.equal(entry.result.filter(n=>ts.isNewExpression(n)&&n.expression.getText(entry.ast)==='Worker').length,1);
      assert.equal(worker.result.filter(n=>n.expression.getText(worker.ast)==='ort.InferenceSession.create').length,1);
      assert.equal(worker.result.filter(n=>n.expression.getText(worker.ast)==='session.run').length,1);
      assert.ok((await bytes(DIR+'/capture-worker.mjs')).toString().includes('runs >= 228'));
      assert.ok((await bytes(DIR+'/capture-entry.mjs')).toString().includes("call('RUN'"));
    });
    await test('structural single production decoder call, literal .30/.05 only; metadata not a call',async()=>{
      const parsed=calls((await bytes(DIR+'/stage-b.mjs')).toString());
      const nodes=parsed.result.filter(n=>n.expression.getText(parsed.ast)==='decodeRobustPiano');assert.equal(nodes.length,1);
      assert.deepEqual(nodes[0].arguments[2].properties.map(p=>[p.name.getText(parsed.ast),Number(p.initializer.text)]),[['onsetThreshold',.30],['frameThreshold',.05]]);
      assert.ok(!(await bytes(DIR+'/stage-b.mjs')).toString().includes("kind:'RETRY'"));
    });
    await test('exact model/ORT asset hashes and no fallback contract',async()=>{
      assert.equal(config.ORT,'1.20.1');assert.equal(config.provider,'webgpu');assert.equal(config.automaticFallback,false);
      assert.equal(config.graphOptimizationLevel,'disabled');
      for(const a of Object.values(config.assets)){const b=await bytes(a.path);assert.equal(hash(b),a.sha256);assert.equal(b.length,a.bytes);}
      assert.equal(config.assets['/model.onnx'].sha256,'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3');
    });
    await test('LE Float32 serialization and output arithmetic from shape, finite rejection',()=>{
      const data=new Float32Array([.125,-.5]);assert.deepEqual(decodeLE(encodeLE(data)),data);
      assert.throws(()=>encodeLE(new Float32Array([NaN])));assert.equal(TENSOR_BYTES,1*183*88*Float32Array.BYTES_PER_ELEMENT);
      assert.equal(PAIR_BYTES,TENSOR_BYTES*2);assert.equal(CORPUS_BYTES,228*PAIR_BYTES);
    });
    await test('meaningful recovery recurrence requires both rates, two gestures and recordings',()=>{
      const make=(id,rate,recovered)=>({rowId:id+rate,recordingId:id,physicalGestureId:id,rate,physicalTruth:[60],expected:[60],acousticObserved:recovered?[60]:[60,64],
        productRecord:{verdict:recovered?'MATCH':'RETRY'},classification:recovered?'SAFE_MATCH':'SUPPORTED_RETRY',physicalTargetSupported:true});
      const b=['a','b'].flatMap(id=>[44100,48000].map(rate=>make(id,rate,false))),c=['a','b'].flatMap(id=>[44100,48000].map(rate=>make(id,rate,true)));
      assert.equal(recompute(c,b,{profileId:'synthetic',gridStepDistance:0}).meaningful,true);
      assert.equal(recompute(c.map((r,i)=>i===3?b[i]:r),b,{profileId:'synthetic',gridStepDistance:0}).meaningful,false);
    });
    await save(OUT+'/pre-execution-tests.json',{completedAt:now(),status:'LOCAL_PASS',tests,count:tests.length,neuralRuns:0,modelSessionLoads:0});
  }else{
    await verify();
    await test('all 228 candidate raw pairs and subhashes/readback exact, one session no extras',async()=>{
      const m=await load(OUT+'/tensor-corpus-manifest.json');assert.equal(m.failure,null);assert.equal(m.blobs.length,18);assert.equal(m.windows.length,228);
      assert.equal(m.receipt.modelSessionLoads,1);assert.equal(m.receipt.attemptedSessionRuns,228);assert.equal(m.receipt.successfulSessionRuns,228);
      assert.equal(m.receipt.decoderRuns,0);assert.equal(m.receipt.truthAccessCount,0);assert.equal(m.receipt.unknownRuns,0);
      for(const b of m.blobs){const data=await bytes(b.path);assert.equal(hash(data),b.sha256);
        for(const w of m.windows.filter(w=>w.jobId===b.jobId)){const pair=data.subarray(w.byteOffset,w.byteOffset+PAIR_BYTES);assert.equal(hash(pair),w.pairSha256);
          assert.equal(hash(pair.subarray(0,TENSOR_BYTES)),w.onsetSha256);assert.equal(hash(pair.subarray(TENSOR_BYTES)),w.frameSha256);assert.equal(w.readbackSha256,w.pairSha256);decodeLE(pair);}}
      assert.equal(m.blobs.reduce((n,b)=>n+b.bytes,0),CORPUS_BYTES);
    });
    if(mode==='post-b')await test('candidate-only .30/.05 decoder count, schema6 EVIDENCE records, fixed denominator and recomputed classifications/gates',async()=>{
      const r=await load(OUT+'/geometry-results.json'),b=await baseline();
      assert.equal(r.stageB.decoderARuns,228);assert.equal(r.stageB.neuralRuns,0);assert.equal(r.stageB.alternativeThresholdDecoderRuns,0);
      assert.equal(r.rows.length,34);assert.equal(r.result.targetViews.length,26);verifyRows(r.rows,equalEvidence);
      equalEvidence(normalizeSignedZero(recompute(r.rows,b.rows,{profileId:r.candidate,gridStepDistance:0})),r.result,'CANDIDATE_ARITHMETIC_REPRODUCTION');
      for(const row of r.rows)if(row.productRecord){assert.equal(row.submittedEvidence.kind,'EVIDENCE');assert.equal(row.domainTrace.ready.version.schemaVersion,6);}
      assert.ok(r.rawRemoteProof.remoteVerifiedAt<r.startedAt);assert.equal(r.productionChanged,false);
    });
    await save(OUT+'/'+mode+'-tests.json',{completedAt:now(),status:'LOCAL_PASS',tests,count:tests.length,neuralRuns:0,decoderRuns:0,productRuntimeRuns:0});
  }
  console.log(JSON.stringify({mode,tests:tests.length,status:'LOCAL_PASS'}));
}catch(error){
  await save(OUT+'/tests-failure.json',{failedAt:now(),mode,tests,failure:String(error.stack??error),disposition:'ROBUST_V23_GEOMETRY_STUDY_INTEGRITY_BLOCKED',rerunAllowed:false});throw error;
}
