import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  it('keeps physical-key validity in kernel and source-neutral modes free of pitch-name comparison/grammar', () => {
    for (const dir of ['kernel', 'step/domain', 'continuous/domain']) for (const file of files(path.join(practice, dir))) {
      const text = readFileSync(file, 'utf8');
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) expect(node.moduleSpecifier.text).not.toContain('/acoustic/');
        if (ts.isPropertyAccessExpression(node)) expect(node.name.text, file).not.toBe('pitch');
        if (ts.isRegularExpressionLiteral(node)) expect(node.text, file).not.toContain('[A-G]');
        ts.forEachChild(node, visit);
      }; visit(tree);
      expect(text).not.toContain('STEP_TARGET_INVALID'); expect(text).not.toContain('STEP_DOMAIN_PITCH');
    }
    for (const file of ['src/lib/practice/kernel/scope.ts', 'src/app/[locale]/(workspace)/score/[id]/practice/setup/page.tsx',
      'src/app/[locale]/(workspace)/score/[id]/practice/page.tsx']) {
      const text = readFileSync(path.join(app, file), 'utf8');
      expect(text).not.toMatch(/(?:>=|<=)\s*(?:21|108)\b/);
    }
    expect(read('apps/customer-web/src/lib/practice/kernel/artifact.ts')).not.toContain('@/generated/');
    expect(read('apps/customer-web/src/lib/practice/kernel/scope.ts')).not.toContain('isPracticePianoKey');
  });
  it('has one current artifact/Result reader and no independent target catalog architecture', () => {
    expect(read('apps/customer-web/src/lib/practice/kernel/artifact.ts')).toContain('PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 2');
    expect(read('apps/customer-web/src/lib/practice/result/continuous-performance-result.ts')).toContain('CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION = 7');
    expect(read('backend/app/modules/practice/source_schemas.py')).toContain('schemaVersion: Literal[2]');
    expect(read('backend/app/modules/practice/source_router.py')).not.toContain('/targets');
    expect(read('backend/app/modules/practice/source_service.py')).not.toContain('list_practice_targets');
    expect(existsSync(path.join(root, 'backend/app/processing/practice_score/target_catalog.py'))).toBe(false);
    expect(read('apps/customer-web/src/lib/practice/step/domain/runtime.ts')).not.toContain('this.resolvedScope.endIndex; index++');
  });
  it('preserves all93 primary ledger memberships and deferred raw-work status', () => {
    const ledger = read('docs/architecture/practice-acoustic-parameter-provenance.md');
    const rows = ledger.split('\n').filter(line => /^\| [A-Z]\d{2} /.test(line));
    expect(rows).toHaveLength(93);
    const expected: Record<string, number> = { VERIFIED_MODEL_OR_ASSET_CONTRACT: 18, UNQUALIFIED_ALGORITHM_POLICY: 19,
      PROVEN_STRUCTURAL_INVARIANT: 24, REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC: 12, EMPIRICALLY_CHARACTERIZED: 2,
      UNQUALIFIED_RESOURCE_SAFETY_POLICY: 11, DIAGNOSTIC_PRESENTATION_POLICY: 7, SEMANTIC_NECESSITY_UNRESOLVED: 0 };
    for (const [classification, count] of Object.entries(expected)) expect(rows.filter(row => row.includes(`| ${classification} |`))).toHaveLength(count);
    expect(rows.find(row => row.startsWith('| T15 '))).toContain('| UNQUALIFIED_RESOURCE_SAFETY_POLICY |');
    expect(ledger).toContain('| B. DERIVE | None |');
  });
});
