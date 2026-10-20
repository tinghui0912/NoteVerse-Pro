import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, DIR, OUT, V26, V26SRC, V27, START, BRANCH, bytes, load, sha, now, save, git, scope, exists, zeroCounters } from './io.mjs';

// Parse immutable text only. No bundle, browser, acoustic or domain module is imported.
const require = createRequire(import.meta.url);
const tsPath = 'apps/customer-web/node_modules/typescript';
const ts = require(path.join(ROOT, tsPath));
const contract = await load(DIR + '/contract.json');
const identities = [], tests = [];
const identity = async (p, expected, size) => {
  const b = await bytes(p);
  if (expected) assert.equal(sha(b), expected, 'IMMUTABLE_IDENTITY:' + p);
  if (size !== undefined) assert.equal(b.length, size, 'IMMUTABLE_SIZE:' + p);
  const result = { path: p, sha256: sha(b), bytes: b.length };
  identities.push(result); return result;
};
function inspectOrdering(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.parseDiagnostics.length, 0, 'PARSER_DIAGNOSTIC');
  const matches = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'complete' && ts.isArrowFunction(node.initializer)) {
      const reads = [], completions = [], oracles = [];
      const walk = n => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
          const callee = n.expression;
          if (callee.name.text === 'currentTarget') reads.push(n);
          if (callee.name.text === 'completeAttempt') completions.push(n);
        }
        if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'oracle') oracles.push(n);
        ts.forEachChild(n, walk);
      };
      walk(node.initializer.body);
      if (reads.length || completions.length) {
        assert.equal(reads.length, 1, 'AMBIGUOUS_RESEARCH_TARGET_READ');
        assert.equal(completions.length, 1, 'AMBIGUOUS_RUNTIME_COMPLETION');
        assert.equal(oracles.length, 1, 'AMBIGUOUS_RESEARCH_ORACLE');
        const witness = n => ({ line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
          start: n.getStart(ast), end: n.end, text: n.getText(ast) });
        matches.push({ callback: 'research sink.complete(identity, evidence)', targetRead: witness(reads[0]),
          runtimeCompletion: witness(completions[0]), oracle: witness(oracles[0]),
          targetReadAfterRuntimeCompletion: reads[0].getStart(ast) > completions[0].end,
          comparisonAfterRuntimeCompletion: oracles[0].getStart(ast) > completions[0].end });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(matches.length, 1, 'AMBIGUOUS_COMPLETE_CALLBACK');
  return { filename, ...matches[0] };
}
async function test(name, run) { await run(); tests.push({ name, result: 'LOCAL_PASS_NON_BROWSER' }); }

try {
  scope(); assert.equal(await exists(OUT + '/assessment.json'), false, 'NO_PREFLIGHT_RETRY');
  assert.equal(git('rev-parse', 'HEAD'), START);
  assert.equal(git('rev-parse', 'origin/' + BRANCH), START);
  assert.equal(git('merge-base', 'HEAD', 'origin/' + BRANCH), START);
  assert.equal(git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH), '0\t0');
  await test('AST detects pre-verdict target access even when the assertion is post-verdict', () => {
    const early = inspectOrdering('const sink={complete:(identity,evidence)=>{const expected=domain.currentTarget().attackPitches;const result=domain.completeAttempt(identity,evidence);const oracle=expected;}};', 'early.js');
    assert.equal(early.targetReadAfterRuntimeCompletion, false);
    assert.equal(early.comparisonAfterRuntimeCompletion, true);
    const late = inspectOrdering('const sink={complete:(identity,evidence)=>{const result=domain.completeAttempt(identity,evidence);const expected=domain.currentTarget().attackPitches;const oracle=expected;}};', 'late.js');
    assert.equal(late.targetReadAfterRuntimeCompletion, true);
  });
  await test('V28 contract is four cells, root loss excluded, capabilities closed and no subtraction gate', () => {
    assert.deepEqual(contract.mandatoryCells, ['normal-44100', 'normal-48000', 'context-loss-44100', 'context-loss-48000']);
    assert.equal(contract.H50.gestureMs, 50);
    assert.equal(contract.H50.structuralInvariant, 'finish === anchor + sourceRateHz * STEP_ACOUSTIC_GESTURE_MS / 1000');
    assert.equal(contract.rootLoss, 'ROOT_SOURCE_LOSS_NOT_EVALUATED_IN_V28');
    assert.equal(contract.capabilities.productionMicrophone, false); assert.equal(contract.capabilities.D4, false);
  });
  const accepted = [
    [V26 + '/bundles/entry.js', '94a042eb56bb6bea42521e65547cab632ab84b693379599a1d55dff4824fac35', 132684],
    [V26 + '/bundles/worker.js', 'fa72177cc90c3d91a7b48ef57225624cedd69e8dc232eb6bd8cc83ad502b0526', 33908],
    [V26 + '/browser-input.wav', '47e9287126bd2b0f1589abb972c98bac467c1850b2ad620a7b3604d26d9b316b', 3685040],
    [V26 + '/build-and-environment.json', '0d46a0b1a5b3ba4be3343ab99b6e07061d5600973c497eb093a755aba18e58d9'],
    [V26SRC + '/contract.json', 'f983c5f9f234b6ec13d2e1bd30696a20b4d922c89a70dd3104bbdc5976221056']
  ];
  await test('Exact immutable V26 executable, media, build and contract bytes', async () => {
    for (const a of accepted) await identity(...a);
  });
  const oldFreezePath = V27 + '/browser-protocol-freeze.json';
  await identity(oldFreezePath, 'c3a253f8cb8a7d0e5a79b3d6e67fc60975dec0511014d71485b9d4f9054e8e1e');
  const oldFreeze = await load(oldFreezePath), build = await load(V26 + '/build-and-environment.json');
  await test('Every V26 represented build input retains the accepted V27 filesystem identity', async () => {
    const files = oldFreeze.immutableCandidate.filesystemInputs, virtual = new Set();
    for (const bundle of build.bundles) for (const input of bundle.inputs) {
      if (input === '<define:process.env>') { virtual.add(input); continue; }
      assert.ok(!input.startsWith('<') && !input.endsWith('>'), 'UNKNOWN_VIRTUAL_INPUT');
      const f = files.find(f => f.metafileInputName === input);
      assert.ok(f, 'UNREPRESENTED_BUILD_INPUT:' + input);
      await identity(f.path, f.sha256, f.bytes);
    }
    assert.deepEqual([...virtual], ['<define:process.env>']);
    assert.deepEqual(oldFreeze.immutableCandidate.virtualInputs.map(v => v.identifier), ['<define:process.env>']);
  });
  await test('All V27 frozen source identities including represented production sources remain exact', async () => {
    for (const f of oldFreeze.files) await identity(f.path, f.sha256);
  });
  await test('Model, ORT, FIR, worklet and acoustic-core asset bytes retain exact identity without execution', async () => {
    for (const asset of Object.values(build.assets)) await identity(asset.path, asset.sha256, asset.bytes);
    await identity('apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json', contract.defaults.coreSHA256);
    assert.equal((await load('apps/customer-web/node_modules/onnxruntime-web/package.json')).version, '1.20.1');
  });
  await test('V26/V27 remain historically integrity-blocked', async () => {
    assert.equal((await load(V26 + '/assessment.json')).disposition, contract.historicalDispositions.V26);
    assert.equal((await load(V27 + '/assessment.json')).disposition, contract.historicalDispositions.V27);
  });
  const history = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) {
    history.push({ path: p, sha256: sha(await bytes(p)) });
  }
  await save('historical-identities.json', { startingHead: START, files: history });
  await save('identity-verification.json', { startingHead: START, identities, checks: tests, filesystemVsVirtual: {
    virtualIdentifier: '<define:process.env>', filesystemReadAttempted: false,
    semanticRecord: oldFreeze.immutableCandidate.semantics, virtualRecords: oldFreeze.immutableCandidate.virtualInputs
  }, productionDiff: [], V3ThroughV27Diff: [], counters: zeroCounters() });
  const source = inspectOrdering((await bytes(V26SRC + '/entry.ts')).toString(), V26SRC + '/entry.ts');
  const bundle = inspectOrdering((await bytes(V26 + '/bundles/entry.js')).toString(), V26 + '/bundles/entry.js');
  const pass = source.targetReadAfterRuntimeCompletion && bundle.targetReadAfterRuntimeCompletion;
  assert.equal(pass, false, 'PREPARATION_ASSUMPTION_CHANGED_STOP_NO_BROWSER_AUTHORIZATION');
  const failure = { code: 'IMMUTABLE_RESEARCH_TARGET_READ_PRECEDES_RUNTIME_FINALIZATION',
    category: 'PREFREEZE_PROTOCOL_COMPATIBILITY_FAILURE', requirement: contract.oracleOrdering,
    source, bundle, interpretation: 'Target lookup is earlier than runtime completion in both immutable source and prepared executable. The comparison/assertion is later. This is a research harness ordering conflict, not a production acoustic/H50 defect.',
    action: 'STOP. No bundle change, wrapper repair, browser launch, freeze authorization or retry.' };
  await save('preflight-protocol-failure.json', { disposition: contract.integrityDisposition, recordedAt: now(), failure, counters: zeroCounters() });
  await save('tooling-tests.json', { tests, passed: tests.length, toolingResult: 'LOCAL_NON_BROWSER_CHECKS_PASS',
    realImmutableCandidateProtocolGate: 'FAILED', productRegressions: 'NOT_RUN_AFTER_PROTOCOL_STOP',
    applicationTypecheck: 'NOT_RUN_AFTER_PROTOCOL_STOP', applicationLint: 'NOT_RUN_AFTER_PROTOCOL_STOP', counters: zeroCounters() });
  await save('assessment.json', { phase: contract.phase, startingHead: START, recordedAt: now(), disposition: contract.integrityDisposition,
    history: contract.historicalStatements, historicalDispositions: contract.historicalDispositions, failure,
    protocolFreeze: 'NOT_CREATED_PROTOCOL_GATE_FAILED', remoteBrowserFreezeProof: 'NOT_CREATED',
    campaignImplementation: 'NOT_COMPLETED_AFTER_EARLIEST_PREFLIGHT_STOP', browserCampaign: 'NOT_EXECUTED',
    cells: contract.mandatoryCells.map(id => ({ id, status: 'NOT_EXECUTED' })), counters: zeroCounters(),
    defaults: contract.defaults, capabilities: contract.capabilities, rootLoss: contract.rootLoss,
    crossTargetIsolation: 'CROSS_TARGET_SAME_PITCH_ISOLATION_NOT_EVALUATED', disclaimers: contract.disclaimers,
    productionDefectEstablished: false, productionDiff: [], historicalDiff: [], bundlesRebuilt: false,
    historyFiles: history.length, localVerification: tests, CI: contract.CI,
    stop: 'STOP_FOR_INDEPENDENT_AUDIT_NO_REPAIR_RETRY_CONTROLLER_INTEGRATION_OR_CAPABILITY_PROMOTION' });
  await save('assessment.md', '# V28 Pre-execution Protocol Stop\n\n' + contract.integrityDisposition + '\n\n' +
    contract.historicalStatements.join('\n\n') + '\n\n' +
    'The exact immutable V26 entry bundle reads domain.currentTarget().attackPitches at line ' + bundle.targetRead.line +
    ' before domain.completeAttempt(identity, evidence) at line ' + bundle.runtimeCompletion.line +
    '. V28 section 9 permits research expected-pitch inspection only after runtime finalization. The oracle comparison is later, but the target lookup is not. Source and AST witnesses are preserved in preflight-protocol-failure.json.\n\n' +
    'This is a research protocol compatibility blocker, not a production H50, decoder, model or resource defect. No production/bundle mutation, browser launch, model load, neural/decoder run, EVIDENCE injection or real product execution occurred. No V28 browser freeze/proof was created. All four cells remain NOT_EXECUTED. No repair or retry.\n\n' +
    'Exact V26 bundle/WAV/build identities, all V27 frozen sources and model/ORT/FIR/worklet assets verified. The sole esbuild virtual node is retained semantically, never read as a file. Identity and historical raw-byte manifests are retained. H50 is specified by its original construction, never the failed V27 subtraction assertion; no H50 browser result is claimed.\n\n' +
    contract.rootLoss + '\n\nCROSS_TARGET_SAME_PITCH_ISOLATION_NOT_EVALUATED\n\n' + contract.disclaimers.join('\n\n') + '\n\n' +
    'Current Robust .30/.05 and 600/1050/170, schema6, MIDI exact-set, microphone conservative tristate and all closed capabilities are unchanged. No fixed cooldown. Local static checks are not GitHub CI. Product regressions/typecheck/lint/browser execution were not run after the protocol stop. Final GitHub metadata is recorded separately. STOP for independent audit.\n');
  console.log(JSON.stringify({ disposition: contract.integrityDisposition, failure: failure.code, source, bundle, counters: zeroCounters() }));
  process.exitCode = 1;
} catch (error) {
  if (!await exists(OUT + '/assessment.json')) {
    await save('assessment.json', { phase: contract.phase, startingHead: START, disposition: contract.integrityDisposition,
      recordedAt: now(), failure: { code: 'PREFLIGHT_TOOLING_OR_IDENTITY_FAILURE', error: String(error.stack ?? error) },
      tests, counters: zeroCounters(), protocolFreeze: 'NOT_CREATED', browserCampaign: 'NOT_EXECUTED',
      cells: contract.mandatoryCells.map(id => ({ id, status: 'NOT_EXECUTED' })), productionDiff: [], historicalDiff: [], capabilities: contract.capabilities,
      history: contract.historicalStatements, noRetry: true });
  }
  console.error(error); process.exitCode = 1;
}
