import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('Browser performance ownership', () => {
  const allowed: Record<string, string[]> = {
    rational: ['@/generated/api'],
    plan: ['@/generated/api', './rational'],
    time: ['./plan', './rational'],
    'written-realization': ['@tonejs/midi', 'midi-file', './rational'],
    timeline: ['./plan', './rational', './time', './written-realization'],
  };
  it.each(Object.entries(allowed))(
    '%s has only transport, realization or pure performance dependencies',
    (module, dependencies) => {
      const source = readFileSync(
        resolve(process.cwd(), `src/lib/score/performance/${module}.ts`),
        'utf8'
      );
      const file = ts.createSourceFile(
        module,
        source,
        ts.ScriptTarget.Latest,
        true
      );
      for (const node of file.statements) {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          expect(dependencies).toContain(node.moduleSpecifier.text);
        }
      }
    }
  );
});
