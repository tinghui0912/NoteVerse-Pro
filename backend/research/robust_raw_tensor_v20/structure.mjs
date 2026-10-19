import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './io.mjs';
const require = createRequire(import.meta.url);
const ts = require(path.join(ROOT, 'apps/customer-web/node_modules/typescript'));

function parse(source, name = 'baseline.mjs') {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, 'AST_PARSE_FAILURE'); return ast;
}
function nodes(ast, predicate) {
  const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(ast); return out;
}
const id = (n, name) => ts.isIdentifier(n) && n.text === name;
const prop = (n, object, name) => ts.isPropertyAccessExpression(n) && id(n.expression, object) && n.name.text === name;
function thresholds(n) {
  assert.ok(ts.isObjectLiteralExpression(n), 'LITERAL_THRESHOLDS_REQUIRED'); assert.equal(n.properties.length, 2);
  const actual = {};
  for (const p of n.properties) {
    assert.ok(ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ts.isNumericLiteral(p.initializer), 'STATIC_THRESHOLD_FIELDS_REQUIRED');
    assert.ok(!Object.hasOwn(actual, p.name.text), 'DUPLICATE_THRESHOLD_FIELD'); actual[p.name.text] = Number(p.initializer.text);
  }
  assert.deepEqual(actual, { onsetThreshold: 0.30, frameThreshold: 0.05 }, 'ONLY_BASELINE_THRESHOLDS_ALLOWED');
}
export function baselineStructure(source, wrapper) {
  const ast = parse(source), refs = nodes(ast, n => id(n, 'decodeRobustPiano'));
  const binding = refs.filter(n => ts.isBindingElement(n.parent) && n.parent.name === n);
  assert.equal(binding.length, 1, 'ONE_UNALIASED_DECODER_BINDING_REQUIRED');
  const element = binding[0].parent; assert.ok(!element.propertyName && !element.initializer);
  const declaration = element.parent.parent;
  assert.ok(ts.isVariableDeclaration(declaration) && ts.isAwaitExpression(declaration.initializer));
  const imported = declaration.initializer.expression;
  assert.ok(ts.isCallExpression(imported) && imported.expression.kind === ts.SyntaxKind.ImportKeyword && imported.arguments.length === 1);
  const moduleURL = imported.arguments[0];
  assert.ok(ts.isPropertyAccessExpression(moduleURL) && moduleURL.name.text === 'href');
  const urlCall = moduleURL.expression;
  assert.ok(ts.isCallExpression(urlCall) && id(urlCall.expression, 'pathToFileURL') && urlCall.arguments.length === 1);
  const join = urlCall.arguments[0];
  assert.ok(ts.isCallExpression(join) && prop(join.expression, 'path', 'join') && join.arguments.length === 2
    && id(join.arguments[0], 'ROOT') && prop(join.arguments[1], 'bundle', 'path'), 'FROZEN_BUNDLE_IMPORT_REQUIRED');
  const calls = nodes(ast, n => ts.isCallExpression(n) && id(n.expression, 'decodeRobustPiano'));
  assert.equal(calls.length, 1, 'ONE_DECODER_CALL_REQUIRED'); assert.equal(refs.length, 2, 'DECODER_ALIAS_OR_SHADOW_REFERENCE');
  const call = calls[0]; assert.equal(call.arguments.length, 3); thresholds(call.arguments[2]);
  const ancestors = []; for (let p = call.parent; p; p = p.parent) ancestors.push(p);
  assert.ok(!ancestors.some(n => ts.isFunctionLike(n)), 'INDIRECT_DECODER_WRAPPER_FORBIDDEN');
  const loops = ancestors.filter(n => ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)
    || ts.isWhileStatement(n) || ts.isDoStatement(n)).reverse();
  assert.equal(loops.length, 2, 'ONLY_JOB_WINDOW_ITERATION_ALLOWED');
  assert.ok(loops.every(n => ts.isForOfStatement(n)) && prop(loops[0].expression, 'manifest', 'blobs'));
  const inner = loops[1].expression;
  assert.ok(ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'filter'
    && prop(inner.expression.expression, 'manifest', 'windows') && inner.arguments.length === 1);
  const filter = inner.arguments[0];
  assert.ok(ts.isArrowFunction(filter) && filter.parameters.length === 1 && id(filter.parameters[0].name, 'w')
    && ts.isBinaryExpression(filter.body) && filter.body.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && prop(filter.body.left, 'w', 'jobId') && prop(filter.body.right, 'blob', 'jobId'), 'CONTENT_BLIND_WINDOW_ITERATION_REQUIRED');
  const dynamicImports = nodes(ast, n => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword);
  assert.equal(dynamicImports.length, 1, 'SECOND_DYNAMIC_DECODER_IMPORT_FORBIDDEN');
  assert.equal(nodes(ast, n => ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)
    && n.moduleSpecifier.text.includes('decoder')).length, 0, 'SECOND_DECODER_IMPORT_FORBIDDEN');
  assert.equal(nodes(ast, n => ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression)
    && n.argumentExpression.text === 'decodeRobustPiano').length, 0, 'COMPUTED_DECODER_ACCESS_FORBIDDEN');
  assert.equal(nodes(ast, n => ts.isPropertyAccessExpression(n) && n.name.text === 'decodeRobustPiano').length, 0);
  const metadata = nodes(ast, n => ts.isPropertyAssignment(n) && id(n.name, 'thresholds'));
  assert.equal(metadata.length, 1); thresholds(metadata[0].initializer);
  for (const p of nodes(ast, n => ts.isPropertyAssignment(n) && (id(n.name, 'onsetThreshold') || id(n.name, 'frameThreshold')))) {
    assert.ok(ts.isNumericLiteral(p.initializer)); assert.equal(Number(p.initializer.text), p.name.text === 'onsetThreshold' ? .30 : .05);
  }
  const exports = parse(wrapper, 'baseline-wrapper.mjs').statements;
  assert.equal(exports.length, 2, 'BASELINE_WRAPPER_MUST_ONLY_REEXPORT_PRODUCTION');
  const required = [
    ['decodeRobustPiano', '../../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder'],
    ['sourcePublication', '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication']
  ];
  for (const [i, statement] of exports.entries()) {
    assert.ok(ts.isExportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === required[i][1] && ts.isNamedExports(statement.exportClause));
    assert.equal(statement.exportClause.elements.length, 1);
    assert.equal(statement.exportClause.elements[0].name.text, required[i][0]);
    assert.ok(!statement.exportClause.elements[0].propertyName);
  }
  return { parser: 'Existing repository TypeScript compiler API', parserVersion: ts.version,
    decoderCallExpressions: 1, localUnaliasedBindings: 1, reportMetadataObjects: 1,
    reportMetadataCountedAsDecoderCall: false, thresholdArguments: { onsetThreshold: .30, frameThreshold: .05 },
    indirectOrComputedDecoderCalls: 0, decoderWrappers: 0, thresholdGridIterations: 0 };
}
export function captureStructure(worker, entry) {
  const w = parse(worker, 'capture-worker.mjs'), e = parse(entry, 'capture-entry.mjs');
  const sessionCreates = nodes(w, n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && n.expression.name.text === 'create' && prop(n.expression.expression, 'ort', 'InferenceSession'));
  const sessionRuns = nodes(w, n => ts.isCallExpression(n) && prop(n.expression, 'session', 'run'));
  const ownerWorkers = nodes(e, n => ts.isNewExpression(n) && id(n.expression, 'Worker'));
  assert.equal(sessionCreates.length, 1); assert.equal(sessionRuns.length, 1); assert.equal(ownerWorkers.length, 1);
  assert.equal(nodes(w, n => ts.isNewExpression(n) && id(n.expression, 'Worker')).length, 0);
  return { captureOwnerConstructionSites: 1, modelSessionCreationSites: 1, guardedSessionRunSites: 1 };
}
