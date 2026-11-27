import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = path.resolve('src');
const route = 'app/[locale]/(workspace)/score/[id]/practice';
function source(file: string) {
  return ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function nodes(file: ts.SourceFile) {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { result.push(node); ts.forEachChild(node, visit); };
  visit(file); return result;
}
function calls(file: ts.SourceFile) {
  return nodes(file).filter(ts.isCallExpression).map(n => n.expression.getText(file));
}

it('Workspace resource lifecycle is expressed by domain commands without a router dependency', () => {
  const file = source('contexts/practice-workspace-context.tsx');
  const imports = nodes(file).filter(ts.isImportDeclaration).map(n => n.moduleSpecifier.getText(file));
  expect(imports.some(n => n.includes('next/navigation'))).toBe(false);
  expect(nodes(file).filter(ts.isIdentifier).map(n => n.text)).not.toContain('pathname');
  for (const command of ['enterSetup', 'enterPractice', 'enterReview', 'beginPreparation', 'commitPreparedPractice', 'preparedFor']) {
    expect(file.text).toContain(command);
  }
  expect(calls(file)).toContain('samePracticePreparationKey');
  expect(calls(file)).toContain('samePracticeResourcePlan');
  const comparisons = nodes(file).filter(ts.isBinaryExpression).filter(n => [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind));
  expect(comparisons.filter(n => n.left.getText(file).endsWith('.resourcePlan') || n.right.getText(file).endsWith('.resourcePlan'))).toEqual([]);
});

it('PreparedPractice and Setup transaction state carry a key rather than a second configuration identity', () => {
  const prepared = source('lib/practice/preparation/prepared-practice.ts');
  expect(nodes(prepared).filter(ts.isPropertySignature).map(n => n.name.getText(prepared)).sort()).toEqual(['binding','bundle','key']);
  const setup = source(`${route}/setup/page.tsx`);
  expect(calls(setup)).toContain('createPracticePreparationKey');
  expect(calls(setup)).toContain('samePracticePreparationKey');
  expect(nodes(setup).filter(ts.isBinaryExpression).filter(n => [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind))
    .some(n => [n.left.getText(setup), n.right.getText(setup)].some(value => /(^|\.)configuration$/.test(value)))).toBe(false);
  const practice = source(`${route}/page.tsx`);
  expect(calls(practice)).toContain('preparedFor');
  expect(calls(practice)).toContain('enterPractice');
  expect(calls(practice)).not.toContain('admitPracticeBundle');
});

it('route metadata and binding observation retain their limited capabilities', () => {
  const metadata = source('hooks/practice/use-practice-route-score.ts');
  const observer = source('hooks/practice/use-practice-resource-binding.ts');
  for (const file of [metadata, observer]) {
    expect(calls(file).filter(call => /(^|\.)(open|close|beginPreparation|commitPreparedPractice|clearPreparedPractice|clearReviewSession|enterSetup|enterPractice)$/.test(call))).toEqual([]);
  }
  expect(calls(metadata)).toContain('useScoreDetail');
  expect(calls(metadata)).toContain('router.replace');
  expect(calls(observer).some(call => call.endsWith('.borrowRoots'))).toBe(true);
  for (const name of ['hooks/practice/use-practice-execution.ts', 'lib/practice/application/practice-execution-actor.ts']) {
    expect(calls(source(name)).filter(call => /(^|\.)(getUserMedia|requestMIDIAccess|acquireStream|acquireMidi)$/.test(call))).toEqual([]);
  }
});
