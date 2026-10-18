import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { expect, it } from 'vitest';
const base = 'src/lib/practice/acoustic';
async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(file));
    else if (!file.endsWith('.test.ts') && /\.(ts|js)$/.test(file)) result.push(file);
  }
  return result;
}
it('one capture implementation, one Worklet and one model runtime, with no upward capture imports', async () => {
  const sources = await Promise.all((await files(base)).map(async path => ({ path, text: await readFile(path, 'utf8') })));
  expect(sources.filter(f => f.text.includes('registerProcessor(')).map(f => f.path)).toEqual([`${base}/source/capture.worklet.js`]);
  expect(sources.filter(f => f.text.includes('class BrowserAcousticCapture')).map(f => f.path)).toEqual([`${base}/source/capture.ts`]);
  expect(sources.filter(f => f.text.includes('InferenceSession.create('))).toHaveLength(1);
  for (const file of sources.filter(f => f.path.includes('/source/'))) {
    const ast = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
    for (const node of ast.statements) if (ts.isImportDeclaration(node)) {
      const imported = (node.moduleSpecifier as ts.StringLiteral).text;
      expect(imported).not.toMatch(/step|continuous|local-core|react|history/i);
    }
  }
});
it('startup restart is confined before ACTIVE; no alternate transport, PCM padding or boundary quantization', async () => {
  const worklet = await readFile(`${base}/source/capture.worklet.js`, 'utf8');
  expect(worklet).toContain("if (this.state === 'ACTIVE') { this.fail('ACOUSTIC_CAPTURE_FRAME_DISCONTINUITY'); return false; }");
  expect(worklet.match(/this\.originFrame = this\.blockStartFrame/g)).toHaveLength(1);
  expect(worklet).toContain("if (this.state === 'STABILIZING') { this.originFrame");
  expect(worklet).not.toMatch(/fallback|legacy|setTimeout|samples\.fill|accumulator\.fill/i);
  expect(worklet).toContain('this.filled === CAPTURE_TRANSPORT_BLOCK_SAMPLES');
  const bridge = await readFile(`${base}/continuous/capture-bridge.ts`, 'utf8');
  expect(bridge).not.toContain('CAPTURE_TRANSPORT_BLOCK_SAMPLES');
  expect(bridge).toContain('this.boundaries[0]?.sourceSampleIndex');
});
