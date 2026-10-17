import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { evaluatePracticeInputCapabilities } from '../input-capability';

const root = path.resolve(__dirname, '../../../..');
const source = path.join(root, 'src');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? entry.name === '__fixtures__' ? [] : files(path.join(dir, entry.name))
    : /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
const all = files(source), known = new Set(all);
function tree(file: string) { return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true); }
function imports(file: string) {
  return tree(file).statements.flatMap(node => {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return [];
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return [];
    const spec = node.moduleSpecifier.text;
    const base = spec.startsWith('@/') ? path.join(source, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
    return base ? [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].filter(p => known.has(p)) : [];
  });
}
function reach(file: string): string[] {
  const visited = new Set<string>(), pending = [file];
  while (pending.length) { const current = pending.pop()!; if (visited.has(current)) continue; visited.add(current); pending.push(...imports(current)); }
  return [...visited];
}
function constructions(file: string) {
  const ast = tree(file), names: string[] = [];
  function visit(node: ts.Node) { if (ts.isNewExpression(node)) names.push(node.expression.getText(ast)); ts.forEachChild(node, visit); }
  visit(ast); return names;
}
const controller = path.join(__dirname, 'continuous-practice-controller.ts');
it('the React Continuous hook constructs only its application owner', () => {
  const hook = path.join(source, 'hooks/practice/use-local-practice.ts');
  expect(constructions(hook)).toEqual(['Error', 'Error', 'ContinuousPracticeController']);
  expect(imports(hook).filter(p => /acoustic-inference|model-assets/.test(p))).toEqual([]);
});
it('one controller constructs one product session, never a second evaluator', () => {
  const names = constructions(controller);
  expect(names.filter(n => n === 'ContinuousPracticeSession')).toHaveLength(1);
  expect(names).not.toContain('ContinuousFinalizer'); expect(names).not.toContain('ContinuousEvaluationSession');
  const input = path.join(__dirname, 'continuous-microphone-input.ts');
  expect(reach(input).filter(p => /continuous-finalizer|continuous-expected-strikes|performance-runtime/.test(p))).toEqual([]);
});
it('product finalizer has no acoustic model dependency', () => {
  expect(reach(path.join(source, 'lib/practice/local-core/continuous-finalizer.ts')).filter(p => p.includes('acoustic-inference'))).toEqual([]);
});
it('active Continuous has no old worker, research namespace, or output timestamp mapper', () => {
  const product = reach(controller);
  expect(product.filter(p => /bytedance-worker|research|continuous-capture-clock-synchronizer/.test(p))).toEqual([]);
  for (const file of product) expect(readFileSync(file, 'utf8')).not.toContain('getOutputTimestamp');
  expect(all.filter(p => /bytedance-worker-(entry|client|factory|protocol)/.test(p))).toEqual([]);
});
it('both microphone product capabilities stay unavailable', () => {
  const capabilities = evaluatePracticeInputCapabilities();
  expect(capabilities.acousticAnalysis.continuous.status).toBe('MODEL_NOT_VALIDATED');
  expect(capabilities.acousticAnalysis.step.status).toBe('ATTEMPT_ANALYZER_NOT_VALIDATED');
});
