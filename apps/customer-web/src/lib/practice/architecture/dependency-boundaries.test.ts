// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve('src');
const practiceRoot = path.join(sourceRoot, 'lib/practice');
const normalize = (file: string) => file.split(path.sep).join('/');

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__fixtures__' ? [] : productionFiles(file);
    }
    return /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file) ? [file] : [];
  }).sort();
}

type Edge = { specifier: string; target: string | null; typeOnly: boolean; bindings: string[] };
function imports(file: string, text = readFileSync(file, 'utf8')): Edge[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edges: Edge[] = [];
  const add = (specifier: string, typeOnly: boolean, bindings: string[] = []) => {
    const base = specifier.startsWith('@/') ? path.join(sourceRoot, specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
    const target = base === null ? null
      : [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile()) ?? base;
    edges.push({ specifier, target: target === null ? null : normalize(target), typeOnly, bindings });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const bindings = clause?.namedBindings;
      const typeOnly = ts.isExportDeclaration(node) ? node.isTypeOnly
        : Boolean(clause?.isTypeOnly || (bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly)));
      const names = bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map(binding => (binding.propertyName ?? binding.name).text) : [];
      add(node.moduleSpecifier.text, typeOnly, names);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text, true, node.qualifier ? [node.qualifier.getText(source)] : []);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (normalize(file).startsWith(normalize(practiceRoot) + '/')) {
        expect(node.arguments.length, `${file}: static dependency required`).toBe(1);
        expect(ts.isStringLiteral(node.arguments[0]), `${file}: computed dependency bypass`).toBe(true);
      }
      if (ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

const files = productionFiles(practiceRoot);
const relative = (file: string) => normalize(path.relative(practiceRoot, file));
const graph = new Map(files.map(file => [normalize(file), imports(file)]));
const sourceGraph = new Map(productionFiles(sourceRoot).map(file => [
  normalize(file), graph.get(normalize(file)) ?? imports(file),
]));
const domain = (file: string) => file.startsWith('kernel/') ? 'kernel'
  : file.startsWith('step/domain/') ? 'step/domain'
    : file.startsWith('continuous/domain/') ? 'continuous/domain' : null;

function dependencyAllowed(file: string, edge: Edge): boolean {
  const source = relative(file);
  const target = edge.target ? relative(edge.target) : null;
  const owner = domain(source);
  const targetOwner = target ? domain(target) : null;
  if (source === 'continuous/domain/performance-clock.ts') return targetOwner === 'kernel';
  if (owner) {
    return targetOwner === 'kernel' || targetOwner === owner
      || (owner === 'kernel' && edge.typeOnly
        && edge.target === normalize(path.join(sourceRoot, 'generated/api/types.gen.ts')));
  }
  for (const infrastructure of ['midi/', 'metronome/']) {
    if (source.startsWith(infrastructure)) return targetOwner === 'kernel' || Boolean(target?.startsWith(infrastructure));
  }
  if (source.startsWith('step/')) return !target?.startsWith('continuous/');
  if (source.startsWith('continuous/')) return !target?.startsWith('step/');
  return true;
}

describe('Practice bounded domain dependencies', () => {
  it('has concrete owners and no common mode barrel', () => {
    expect(existsSync(path.join(practiceRoot, 'local-core'))).toBe(false);
    for (const [file, edges] of sourceGraph) {
      expect(edges.map(edge => edge.specifier), relative(file)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/(?:^|\/)local-core(?:\/|$)/)])
      );
    }
    for (const owner of ['kernel', 'step/domain', 'continuous/domain']) {
      expect(existsSync(path.join(practiceRoot, owner, 'index.ts'))).toBe(false);
    }
  });

  it('keeps kernel and mode domains pure and independent', () => {
    for (const file of files) {
      const owner = domain(relative(file));
      if (!owner) continue;
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const browserGlobals = new Set(['window', 'document', 'navigator', 'React', 'HTMLElement', 'HTMLMediaElement',
        'MediaStream', 'MediaRecorder', 'AudioContext', 'Worker', 'MIDIAccess', 'MIDIInput', 'fetch', 'WebSocket',
        'EventSource', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'requestAnimationFrame']);
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node)) expect(browserGlobals.has(node.text), `${relative(file)}: ${node.text}`).toBe(false);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  });

  it('enforces infrastructure and application direction on every production import', () => {
    for (const [file, edges] of graph) {
      for (const edge of edges) expect(dependencyAllowed(file, edge), `${relative(file)} -> ${edge.specifier}`).toBe(true);
    }
  });

  it('rejects mode knowledge in shared MIDI and metronome imports, including type-only imports', () => {
    for (const infrastructure of ['midi', 'metronome']) {
      const file = path.join(practiceRoot, infrastructure, 'boundary-probe.ts');
      for (const mode of ['step', 'continuous']) {
        for (const declaration of [
          `import type { Session } from '@/lib/practice/${mode}/domain/session';`,
          `export * from '../${mode}/domain/session';`,
          `type Session = import('@/lib/practice/${mode}/domain/session').Session;`,
        ]) {
          const edges = imports(file, declaration);
          expect(edges).toHaveLength(1);
          expect(dependencyAllowed(file, edges[0]), declaration).toBe(false);
        }
      }
      expect(dependencyAllowed(file, imports(file, "import type { SessionTime } from '@/lib/practice/kernel/timebase';")[0])).toBe(true);
    }
  });

  it('keeps acoustic implementation score-blind and publication contract-only', () => {
    for (const file of files.filter(file => relative(file).startsWith('acoustic/'))) {
      for (const edge of graph.get(normalize(file))!) {
        if (!edge.target) {
          expect(edge.specifier, relative(file)).toBe('onnxruntime-web/webgpu');
          continue;
        }
        const target = relative(edge.target);
        const acoustic = target.startsWith('acoustic/');
        const modelDelivery = edge.target.startsWith(normalize(path.join(sourceRoot, 'lib/model-assets')) + '/');
        const publicationContract = relative(file).startsWith('acoustic/continuous/') && edge.typeOnly
          && target === 'continuous/domain/evaluation/evidence-types.ts'
          && edge.bindings.length > 0 && edge.bindings.every(name => name === 'ContinuousEvidencePublication');
        expect(acoustic || modelDelivery || publicationContract, `${relative(file)} -> ${edge.specifier}`).toBe(true);
      }
    }
  });

  it('uses explicit owner imports across bounded contexts', () => {
    const context = (file: string) => file.includes('/') ? file.split('/')[0] : 'application';
    for (const file of files) {
      for (const edge of graph.get(normalize(file))!) {
        if (!edge.target || !edge.specifier.startsWith('.') || !edge.target.startsWith(normalize(practiceRoot) + '/')) continue;
        expect(context(relative(edge.target)), `${relative(file)} -> ${edge.specifier}`).toBe(context(relative(file)));
      }
    }
  });

  it('separates raw assignment mechanics from source interpretation and presentation', () => {
    const rawModules = new Set(['assignment-types.ts', 'evidence-types.ts', 'matching.ts', 'observation-store.ts',
      'finalization-policy.ts', 'assignment-finalizer.ts', 'assignment-projection.ts', 'evaluation-error.ts', 'immutable-value.ts']);
    const evaluationRoot = 'continuous/domain/evaluation/';
    for (const file of files) {
      const name = relative(file);
      if (name.startsWith(evaluationRoot) && rawModules.has(path.basename(file))) {
        for (const edge of graph.get(normalize(file))!) {
          expect(edge.target && relative(edge.target).startsWith(evaluationRoot) && rawModules.has(path.basename(edge.target)), name + ' -> ' + edge.specifier).toBe(true);
        }
      }
      if (name === evaluationRoot + 'interpretation.ts') {
        for (const edge of graph.get(normalize(file))!) {
          expect(!edge.target || !['matching.ts', 'assignment-finalizer.ts', 'finalization-policy.ts', 'session.ts'].some(name => relative(edge.target!) === evaluationRoot + name), edge.specifier).toBe(true);
        }
      }
    }
    const presentation = [
      ...productionFiles(path.join(sourceRoot, 'components/practice')),
      ...productionFiles(path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice')),
      path.join(practiceRoot, 'performance-annotation-controller.ts'),
      path.join(practiceRoot, 'continuous/review-summary.ts'),
    ];
    for (const file of presentation) {
      for (const edge of imports(file)) {
        expect(!edge.target || !relative(edge.target).startsWith(evaluationRoot) ||
          ['evaluation-types.ts', 'interpretation-types.ts'].includes(path.basename(edge.target)), file + ' -> ' + edge.specifier).toBe(true);
      }
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node)) expect(node.name.text, file).not.toBe('assignment');
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  });

  it('only evaluation composition imports the source-specific interpreter in production', () => {
    const interpreter = normalize(path.join(practiceRoot, 'continuous/domain/evaluation/interpretation.ts'));
    const composition = normalize(path.join(practiceRoot, 'continuous/domain/evaluation/session.ts'));
    const allowed = (file: string, edge: Edge) => edge.target !== interpreter || normalize(file) === composition;
    for (const [file, edges] of sourceGraph) {
      for (const edge of edges) expect(allowed(file, edge), file + ' -> ' + edge.specifier).toBe(true);
    }
    for (const source of ['continuous/continuous-practice-controller.ts', 'performance-annotation-controller.ts']) {
      const file = path.join(practiceRoot, source);
      for (const statement of [
        "import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';",
        "export { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';",
        "const module = import('@/lib/practice/continuous/domain/evaluation/interpretation');",
      ]) expect(allowed(file, imports(file, statement)[0]), statement).toBe(false);
    }
    expect(allowed(composition, imports(composition, "import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';")[0])).toBe(true);
  });

  it('has no production module dependency cycles', () => {
    const completed = new Set<string>();
    const visit = (file: string, stack: string[]) => {
      expect(stack.includes(file), stack.concat(file).map(relative).join(' -> ')).toBe(false);
      if (completed.has(file)) return;
      for (const edge of graph.get(file) ?? []) if (edge.target && graph.has(edge.target)) visit(edge.target, stack.concat(file));
      completed.add(file);
    };
    for (const file of graph.keys()) visit(file, []);
  });
});
