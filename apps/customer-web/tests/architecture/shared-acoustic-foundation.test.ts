import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root = path.resolve('src'), acoustic = path.join(root, 'lib/practice/acoustic');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name))
    : /\.(ts|tsx|js)$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(dir, e.name)] : []);
}
const active = files(root), foundation = ['model', 'source', 'runtime'].flatMap(d => files(path.join(acoustic, d)));
function imports(file: string): string[] {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.flatMap(n => {
    if (!(ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) || !n.moduleSpecifier || !ts.isStringLiteral(n.moduleSpecifier)) return [];
    if (ts.isImportDeclaration(n) && n.importClause?.isTypeOnly) return [];
    const s = n.moduleSpecifier.text, base = s.startsWith('@/') ? path.join(root, s.slice(2)) : s.startsWith('.') ? path.resolve(path.dirname(file), s) : null;
    if (!base) return [];
    return [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].filter(f => active.includes(f));
  });
}
function reach(entry: string) {
  const seen = new Set<string>(), pending = [entry];
  while (pending.length) { const f = pending.pop()!; if (seen.has(f)) continue; seen.add(f); pending.push(...imports(f)); }
  return [...seen];
}
it('one active ONNX execution implementation, Worker entry and PCM Worklet', () => {
  expect(active.filter(f => /InferenceSession\.create\(/.test(readFileSync(f, 'utf8')))).toEqual([path.join(acoustic, 'model/model-inference.ts')]);
  expect(active.filter(f => f.endsWith('worker.entry.ts'))).toEqual([path.join(acoustic, 'model/acoustic-worker.entry.ts')]);
  expect(active.filter(f => /extends AudioWorkletProcessor/.test(readFileSync(f, 'utf8')))).toEqual([path.join(acoustic, 'source/capture.worklet.js')]);
});
it('shared source/model/runtime has no mode, target or performance-domain dependency', () => {
  for (const file of foundation) {
    expect(imports(file).filter(f => /[/\\]continuous[/\\]|step-runtime|step-evidence|continuous-finalizer|performance-runtime/.test(f))).toEqual([]);
    expect(readFileSync(file, 'utf8')).not.toMatch(/performanceTimeMs|performanceStartMs|expectedPitch|expectedGroup|activationGeneration|musicalBeat|\.seek\(/);
  }
  const projection = readFileSync(path.join(acoustic, 'continuous/publication.ts'), 'utf8');
  expect(projection).toContain('performanceTimeMs:');
  expect(projection).toContain('sourceEventSample:');
});
it('Original provider, loaders, endpoints and old active FIR/capture paths are absent', () => {
  for (const p of ['lib/practice/acoustic-inference/bytedance-onnx-provider.ts','lib/model-assets/bytedance-model-loader.ts',
    'lib/api/model-assets.ts','lib/api/continuous-model-asset.ts']) expect(existsSync(path.join(root, p))).toBe(false);
  expect(existsSync('public/model-assets/continuous/fir-1-3.f32')).toBe(false);
  const router = readFileSync('../../backend/app/modules/model_assets/router.py', 'utf8');
  expect(router.match(/@router\.get\(/g)).toHaveLength(1);
  expect(router).toContain('/practice-acoustic-robust-browser-v1/access');
  expect(router).not.toMatch(/bytedance-note|continuous-robust-browser-v1/);
  for (const f of active) expect(imports(f).join('\n')).not.toMatch(/research|bytedance-onnx-provider|bytedance-model-loader|acoustic-inference[/\\]continuous/);
});
it('product domain cannot reach model infrastructure and MIDI STEP cannot reach acoustic execution', () => {
  const finalizer = path.join(root, 'lib/practice/local-core/continuous-finalizer.ts');
  expect(reach(finalizer).filter(f => f.startsWith(acoustic))).toEqual([]);
  const step = path.join(root, 'hooks/practice/use-step-local-practice.ts');
  expect(reach(step).filter(f => f.startsWith(acoustic))).toEqual([]);
});
