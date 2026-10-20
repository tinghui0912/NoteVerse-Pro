import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { ROOT, DIR, OUT, bytes, save, now, execution } from './io.mjs';
import { canonicalNumericZero, normalizeSignedZero, equalEvidence, compareVectors, vectorsEqual } from './numeric.mjs';
import { statistics, physicalIdentity, targetIdentity, physicalClassification, groupViews, recompute, selection, verifyRows, acousticStatistics } from './recompute.mjs';
import { scope, inventory, roster } from './evidence.mjs';

const passed=[];
async function test(name,body) { await body(); passed.push({name,status:'LOCAL_PASS'}); }
await test('both numeric zero signs become positive zero; conceptual V21 failure is reproduced, not rerun',()=>{
  assert.ok(Object.is(canonicalNumericZero(-0),+0)); assert.ok(Object.is(canonicalNumericZero(+0),+0));
  const control=[+0,6,-2,-8,-0], serialized=JSON.parse(JSON.stringify(control));
  assert.throws(()=>assert.deepStrictEqual(control,serialized)); equalEvidence(control,serialized,'conceptualSignedZeroOnly');
  assert.equal(JSON.stringify(normalizeSignedZero(control)),'[0,6,-2,-8,0]');
});
await test('nonzero integers/fractions retain exact IEEE754 bytes, no rounding or epsilon',()=>{
  for(const value of [1,-1,123456789,-9007199254740991,.1,-.3,Number.MIN_VALUE,Number.MAX_VALUE,1e-300,-1e300]) {
    const before=Buffer.alloc(8),after=Buffer.alloc(8); before.writeDoubleLE(value); after.writeDoubleLE(canonicalNumericZero(value));
    assert.deepEqual(before,after); assert.ok(Object.is(value,canonicalNumericZero(value)));
  }
});
await test('no NaN/Infinity/string coercion; recursion preserves fields and list order',()=>{
  const input={z:-0,a:[0,-0,.25,'0','-0',null,false],extra:{empty:[],number:Infinity,nan:NaN}};
  const output=normalizeSignedZero(input);
  assert.ok(Object.is(input.z,-0)); assert.ok(Object.is(output.z,0));
  assert.deepEqual(Object.keys(input),Object.keys(output)); assert.deepEqual(output.a,[0,0,.25,'0','-0',null,false]);
  assert.equal(output.extra.number,Infinity); assert.ok(Number.isNaN(output.extra.nan));
  assert.equal(canonicalNumericZero(-Infinity),-Infinity); assert.equal(canonicalNumericZero('0'),'0');
  assert.throws(()=>equalEvidence([1,2],[2,1],'listOrder')); assert.throws(()=>equalEvidence({x:0},{},'noFieldOmission'));
  assert.throws(()=>equalEvidence(.1,.10000000000000002,'noTolerance'));
});
await test('comparator and complete ties invariant before/after signed-zero canonicalization',()=>{
  const vectors=[[0,6,-2,-8,-0],[0,6,-2,-8,0],[2,9,-2,-3,-1],[2,9,-1,-3,-2],[1,99,-0,-0,-0]];
  for(const a of vectors) for(const b of vectors) {
    assert.equal(compareVectors(a,b),compareVectors(normalizeSignedZero(a),normalizeSignedZero(b)));
    assert.equal(vectorsEqual(a,b),vectorsEqual(normalizeSignedZero(a),normalizeSignedZero(b)));
  }
  const profiles=vectors.map((rankingComponents,i)=>({profileId:'p'+i,meaningful:true,rankingComponents}));
  equalEvidence(selection(profiles),selection(normalizeSignedZero(profiles)),'syntheticOrdering');
  const tie=selection(profiles.slice(0,2)); assert.equal(tie.selected,null); assert.equal(tie.leaders.length,2);
});
await test('all five lexicographic components and diagnostics-independent ranking retain exact order',()=>{
  const base=[2,6,-2,-8,-3];
  for(let component=0;component<5;component++) {
    const better=[...base]; better[component]+=1;
    const a={profileId:'baseline',meaningful:true,rankingComponents:base,rawExtras:0};
    const b={profileId:'better',meaningful:true,rankingComponents:better,rawExtras:999999};
    assert.equal(selection([a,b]).selected,'better');
    equalEvidence(selection([a,b]),selection(normalizeSignedZero([a,b])),'criterion:'+component);
  }
});

const row=(id,rate,truth,expected,observed,verdict)=>{
  const support=expected.every(p=>truth.includes(p));
  return {rowId:id+':'+rate,recordingId:id,physicalGestureId:id+':g',rate,physicalTruth:truth,expected,acousticObserved:observed,
    physicalTargetSupported:support,classification:physicalClassification(verdict,support),
    productRecord:verdict?{verdict,confidence:.8}:null,submittedEvidence:verdict?{kind:'EVIDENCE',confidence:.8}:null,
    observations:observed.map(midiPitch=>({midiPitch})),domainTrace:{ready:{version:{schemaVersion:6,runtimeVersion:'step-source-sensitive-verdict-v6'}}},
    status:verdict?'RECONSTRUCTED_H50_ATTEMPT':'NO_ELIGIBLE_ACOUSTIC_GESTURE',assembly:verdict?{}:null};
};
await test('physical classification consumes stored verdict and independent physical support only',()=>{
  for(const support of [false,true]) for(const verdict of ['MATCH','RETRY','MISMATCH',null]) {
    assert.equal(typeof physicalClassification(verdict,support),'string');
  }
  assert.equal(physicalClassification('MATCH',false),'DANGEROUS_FALSE_MATCH');
  assert.equal(physicalClassification('RETRY',false),'UNSUPPORTED_RETRY');
  const r=row('r',44100,[64],[60],[60],'MATCH'); assert.equal(r.physicalTargetSupported,false);
  assert.equal(verifyRows([r],equalEvidence)[0].classification,'DANGEROUS_FALSE_MATCH');
  assert.throws(()=>verifyRows([{...r,classification:'SAFE_MATCH'}],equalEvidence));
});
await test('fixed physical/target identity excludes acoustic observations and rates are not recordings',()=>{
  const r=row('r',44100,[64,60],[60],[60,64],'RETRY');
  assert.equal(physicalIdentity(r),physicalIdentity({...r,acousticObserved:[99]}));
  assert.equal(targetIdentity(r),targetIdentity({...r,acousticObserved:[]}));
  assert.notEqual(targetIdentity(r),targetIdentity({...r,expected:[64]}));
  assert.notEqual(physicalIdentity(r),physicalIdentity({...r,rate:48000}));
  assert.equal(physicalIdentity(r,false),physicalIdentity({...r,rate:48000},false));
  assert.equal(groupViews([r,{...r,rowId:'duplicate'}])[0].multiplicity,2);
});
await test('all counters and denominators derived; zero denominator remains null',()=>{
  const a=row('a',44100,[60,64],[60,64],[60,64],'MATCH'), b=row('b',48000,[60,64],[60,64],[60,64,67],'RETRY');
  const s=statistics([a,b]); assert.equal(s.requiredTargetPitchRecall.numerator,4); assert.equal(s.requiredTargetPitchRecall.denominator,4);
  assert.equal(s.classifications.SAFE_MATCH,1); assert.equal(s.classifications.SUPPORTED_RETRY,1);
  assert.equal(statistics([]).safeAutoMatchCoverage.value,null);
  const none=row('n',44100,[60],[60],[],null); assert.equal(statistics([none]).classifications.SUPPORTED_NO_ATTEMPT,1);
});
await test('eligibility preserves every gate; no recovery from unsupported or non-RETRY baseline',()=>{
  const base=[row('a',44100,[60],[60],[60,64],'RETRY'),row('b',44100,[64],[60],[64],'MISMATCH'),row('c',44100,[60],[60],[60],'MATCH')];
  const candidate=[row('a',44100,[60],[60],[60],'MATCH'),row('b',44100,[64],[60],[60],'MATCH'),row('c',44100,[60],[60],[],'MISMATCH')];
  const r=recompute(candidate,base,{profileId:'synthetic',gridStepDistance:1});
  assert.equal(r.newlyRecoveredSafeTargetViewIds.length,1);
  assert.deepEqual(r.reasons,['DANGEROUS_FALSE_MATCH','NEW_UNSUPPORTED_TARGET_HALLUCINATION','REQUIRED_TARGET_RECALL_REGRESSION','BASELINE_SAFE_MATCH_REGRESSION']);
  const unchanged=recompute(base,base,{profileId:'synthetic',gridStepDistance:0});
  assert.deepEqual(unchanged.reasons,['NO_STRICT_SAFE_AUTO_MATCH_IMPROVEMENT']);
});
await test('meaningful recurrence requires same target both rates and two recordings',()=>{
  const baseline=[],candidate=[];
  for(const id of ['a','b']) for(const rate of [44100,48000]) {
    baseline.push(row(id,rate,[60],[60],[60,64],'RETRY')); candidate.push(row(id,rate,[60],[60],[60],'MATCH'));
  }
  const p={profileId:'synthetic',gridStepDistance:1};
  assert.equal(recompute(candidate,baseline,p).meaningful,true);
  const sparse=candidate.map((r,i)=>i===3?baseline[i]:r);
  assert.equal(recompute(sparse,baseline,p).meaningful,false);
  const oneRecording=baseline.map(r=>({...r,recordingId:'one'})), oneCandidate=candidate.map(r=>({...r,recordingId:'one'}));
  assert.equal(recompute(oneCandidate,oneRecording,p).meaningful,false);
});
await test('serialized acoustic diagnostics are arithmetic, never decoder execution or objective',()=>{
  const d=acousticStatistics([{jobId:'j',publications:[{observations:[{},{}]}],rawDerivedEvents:[{events:[{onsetScore:.5,frameScore:.75},{onsetScore:1,frameScore:.25}]}]}]);
  assert.equal(d.totalDecodedEvents,2); assert.equal(d.totalOwnedObservations,2); assert.equal(d.scores.onset.mean,.75);
});
await test('twenty frozen identities, nineteen non-control profiles; no control nomination',async()=>{
  const definitions=JSON.parse(await bytes(DIR+'/definitions.json')), profiles=roster(definitions);
  assert.equal(profiles.length,20); assert.equal(profiles.filter(p=>p.profileId!==definitions.control).length,19);
  assert.equal(profiles.find(p=>p.profileId===definitions.control).gridStepDistance,0);
});
await test('structural executable graph only V22/node builtins; no V21/model/decoder/runtime imports or dynamic imports',async()=>{
  const require=createRequire(path.join(ROOT,'apps/customer-web/package.json')), ts=require('typescript');
  const files=(await readdir(path.join(ROOT,DIR))).filter(p=>p.endsWith('.mjs'));
  for(const file of files) {
    const ast=ts.createSourceFile(file,(await bytes(DIR+'/'+file)).toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length,0);
    function visit(node) {
      if(ts.isImportDeclaration(node)) {
        const specifier=node.moduleSpecifier.text;
        assert.ok(specifier.startsWith('node:') || (specifier.startsWith('./')&&files.includes(specifier.slice(2))),file+':forbidden import '+specifier);
      }
      if(ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind,ts.SyntaxKind.ImportKeyword,'DYNAMIC_EXECUTABLE_IMPORT');
        if(ts.isIdentifier(node.expression)) assert.ok(!['decodeRobustPiano','sourcePublication','StepPracticeRuntime','WaitingTopologyGate'].includes(node.expression.text));
      }
      if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)) assert.ok(!['StepPracticeRuntime','WaitingTopologyGate','Worker','AcousticModelWorker'].includes(node.expression.text));
      ts.forEachChild(node,visit);
    }
    visit(ast);
  }
});
await test('V21 raw artifact identities exact before payload parsing; production/history unchanged',async()=>{
  await scope(); const i=await inventory(); assert.equal(i.stageAArtifacts.length,20); assert.equal(i.stageBArtifacts.length,20);
  assert.equal(i.profilePayloadsParsed,false); assert.equal(i.studyResultsParsed,false);
});
await save(OUT+'/preflight-tests.json',{completedAt:now(),scope:'SYNTHETIC_ARITHMETIC_AND_RAW_IDENTITY_CHECKS_ONLY_NO_REAL_STAGE_B_RECOMPUTATION',
  tests:passed,status:'LOCAL_PASS',count:passed.length,execution});
console.log(JSON.stringify({tests:passed.length,status:'LOCAL_PASS',execution}));
