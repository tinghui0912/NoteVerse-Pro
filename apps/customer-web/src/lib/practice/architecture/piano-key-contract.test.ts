import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const app = process.cwd(), root = path.resolve(app, '../..'), practice = path.join(app, 'src/lib/practice');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name))
    : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path.join(dir, entry.name)] : []);
}
describe('canonical Practice ownership', () => {
  it('keeps physical-key validity in score and source-neutral modes free of pitch-name comparison/grammar', () => {
    for (const dir of ['score', 'session', 'step/domain', 'continuous/domain']) for (const file of files(path.join(practice, dir))) {
      const text = readFileSync(file, 'utf8');
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) expect(node.moduleSpecifier.text).not.toContain('/acoustic/');
        if (ts.isPropertyAccessExpression(node)) expect(node.name.text, file).not.toBe('pitch');
        if (ts.isRegularExpressionLiteral(node)) expect(node.text, file).not.toContain('[A-G]');
        ts.forEachChild(node, visit);
      }; visit(tree);
    }
    for (const file of ['src/lib/practice/planning/scope.ts', 'src/app/[locale]/(workspace)/score/[id]/practice/setup/page.tsx',
      'src/app/[locale]/(workspace)/score/[id]/practice/page.tsx']) {
      const text = readFileSync(path.join(app, file), 'utf8');
      expect(text).not.toMatch(/(?:>=|<=)\s*(?:21|108)\b/);
    }
    expect(read('apps/customer-web/src/lib/practice/score/artifact.ts')).not.toContain('@/generated/');
    expect(read('apps/customer-web/src/lib/practice/planning/scope.ts')).not.toContain('isPracticePianoKey');
  });
  it('declares the durable score artifact schema at its domain owner', () => {
    expect(read('apps/customer-web/src/lib/practice/score/artifact.ts')).toContain('PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1');
    expect(read('backend/app/modules/practice/bundle/schemas.py')).toContain('schemaVersion: Literal[1]');

  });
  it('documents unique current parameter entries and explicit raw-work qualification', () => {
    const ledger = read('docs/architecture/practice-acoustic-parameter-provenance.md');
    const rows = ledger.split('\n').filter(line => /^\| [A-Z]\d{2} /.test(line));
    const ids = rows.map(row => row.split(' ')[1]);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(rows.length);
    for (const row of rows) {
      const cells = row.split(' | ');
      expect(cells).toHaveLength(9);
      expect(cells.slice(1).every(cell => cell.trim().length > 0)).toBe(true);
    }
    const rawWork = rows.find(row => row.startsWith('| T15 '));
    expect(rawWork).toContain('UNQUALIFIED_RESOURCE_SAFETY_POLICY');
    expect(rawWork).toContain('128');
  });
});
