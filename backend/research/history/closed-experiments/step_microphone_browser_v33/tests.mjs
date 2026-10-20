import assert from 'node:assert/strict';
import { DIR, V26, bytes, load } from './io.mjs';
import { oracleIsolation, staticWitnesses, parse, ts } from './isolation.mjs';
import { intervalGate } from './audit.mjs';
import { classifyFailure, INTEGRITY } from './classification.mjs';
export async function tests() {
  const results = [], test = async (name, fn) => { await fn(); results.push({ name, result: 'LOCAL_PASS' }); };
  await test('oracle isolation accepts inert snapshot but rejects early use and changed runtime arguments', () => {
    const sample = `const sink={complete:(identity,evidence)=>{
      demand(evidence.kind === 'EVIDENCE','e');
      const before=domain.snapshot(),expected=domain.currentTarget().attackPitches;
      demand(domain.analyzeAttempt(identity),'a');
      const result=domain.completeAttempt(identity,evidence);
      demand(result.kind === 'FINALIZED','f');
      if(result.kind !== 'FINALIZED' || evidence.kind !== 'EVIDENCE') throw new Error('f');
      const oracle=expected;
      demand(result.record.verdict === oracle,'v');
    }};`;
    const witness = oracleIsolation('sample.js', sample); assert.equal(witness.noExpectedFlowBeforeFinalization, true);
    assert.throws(() => oracleIsolation('early.js', sample.replace('demand(domain.analyzeAttempt', 'consume(expected);demand(domain.analyzeAttempt')));
    assert.throws(() => oracleIsolation('args.js', sample.replace('completeAttempt(identity,evidence)', 'completeAttempt(identity,expected)')));
    assert.throws(() => oracleIsolation('branch.js', sample.replace('demand(domain.analyzeAttempt', 'if(expected.length)return;demand(domain.analyzeAttempt')));
  });
  await test('actual immutable TS and bundle prove data/control isolation and synchronous domain/arm adjacency', async () => {
    const w = await staticWitnesses(); assert.equal(w.oracle.length, 2); assert.equal(w.synchronousCommit.noTaskGap, true);
  });
  await test('H50 construction accepts ordinary fractional source arithmetic without subtraction gate or tolerance', () => {
    for (const rate of [44100, 48000]) for (const anchor of [0, 1, 1047013.93125, 777.125, 1e7 + .123]) {
      intervalGate(anchor, anchor + rate * 50 / 1000, rate);
    }
    assert.throws(() => intervalGate(10, 2216, 44100));
  });
  await test('exact four-cell matrix, root loss exclusion, frozen baseline and closed capabilities', async () => {
    const c = await load(DIR + '/contract.json');
    assert.deepEqual(c.cells.map(x => x.id), ['normal-44100', 'normal-48000', 'context-loss-44100', 'context-loss-48000']);
    assert.equal(c.rootLoss, 'ROOT_SOURCE_LOSS_NOT_EVALUATED_IN_V33');
    assert.deepEqual([c.currentDefaults.onset, c.currentDefaults.frame, c.currentDefaults.ownedMs, c.currentDefaults.pastMs, c.currentDefaults.futureMs], [.30, .05, 600, 1050, 170]);
    assert.equal(c.capabilities.productionMicrophone, false); assert.equal(c.capabilities.D4, false);
  });
  await test('one launch after remote proof; exact immutable bundles served; no rebuild or old campaign import', async () => {
    const source = (await bytes(DIR + '/campaign.mjs')).toString(), ast = parse('campaign.mjs', source), calls = [];
    const visit = n => { if (ts.isCallExpression(n) && n.expression.getText(ast) === 'chromium.launch') calls.push(n); ts.forEachChild(n, visit); }; visit(ast);
    assert.equal(calls.length, 1); assert.ok(calls[0].getStart(ast) > source.indexOf('await authorizeCampaign()'));
    assert.ok(source.includes("V26+'/bundles/entry.js'")); assert.ok(source.includes("V26+'/bundles/worker.js'"));
    assert.ok(!source.includes('esbuild') && !source.includes('build('));
    assert.ok(!source.includes("from '../step_microphone_browser_v26"));
    assert.equal(V26, 'backend/research/reports/step_microphone_browser_v26');
  });
  await test('preflight executable import graph excludes campaign/browser/model/runtime execution', async () => {
    const allowed = ['io.mjs', 'manifest.mjs', 'identities.mjs', 'identity-tests.mjs', 'git-identities.mjs', 'isolation.mjs', 'tests.mjs', 'audit.mjs', 'classification.mjs', 'lifecycle.mjs', 'lifecycle-tests.mjs', 'source-inventory.mjs'];
    for (const name of ['control.mjs', ...allowed]) {
      const source = (await bytes(DIR + '/' + name)).toString(), ast = parse(name, source);
      for (const n of ast.statements) if (ts.isImportDeclaration(n)) {
        const spec = n.moduleSpecifier.text; assert.ok(spec.startsWith('node:') || allowed.includes(spec.slice(2)), 'NON_STATIC_PREFLIGHT_IMPORT:' + spec);
      }
      const visit = n => {
        if (ts.isCallExpression(n)) assert.ok(!['chromium.launch', 'session.run', 'decodeRobustPiano', 'createAcousticModelWorker'].includes(n.expression.getText(ast)));
        ts.forEachChild(n, visit);
      }; visit(ast);
    }
  });
  await test('research assertion and environment failure do not masquerade as production defect', () => {
    assert.equal(classifyFailure({ message: 'H50_ORIGINAL_CONSTRUCTION', trace: { counts: { workerOwners: 1 } }, environmentValid: true }).disposition, INTEGRITY);
    assert.equal(classifyFailure({ message: 'timeout', environmentValid: false }).disposition, INTEGRITY);
  });
  return results;
}
