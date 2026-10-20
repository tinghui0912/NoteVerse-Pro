import assert from 'node:assert/strict';
import { START, ROOT, DIR, git, bytes, rawBytesSha256, load } from './io.mjs';
import { gitTree, gitObjectRecord } from './git-identities.mjs';
import { parse, ts } from './isolation.mjs';
import path from 'node:path';
const prefix = 'apps/customer-web/src/lib/practice/';
export const requiredPaths = ['acoustic/model/worker-client.ts', 'acoustic/model/acoustic-worker.entry.ts', 'acoustic/model/model-inference.ts',
  'acoustic/runtime/source-analysis-runtime.ts', 'acoustic/model/inference.test.ts', 'step/step-microphone-input.ts'].map(p => prefix + p);
export function sourceInventory() {
  const entries = git('ls-tree', '-r', '--name-only', START, '--', prefix + 'acoustic', prefix + 'step').split('\n').filter(Boolean);
  for (const p of requiredPaths) assert.ok(entries.includes(p), 'REQUIRED_AUTHORITATIVE_SOURCE_ABSENT:' + p);
  return { commit: START, enumeration: ['git','ls-tree','-r','--name-only',START,'--',prefix+'acoustic',prefix+'step'],
    paths: entries, requiredPaths, allRequiredPresentBeforeReading: true };
}
export async function lifecycleStaticProof() {
  const inventory = sourceInventory(), tree = gitTree(START), records = [];
  const read = async p => {
    assert.ok(inventory.paths.includes(p), 'READ_NOT_IN_VALIDATED_INVENTORY:' + p);
    const source = (await bytes(p)).toString(), ast = parse(p, source);
    records.push({ path:p,domain:'WORKTREE_MATERIALIZATION',representation:'SHA256_WORKTREE_MATERIALIZATION',subject:{kind:'VALIDATED_LOCAL_SOURCE_BYTES',path:p},sha256:rawBytesSha256(Buffer.from(source)),git:gitObjectRecord(p,START,tree) });
    return {source,ast};
  };
  const witnesses = [];
  const method = (parsed, className, methodName) => {
    const c = parsed.ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className); assert.ok(c);
    const m = c.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(parsed.ast) === methodName); assert.ok(m);
    const text = m.getText(parsed.ast), position = { start:m.getStart(parsed.ast),end:m.end,line:parsed.ast.getLineAndCharacterOfPosition(m.getStart(parsed.ast)).line+1 };
    witnesses.push({className,methodName,position,text}); return {node:m,text};
  };
  const w = await read(requiredPaths[0]);
  const run=method(w,'AcousticModelWorker','run'), dispose=method(w,'AcousticModelWorker','dispose'), terminate=method(w,'AcousticModelWorker','terminate');
  assert.ok(run.text.includes("this.state !== 'READY' || this.busy") && run.text.includes("this.send({ type: 'INFER', input })") && run.text.includes('this.terminate()'));
  assert.ok(dispose.text.includes("if (this.state === 'CLOSED') return;") && dispose.text.includes("if (this.busy) { this.terminate('ACOUSTIC_WORKER_DISPOSED'); return; }")
    && dispose.text.includes("await this.send({ type: 'DISPOSE' })"));
  for(const s of ['pending.reject(error)','this.pending.clear()','this.worker.terminate()'])assert.ok(terminate.text.includes(s));
  assert.ok(terminate.text.indexOf('pending.reject(error)') < terminate.text.indexOf('this.pending.clear()') && terminate.text.indexOf('this.pending.clear()') < terminate.text.indexOf('this.worker.terminate()'));
  assert.ok(terminate.text.includes("code !== 'ACOUSTIC_WORKER_TERMINATED' && code !== 'ACOUSTIC_WORKER_DISPOSED'"));
  const entry=await read(requiredPaths[1]);
  assert.ok(entry.source.includes("message.type === 'INFER' && message.input) result = await inference.run(message.input)") && entry.source.includes("message.type === 'DISPOSE') result = await inference.dispose()"));
  const m=await read(requiredPaths[2]), modelRun=method(m,'AcousticModelSession','run');
  const increments=[],calls=[];
  const visit=n=>{if(ts.isPostfixUnaryExpression(n)&&n.operand.getText(m.ast)==='this.runs')increments.push(n);
    if(ts.isCallExpression(n)&&n.expression.getText(m.ast)==='this.session.run')calls.push(n);ts.forEachChild(n,visit);};visit(modelRun.node);
  assert.equal(increments.length,1);assert.equal(calls.length,1);assert.ok(increments[0].end < calls[0].getStart(m.ast));
  assert.ok(/this\.runs\+\+;\s*tensors = await this\.session\.run/.test(modelRun.text));
  const runtime=await read(requiredPaths[3]), runtimeDispose=method(runtime,'SourceAnalysisRuntime','dispose'), enqueue=method(runtime,'SourceAnalysisRuntime','enqueue');
  assert.ok(runtimeDispose.text.indexOf("this.state = 'DISPOSED'") < runtimeDispose.text.indexOf('await this.options.worker.dispose()'));
  assert.ok(runtimeDispose.text.includes('this.detachWorker?.()') && runtimeDispose.text.includes('await this.options.worker.dispose(); await this.chain;'));
  assert.ok(enqueue.text.includes('const result = await this.options.worker.run({ window, pcm }); if (this.closed()) return;'));
  assert.ok(enqueue.text.indexOf('if (this.closed()) return;',enqueue.text.indexOf('const result')) < enqueue.text.indexOf('sourcePublication('));
  assert.ok(enqueue.text.includes('this.outstanding--'));
  const test=await read(requiredPaths[4]);
  const testCases=test.ast.statements.filter(s=>ts.isExpressionStatement(s)&&ts.isCallExpression(s.expression)&&s.expression.expression.getText(test.ast)==='it');
  const pendingTest=testCases.find(s=>s.expression.arguments[0]?.text==='disposing active worker rejects pending inference instead of hanging');
  assert.ok(pendingTest && pendingTest.getText(test.ast).includes("rejects.toThrow('ACOUSTIC_WORKER_DISPOSED')"));
  await read(requiredPaths[5]);
  const contract=await load(DIR+'/contract.json');assert.deepEqual(contract.sourceDiscovery.required,requiredPaths);
  return {inventory,sourceRecords:records,witnesses,dispatch:{INFER:'AcousticModelSession.run(input)',DISPOSE:'AcousticModelSession.dispose()'},
    supportingExistingProductTest:{name:pendingTest.expression.arguments[0].text,text:pendingTest.getText(test.ast)},
    sessionInvocationBoundary:{incrementPosition:increments[0].getStart(m.ast),sessionRunPosition:calls[0].getStart(m.ast),uncertainty:'A terminated authorized request may or may not cross this boundary; never infer completion or zero GPU work'},
    completedButNotPublished:'Source runtime closed() guard after awaited real worker.run suppresses publication after closure',
    noProductionCodeExecuted:true,repositoryRoot:path.resolve(ROOT),proofStatus:'STATIC_LOCAL_PASS'};
}
