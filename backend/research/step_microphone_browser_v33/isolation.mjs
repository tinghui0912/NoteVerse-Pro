import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, V26, V26SRC, bytes } from './io.mjs';
const require = createRequire(import.meta.url);
export const ts = require(path.join(ROOT, 'apps/customer-web/node_modules/typescript'));
export const parse = (name, source) => {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.parseDiagnostics.length, 0, 'AST_PARSE:' + name); return ast;
};
const text = (n, ast) => n.getText(ast).replace(/!(?=\.)/g, '').replaceAll('"', "'");
export function oracleIsolation(name, source) {
  const ast = parse(name, source), matches = [];
  const walk = (n, visit) => { visit(n); ts.forEachChild(n, c => walk(c, visit)); };
  walk(ast, n => {
    if (!ts.isPropertyAssignment(n) || n.name.getText(ast) !== 'complete' || !ts.isArrowFunction(n.initializer)) return;
    const callback = n.initializer, calls = [], identifiers = [], declarations = [], returns = [];
    walk(callback.body, c => {
      if (ts.isCallExpression(c)) calls.push(c);
      if (ts.isIdentifier(c)) identifiers.push(c);
      if (ts.isVariableDeclaration(c)) declarations.push(c);
      if (ts.isReturnStatement(c) || ts.isAwaitExpression(c) || ts.isYieldExpression(c)) returns.push(c);
    });
    const completes = calls.filter(c => text(c.expression, ast) === 'domain.completeAttempt');
    if (!completes.length) return;
    assert.equal(completes.length, 1); assert.deepEqual(callback.parameters.map(p => p.name.getText(ast)), ['identity', 'evidence']);
    const complete = completes[0], reads = calls.filter(c => text(c.expression, ast) === 'domain.currentTarget');
    assert.equal(reads.length, 1, 'ONE_DIAGNOSTIC_TARGET_READ');
    const expected = declarations.filter(d => d.name.getText(ast) === 'expected'); assert.equal(expected.length, 1);
    assert.equal(text(expected[0].initializer, ast), 'domain.currentTarget().attackPitches');
    assert.ok(expected[0].getStart(ast) < complete.getStart(ast));
    assert.deepEqual(complete.arguments.map(a => a.getText(ast)), ['identity', 'evidence'], 'ORIGINAL_RUNTIME_ARGUMENTS');
    const analyzes = calls.filter(c => text(c.expression, ast) === 'domain.analyzeAttempt'); assert.equal(analyzes.length, 1);
    assert.deepEqual(analyzes[0].arguments.map(a => a.getText(ast)), ['identity']);
    assert.ok(analyzes[0].getStart(ast) < complete.getStart(ast));
    const uses = identifiers.filter(i => i.text === 'expected' && i !== expected[0].name);
    assert.ok(uses.length > 0 && uses.every(i => i.getStart(ast) > complete.end), 'EXPECTED_PRE_FINALIZATION_FLOW');
    const before = calls.filter(c => c.getStart(ast) < complete.getStart(ast));
    const allowed = ['demand', 'domain.snapshot', 'domain.currentTarget', 'domain.analyzeAttempt'];
    assert.ok(before.every(c => allowed.includes(text(c.expression, ast))), 'UNKNOWN_PRE_FINALIZATION_CALL');
    assert.ok(returns.every(r => r.getStart(ast) > complete.end), 'PRE_FINALIZATION_CONTROL_ESCAPE');
    // No writes/aliasing/control expressions may consume evidence or identity before finalization.
    const preStatements = callback.body.statements.filter(s => s.end < complete.getStart(ast));
    assert.ok(preStatements.every(s => ts.isVariableStatement(s) || ts.isExpressionStatement(s)), 'PRE_FINALIZATION_CONTROL_BRANCH');
    for (const s of preStatements) walk(s, c => {
      if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsToken) throw Error('PRE_FINALIZATION_MUTATION');
      if (ts.isVariableDeclaration(c) && c.initializer && ['evidence', 'identity'].includes(c.initializer.getText(ast))) throw Error('INPUT_ALIAS_BEFORE_FINALIZATION');
    });
    const ordinaryGuard = before.find(c => c.expression.getText(ast) === 'demand' && c.arguments[0] && text(c.arguments[0], ast).includes("evidence.kind === 'EVIDENCE'"));
    assert.ok(ordinaryGuard && ordinaryGuard.end < expected[0].getStart(ast), 'EVIDENCE_BEFORE_TARGET_SNAPSHOT');
    const finalGuard = callback.body.statements.find(s => ts.isIfStatement(s) && s.getStart(ast) > complete.end
      && text(s.expression, ast).includes("result.kind !== 'FINALIZED'") && ts.isThrowStatement(s.thenStatement));
    assert.ok(finalGuard, 'FINALIZED_GUARD_REQUIRED');
    assert.ok(uses.every(i => i.getStart(ast) > finalGuard.end), 'EXPECTED_USED_BEFORE_SUCCESSFUL_FINALIZED_GUARD');
    const oracle = declarations.filter(d => d.name.getText(ast) === 'oracle'); assert.equal(oracle.length, 1);
    assert.ok(oracle[0].getStart(ast) > finalGuard.end);
    const assertion = calls.find(c => c.expression.getText(ast) === 'demand' && c.arguments[0]?.getText(ast) === 'result.record.verdict === oracle');
    assert.ok(assertion && assertion.getStart(ast) > oracle[0].end, 'VERDICT_COMPARED_NOT_REPLACED');
    walk(callback.body, c => {
      if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = text(c.left, ast); assert.ok(!lhs.startsWith('result') && !lhs.startsWith('evidence') && !lhs.startsWith('identity'), 'INPUT_OR_VERDICT_WRITE');
      }
    });
    const pos = c => ({ start: c.getStart(ast), end: c.end, line: ast.getLineAndCharacterOfPosition(c.getStart(ast)).line + 1, text: c.getText(ast) });
    matches.push({ filename: name, parameters: ['identity', 'evidence'], ordinaryEvidenceGuard: pos(ordinaryGuard),
      passiveExpectedSnapshot: pos(expected[0]), analyzeCall: pos(analyzes[0]), runtimeCompleteCall: pos(complete),
      successfulFinalizationGuard: pos(finalGuard), expectedIdentifierUses: uses.map(pos), oracle: pos(oracle[0]), comparison: pos(assertion),
      noExpectedFlowBeforeFinalization: true, originalArguments: true, verdictComparedNeverReplaced: true,
      note: 'Passive pre-finalization snapshot accepted; its uses begin only after successful FINALIZED guard' });
  });
  assert.equal(matches.length, 1, 'ONE_RESEARCH_COMPLETE_CALLBACK'); return matches[0];
}
export async function staticWitnesses() {
  const results = [];
  for (const p of [V26SRC + '/entry.ts', V26 + '/bundles/entry.js']) results.push(oracleIsolation(p, (await bytes(p)).toString()));
  // The exact frozen statements establish rearm adjacency and assembler end construction.
  const entry = (await bytes(V26SRC + '/entry.ts')).toString();
  const ast = parse('entry.ts', entry), commitFunctions = [];
  const visit = n => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'commit') commitFunctions.push(n); ts.forEachChild(n, visit); }; visit(ast);
  assert.equal(commitFunctions.length, 1);
  const commit = commitFunctions[0].initializer, statements = commit.body.statements;
  const armIndex = statements.findIndex(s => s.getText(ast).includes('input!.arm(b)'));
  assert.ok(armIndex > 0); const domainCommit = statements[armIndex - 1].getText(ast), arm = statements[armIndex].getText(ast);
  assert.ok(domainCommit.includes('acceptInputAfter(b.sessionTime)') && domainCommit.includes('rearm(b.sessionTime)'));
  assert.ok(!domainCommit.includes('await') && !arm.includes('await'));
  const assembler = (await bytes('apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts')).toString();
  assert.ok(assembler.includes('export const STEP_ACOUSTIC_GESTURE_MS = 50;'));
  assert.ok(assembler.includes('const end = first.sourceEventSample + this.sourceRate * STEP_ACOUSTIC_GESTURE_MS / 1000;'));
  return { oracle: results, synchronousCommit: { domainCommit, immediateNextStatement: arm, noTaskGap: true },
    assemblerConstruction: 'first.sourceEventSample + this.sourceRate * STEP_ACOUSTIC_GESTURE_MS / 1000', gestureMs: 50 };
}
export async function toolingBoundary(files) {
  for (const p of files) {
    if (!p.endsWith('.mjs')) continue;
    const source = (await bytes(p)).toString(), ast = parse(p, source);
    const visit = n => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(ast);
        assert.ok(!['eval', 'Function', 'exec', 'execSync', 'spawn', 'spawnSync'].includes(callee), 'UNSTRUCTURED_EXECUTION:' + p);
        if (callee === 'execFileSync') {
          const args = n.arguments[1]; assert.ok(args && (ts.isArrayLiteralExpression(args) || ts.isIdentifier(args) && ['a', 'args'].includes(args.text)));
          if (args && ts.isArrayLiteralExpression(args)) for (const a of args.elements) {
            if (ts.isStringLiteral(a)) assert.ok(!['-e', '-c', '-Command', '/c'].includes(a.text), 'INLINE_PROGRAM_ARG');
          }
        }
      }
      if (ts.isPropertyAssignment(n) && n.name.getText(ast) === 'shell') assert.equal(n.initializer.kind, ts.SyntaxKind.FalseKeyword);
      ts.forEachChild(n, visit);
    }; visit(ast);
  }
  return { inlineExecution: false, shells: false, directArgvOnly: true };
}
