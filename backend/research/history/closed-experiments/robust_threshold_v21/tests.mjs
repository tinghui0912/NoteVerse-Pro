import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, DIR, OUT, V20, load, bytes, save, hash, canonical, zero, now, decodeLE } from './io.mjs';
import { profiles, onset, frame, CONTROL } from './profiles.mjs';
import { foundation } from './foundation.mjs';
import { physicalKey, viewKey, covers, classify, uniqueViews, evaluate, rank } from './metrics.mjs';
import { bundles, plan, scope, verify } from './control.mjs';

const tests = [], test = async (name, fn) => { await fn(); tests.push({ name, status: 'LOCAL_PASS' }); };
const mode = process.argv[2] ?? 'preflight';
if (mode === 'preflight') {
  await test('production and historical tracked scope unchanged', scope);
  await test('exact 20 immutable historical grid profiles, order, IDs and control', () => {
    assert.deepEqual(onset, [.15,.20,.25,.30,.35]); assert.deepEqual(frame, [.05,.10,.15,.20]);
    assert.equal(profiles.length, 20); assert.equal(new Set(profiles.map(p => p.profileId)).size, 20);
    assert.equal(profiles[0].profileId, 'ROBUST_A_O015_F005'); assert.equal(profiles[19].profileId, 'ROBUST_A_O035_F020');
    assert.equal(profiles.filter(p => p.profileId === CONTROL).length, 1);
    for (const p of profiles) assert.deepEqual(p.geometry, { ownedMs: 600, pastMs: 1050, futureMs: 170 });
  });
  await test('all 18 blobs/228 pairs, finite LE values, every hash and canonical identity', async () => { await foundation(); });
  await test('Float32 LE and nonfinite/length rejection', () => {
    const b = Buffer.alloc(64416); b.writeFloatLE(0.125, 0); assert.equal(decodeLE(b)[0], .125);
    b.writeFloatLE(Infinity, 0); assert.throws(() => decodeLE(b)); assert.throws(() => decodeLE(b.subarray(4)));
  });
  const built = await bundles();
  await test('decoder graph production only, no model/session/DSP/runtime/truth reachability', () => {
    const graph = built.find(b => b.name === 'decoder').graph;
    assert.ok(graph.some(p => p.endsWith('/robust-piano-decoder.ts')));
    assert.ok(graph.some(p => p.endsWith('/source-publication.ts')));
    assert.ok(graph.every(p => !/step-runtime|model-inference|onnxruntime|resampler|truth|scenario/.test(p)));
  });
  await test('Stage A parsed imports and one resolved production decoder call with roster thresholds', async () => {
    const require = createRequire(path.join(ROOT, 'apps/customer-web/package.json')), ts = require('typescript');
    const source = (await bytes(DIR + '/stage-a.mjs')).toString();
    const ast = ts.createSourceFile('stage-a.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0);
    let calls = 0; const imports = [];
    function visit(n) {
      if (ts.isImportDeclaration(n)) imports.push(n.moduleSpecifier.text);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'decodeRobustPiano') {
        calls++; const argument = n.arguments[2]; assert.ok(ts.isObjectLiteralExpression(argument));
        assert.deepEqual(argument.properties.map(p => [p.name.getText(ast), p.initializer.getText(ast)]),
          [['onsetThreshold','profile.onsetThreshold'],['frameThreshold','profile.frameThreshold']]);
      }
      ts.forEachChild(n, visit);
    }
    visit(ast); assert.equal(calls, 1);
    assert.deepEqual(imports.filter(p => p.startsWith('.')).sort(), ['./foundation.mjs','./io.mjs','./profiles.mjs']);
    assert.ok(!source.includes('./domain') && !source.includes('./metrics') && !source.includes('./control'));
  });
  const p = await plan();
  await test('34 fixed rows, observation-independent physical and target view dedup', () => {
    assert.equal(p.rows.length, 34); assert.equal(p.physicalUnits.length, 18); assert.equal(p.rateIgnoredPhysicalGestures.length, 9);
    assert.equal(p.targetViewIds.length, 26);
    const a = p.rows[0]; assert.equal(physicalKey(a), physicalKey({ ...a, acousticObserved: [1,2] }));
    assert.equal(viewKey(a), viewKey({ ...a, acousticObserved: [] }));
    assert.notEqual(viewKey(a), viewKey({ ...a, expected: [0] }));
    assert.notEqual(physicalKey(a), physicalKey({ ...a, rate: a.rate === 44100 ? 48000 : 44100 }));
  });
  await test('baseline safe and hallucination view identities are fixed before alternative decode', () => {
    assert.equal(p.baselineUnsupportedCoveredViewIds.length, 2);
    assert.equal(p.baselineSafeMatchViewIds.length, 6);
    assert.ok(p.baselineOracleViews.every(v => v.multiplicity === v.rowIds.length));
  });
  const d = await import(pathToFileURL(path.join(ROOT, built.find(b => b.name === 'domain').path)).href);
  const observation = (sample, midi) => ({ observationId: `o:${sample}:${midi}`, sourceEventSample: sample,
    pitch: d.pitch(midi), midiPitch: midi, confidence: .8, sourceDomainId: 's', sourceSampleRateHz: 48000, targetSample: sample / 3 });
  await test('actual H50 first strict event, half-open right edge, no target-conditioned extension', () => {
    assert.equal(d.GESTURE_WIDTH_MS, 50);
    const g = new d.WaitingTopologyGate(48000, 't', 0, 10000, 1, 0); g.arm(0, 0);
    g.accept({ publicationId:'p', frontier:5000, capturedThrough:0, wallMs:0,
      observations:[observation(0,1),observation(1,60),observation(2400,64),observation(2401,67)] });
    const a = g.actions.find(a => a.type === 'SEAL').attempt;
    assert.equal(a.anchor, 1); assert.equal(a.end, 2401); assert.deepEqual(a.observations.map(o => o.midiPitch), [60,64]);
  });
  await test('runtime v6 EVIDENCE-only policy, record preservation, POST_VERDICT, strict rearm and final MATCH commit', () => {
    for (const [observed, verdict] of [[[56,64],'MATCH'],[[52,56,64,68],'RETRY'],[[56],'MISMATCH']]) {
      const h = d.runtime([[56,64]], 'synthetic:' + verdict);
      h.owner.setInputUnavailable(); h.owner.acceptInputAfter(h.time(100));
      const generation = h.owner.snapshot().step.targetGeneration;
      assert.equal(h.owner.snapshot().version.schemaVersion, 6);
      assert.equal(h.owner.verdictPolicy, 'MICROPHONE_CONSERVATIVE_TRISTATE');
      assert.equal(h.owner.openAttempt(h.time(100)), null);
      h.clock.set(101); const id = h.owner.openAttempt(h.time(101)); assert.ok(id); assert.ok(h.owner.analyzeAttempt(id));
      const r = h.owner.completeAttempt(id, { kind:'EVIDENCE', observedAttackPitches:observed.map(d.pitch), confidence:.8, captureEndSessionTime:h.time(151) });
      assert.equal(r.kind, 'FINALIZED'); assert.equal(r.record.verdict, verdict); assert.equal(r.record.confidence,.8);
      assert.equal(r.record.observedAttackPitches.length, observed.length); assert.equal(h.owner.snapshot().step.attemptState,'POST_VERDICT');
      assert.equal(h.owner.snapshot().step.targetGeneration,generation); assert.equal(h.owner.openAttempt(h.time(200)),null);
      h.clock.set(300); h.owner.rearm(h.time(300));
      assert.equal(h.owner.snapshot().step.targetGeneration,generation + (verdict === 'MATCH' ? 1 : 0));
      assert.equal(h.owner.openAttempt(h.time(299)),null); assert.equal(h.owner.openAttempt(h.time(300)),null);
    }
  });
  await test('physical support and NO_ATTEMPT are independent of acoustic truth and no pseudo-verdict', () => {
    assert.equal(covers([56,64],[52,56]),false); assert.equal(classify('MATCH',false),'DANGEROUS_FALSE_MATCH');
    assert.equal(classify(null,true),'SUPPORTED_NO_ATTEMPT'); assert.equal(classify(null,false),'UNSUPPORTED_NO_ATTEMPT');
  });
  await test('hallucination identity subset, not count-only; recall and safe baseline regression gates', () => {
    const make = (name, supported, cls, o) => ({ rowId:name, recordingId:name, physicalGestureId:name, rate:44100,
      physicalTruth:supported ? [60] : [61], expected:[60], acousticObserved:o, classification:cls, physicalTargetSupported:supported,
      productRecord:{verdict:cls.endsWith('RETRY')?'RETRY':cls === 'TRUE_REJECT'?'MISMATCH':'MATCH'} });
    const base = [make('a',false,'UNSUPPORTED_RETRY',[60,61]),make('b',false,'TRUE_REJECT',[61]),make('c',true,'SAFE_MATCH',[60])];
    const changed = [make('a',false,'TRUE_REJECT',[61]),make('b',false,'UNSUPPORTED_RETRY',[60,61]),make('c',true,'SUPPORTED_RETRY',[60,61])];
    const r = evaluate(changed,base,profiles[0]); assert.equal(r.newUnsupportedCoveredViewIds.length,1);
    assert.equal(r.baselineSafeMatchRegressions.length,1); assert.equal(r.eligibility,'INELIGIBLE');
    assert.equal(uniqueViews([...base,base[0]]).find(r=>r.rowId==='a').multiplicity,2);
  });
  await test('ranking exact lexicographic order, recurrence and complete ties never arbitrary winner', () => {
    const a = { profileId:'a',meaningful:true,rankingComponents:[2,10,-2,-2,-1] };
    const b = { profileId:'b',meaningful:true,rankingComponents:[3,1,-2,-2,-2] };
    assert.equal(rank([a,b]).selected,'b'); assert.equal(rank([b,a]).selected,'b');
    assert.equal(rank([a,{...a,profileId:'c'}]).selected,null);
    assert.ok(rank([a,{...a,profileId:'c'}]).disposition.includes('MULTIPLE_EQUIVALENT'));
    assert.ok(rank([{...a,meaningful:false}]).disposition.includes('NO_SAFE_USABILITY'));
  });
  await test('recurrence requires same target at both rates and two gestures from two recordings', () => {
    const baselines = [], candidates = [];
    for (const recordingId of ['r1','r2']) for (const rate of [44100,48000]) {
      const r = { rowId:recordingId+rate, recordingId, physicalGestureId:recordingId+':g',rate,
        physicalTruth:[60],expected:[60],physicalTargetSupported:true,acousticObserved:[60,64],
        classification:'SUPPORTED_RETRY', productRecord:{verdict:'RETRY'} };
      baselines.push(r); candidates.push({...r,acousticObserved:[60],classification:'SAFE_MATCH',productRecord:{verdict:'MATCH'}});
    }
    const good=evaluate(candidates,baselines,profiles[0]); assert.equal(good.meaningful,true);
    assert.equal(good.pairedRecoveredPhysicalGestures.length,2);
    const sparse=evaluate(candidates.map((r,i)=>i===3?baselines[i]:r),baselines,profiles[0]);
    assert.equal(sparse.eligibility,'ELIGIBLE'); assert.equal(sparse.meaningful,false);
    assert.equal(sparse.pairedRecoveredPhysicalGestures.length,1);
  });
  await test('Stage B ordinary EVIDENCE only, no external P2 and no decoder call', async () => {
    const b = (await bytes(DIR + '/stage-b.mjs')).toString();
    assert.ok(b.includes("kind: 'EVIDENCE'")); assert.ok(!b.includes("kind: 'RETRY'") && !b.includes('p2(') && !b.includes('decodeRobustPiano('));
    assert.ok(b.includes('NO_ELIGIBLE_ACOUSTIC_GESTURE'));
  });
  await test('blind configuration is separate from truth-bearing protocol freeze', async () => {
    const a=(await bytes(DIR+'/stage-a.mjs')).toString();
    assert.ok(a.includes("load(OUT + '/blind-config.json')"));
    assert.ok(!a.includes("load(OUT + '/protocol-freeze.json')"));
    assert.ok(!a.includes('replay-plan.json'));
  });
  await test('control parity includes exact full observations, ordering, confidence and event diagnostics', async () => {
    const b = await load(V20 + '/baseline-parity.json'); assert.equal(b.jobs.length,18);
    assert.equal(b.mismatches.length,0); assert.equal(b.receipt.baselineDecoderRuns,228);
    assert.equal(b.jobs.reduce((n,j)=>n+j.publications.length,0),228);
  });
  await save(OUT + '/preflight-tests.json', { completedAt:now(), tests, count:tests.length, result:'LOCAL_PASS', zero });
} else {
  await verify();
  await test('remotely frozen Stage A exact 4560 calls, 20 complete profiles, zero neural/truth/product', async () => {
    const s = await load(OUT + '/stage-a-seal.json'); assert.equal(s.decoderCalls,4560); assert.equal(s.artifacts.length,20);
    assert.equal(s.truthAccessCount,0); assert.equal(s.runtimeAccessCount,0); assert.equal(s.productVerdictRuns,0);
    assert.deepEqual(s.zero,zero); assert.equal(s.mismatches.length,0);
    for (const f of s.artifacts) {
      assert.equal(hash(await bytes(f.path)),f.sha256); const a = await load(f.path);
      assert.equal(a.decoderCalls,228); assert.equal(a.jobs.length,18);
      assert.equal(a.jobs.reduce((n,j)=>n+j.publications.length,0),228);
      assert.deepEqual(a.jobHashes,a.jobs.map(j=>({jobId:j.jobId,sha256:hash(canonical(j))})));
    }
  });
  if (mode === 'post-b') await test('Stage B runtime records, fixed denominators, baseline parity, reproducible selection', async () => {
    const r = await load(OUT + '/study-results.json'), plan = await load(OUT + '/replay-plan.json'), all = [];
    assert.equal(r.artifacts.length,20); const seal = await load(OUT + '/remote-stage-a-proof.json');
    assert.ok(seal.remoteVerifiedAt < r.startedAt); assert.equal(r.receipt.StageBDecoderCalls,0);
    let count=0;
    for (const f of r.artifacts) {
      assert.equal(hash(await bytes(f.path)),f.sha256); const a = await load(f.path); all.push(a);
      assert.equal(a.rows.length,34); assert.equal(uniqueViews(a.rows).length,26);
      for (const row of a.rows) {
        assert.equal(row.physicalTargetSupported,covers(row.physicalTruth,row.expected));
        assert.equal(row.classification,classify(row.productRecord?.verdict ?? null,row.physicalTargetSupported));
        if (row.productRecord) { count++; assert.equal(row.submittedEvidence.kind,'EVIDENCE');
          assert.equal(row.domainTrace.ready.version.runtimeVersion,'step-source-sensitive-verdict-v6'); }
      }
    }
    assert.equal(count,r.receipt.productVerdictRuns);
    const baseline=all.find(a=>a.profile.profileId===CONTROL);
    for(const a of all) {
      const again=evaluate(a.rows,baseline.rows,a.profile);
      assert.deepEqual(again.rankingComponents,a.result.rankingComponents); assert.deepEqual(again.reasons,a.result.reasons);
      assert.deepEqual(again.newUnsupportedCoveredViewIds,a.result.newUnsupportedCoveredViewIds);
    }
    for(const row of baseline.rows) assert.equal(row.productRecord.verdict,plan.rows.find(p=>p.rowId===row.rowId).baselineVerdict);
    assert.deepEqual(rank(all.filter(a=>a.profile.profileId!==CONTROL).map(a=>a.result)),r.selection);
  });
  await save(OUT + '/' + mode + '-tests.json', { completedAt:now(), tests, result:'LOCAL_PASS', zero });
}
console.log(JSON.stringify({ mode, tests:tests.length, result:'LOCAL_PASS' }));
