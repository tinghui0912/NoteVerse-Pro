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
  const presentationOwners = ['score-view/', 'review/', 'sharing/'];
  if (['kernel/', 'step/', 'continuous/', 'acoustic/', 'result/', 'recording/'].some(owner => source.startsWith(owner))
    && target && presentationOwners.some(owner => target.startsWith(owner))) return false;
  if (source.startsWith('score-view/')) {
    if (target?.startsWith('score-view/') || target?.startsWith('kernel/')) return true;
    if (source === 'score-view/verovio-adapter.ts' && edge.target === normalize(path.join(sourceRoot, 'lib/score/verovio/index.ts'))) return true;
    return source === 'score-view/evaluation-annotations.ts' && edge.typeOnly
      && target === 'continuous/domain/evaluation/evaluation-types.ts'
      && edge.bindings.length > 0 && edge.bindings.every(name => ['ContinuousEvaluationSnapshot', 'CompletedContinuousEvaluation'].includes(name));
  }
  if (source.startsWith('review/')) return Boolean(target && (['review/', 'result/', 'kernel/', 'score-view/'].some(owner => target.startsWith(owner))
    || ['recording/recording-artifact.ts', 'recording/recording-timebase.ts', 'recording/performance-replay.ts'].includes(target)));
  if (source.startsWith('sharing/video/')) {
    if (edge.specifier === 'react') return source === 'sharing/video/preview.tsx';
    if (edge.target === normalize(path.join(sourceRoot, 'lib/api/performance-takes.ts'))) return source === 'sharing/video/saved-take-adapter.ts' && edge.typeOnly;
    return Boolean(target && (target.startsWith('sharing/video/') || target.startsWith('kernel/')
      || ['recording/recording-artifact.ts', 'recording/recording-timebase.ts', 'score-view/verovio-adapter.ts',
        'score-view/playhead-cursor.ts', 'score-view/scope-timing.ts', 'score-view/decorations.ts', 'score-view/cursor-scope.ts'].includes(target)));
  }
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
  if (source.startsWith('result/')) return Boolean(target && (
    target.startsWith('result/') || target.startsWith('kernel/') || target.startsWith('continuous/domain/evaluation/')
    || ['acoustic/model/analysis-identity.ts', 'acoustic/model/model-contract.ts', 'continuous/input/midi-evidence-identity.ts'].includes(target)));
  if (source.startsWith('recording/')) return Boolean(target && (target.startsWith('recording/') || target.startsWith('kernel/')));
  if (source.startsWith('step/')) return !target || !['continuous/', 'result/', 'recording/'].some(owner => target.startsWith(owner));
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
      if (!owner && !relative(file).startsWith('result/')) continue;
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const browserGlobals = new Set(['window', 'document', 'navigator', 'React', 'HTMLElement', 'HTMLMediaElement',
        'Blob', 'MediaStream', 'MediaRecorder', 'AudioContext', 'Worker', 'MIDIAccess', 'MIDIInput', 'fetch', 'WebSocket',
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
      path.join(practiceRoot, 'score-view/evaluation-annotations.ts'),
      ...productionFiles(path.join(practiceRoot, 'review')),
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
    for (const source of ['continuous/continuous-practice-controller.ts', 'score-view/evaluation-annotations.ts']) {
      const file = path.join(practiceRoot, source);
      for (const statement of [
        "import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';",
        "export { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';",
        "const module = import('@/lib/practice/continuous/domain/evaluation/interpretation');",
      ]) expect(allowed(file, imports(file, statement)[0]), statement).toBe(false);
    }
    expect(allowed(composition, imports(composition, "import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';")[0])).toBe(true);
  });

  it('keeps result, recording and STEP ownership separate, including hooks and boundary probes', () => {
    for (const [file, edges] of sourceGraph) {
      if (normalize(file) === normalize(path.join(sourceRoot, 'hooks/practice/use-step-local-practice.ts'))) {
        for (const edge of edges) {
          const target = edge.target ? relative(edge.target) : '';
          expect(['result/', 'recording/', 'continuous/'].some(owner => target.startsWith(owner)), edge.specifier).toBe(false);
        }
      }
    }
    for (const [owner, forbidden] of [
      ['result', ['recording/performance-recorder', 'step/domain/runtime']],
      ['recording', ['result/continuous-performance-result', 'continuous/domain/evaluation/interpretation', 'step/domain/runtime']],
      ['step', ['result/continuous-performance-result', 'recording/recording-artifact', 'continuous/completion-store']],
    ] as const) {
      const file = path.join(practiceRoot, owner, 'boundary-probe.ts');
      for (const target of forbidden) for (const statement of [
        `import type { Contract } from '@/lib/practice/${target}';`,
        `export * from '@/lib/practice/${target}';`,
        `type Contract = import('@/lib/practice/${target}').Contract;`,
      ]) expect(dependencyAllowed(file, imports(file, statement)[0]), owner + ' -> ' + target).toBe(false);
    }
    const composition = path.join(practiceRoot, 'continuous/completion.ts');
    for (const target of ['result/continuous-performance-result', 'recording/recording-artifact']) {
      expect(dependencyAllowed(composition, imports(composition, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(true);
    }
  });

  it('exposes concrete result/recording owners and keeps metrics projection out of presentation', () => {
    for (const file of ['result/continuous-performance-result.ts', 'result/continuous-performance-metrics.ts',
      'recording/recording-artifact.ts', 'recording/recording-timebase.ts', 'recording/performance-recorder.ts',
      'recording/performance-replay.ts', 'continuous/completion.ts', 'continuous/completion-store.ts']) {
      expect(existsSync(path.join(practiceRoot, file)), file).toBe(true);
    }
    for (const file of ['completed-performance.ts', 'performance-recorder.ts', 'performance-replay.ts']) {
      expect(existsSync(path.join(practiceRoot, file)), file).toBe(false);
    }
    const metricsOwner = normalize(path.join(practiceRoot, 'result/continuous-performance-metrics.ts'));
    for (const [file, edges] of sourceGraph) {
      if (!file.includes('/components/practice/') && !file.includes('/practice/review/')) continue;
      for (const edge of edges) if (edge.target === metricsOwner) expect(edge.typeOnly, file + ' -> ' + edge.specifier).toBe(true);
    }
  });

  it('keeps result creation natural-only and abandonment free of completion work', () => {
    for (const [file, edges] of sourceGraph) for (const edge of edges) {
      if (edge.bindings.includes('createContinuousPerformanceResult')) {
        expect(relative(file)).toBe('continuous/natural-completion.ts');
      }
      const share = relative(file).startsWith('sharing/video/');
      if (share && edge.target) {
        const target = relative(edge.target);
        expect(target.startsWith('result/') || target.startsWith('continuous/'), file + ' -> ' + target).toBe(false);
      }
    }
    const controller = path.join(practiceRoot, 'continuous/continuous-practice-controller.ts');
    const source = ts.createSourceFile(controller, readFileSync(controller, 'utf8'), ts.ScriptTarget.Latest, true);
    const forbidden = new Set(['completedEvaluation', 'createContinuousPerformanceResult', 'createNaturalContinuousCompletion',
      'createContinuousPerformanceMetrics', 'finalize', 'setCompletion', 'onNaturalCompletion', 'finish']);
    let checked = false;
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'abandon') {
        checked = true;
        const inspect = (child: ts.Node) => {
          if (ts.isCallExpression(child)) {
            const name = ts.isPropertyAccessExpression(child.expression) ? child.expression.name.text : child.expression.getText(source);
            expect(forbidden.has(name), 'abandon calls ' + name).toBe(false);
          }
          ts.forEachChild(child, inspect);
        };
        ts.forEachChild(node, inspect);
      }
      ts.forEachChild(node, visit);
    };
    visit(source); expect(checked).toBe(true);
    const saveHook = productionFiles(path.join(sourceRoot, 'hooks')).find(file => readFileSync(file, 'utf8').includes('export function useSavePerformanceTake'));
    expect(saveHook).toBeDefined();
    for (const edge of imports(saveHook!)) {
      expect(edge.target && relative(edge.target).startsWith('result/'), edge.specifier).toBeFalsy();
      expect(edge.bindings.some(name => ['ContinuousPracticeCompletion', 'ContinuousPerformanceResult', 'CompletedContinuousEvaluation', 'ContinuousPerformanceMetrics'].includes(name))).toBe(false);
    }
  });

  it('keeps rendering, review and sharing under their concrete owners without root bridges', () => {
    for (const owner of ['score-view', 'review', 'sharing', 'sharing/video']) expect(existsSync(path.join(practiceRoot, owner, 'index.ts'))).toBe(false);
    for (const name of ['verovio-adapter', 'playhead-cursor', 'practice-scroll', 'performance-playhead-controller',
      'step-playhead-controller', 'performance-annotation-controller', 'range-selection', 'scope-timing', 'floating-score-svg',
      'share-video-export', 'share-video-frame-renderer', 'share-video-playback-position', 'share-video-preview',
      'share-video-score-camera', 'share-video-score-model', 'share-video-session', 'share-video-templates']) {
      for (const ext of ['.ts', '.tsx']) expect(existsSync(path.join(practiceRoot, name + ext)), name + ext).toBe(false);
    }
    const viewer = normalize(path.join(sourceRoot, 'components/practice/practice-score-viewer.tsx'));
    for (const edge of sourceGraph.get(viewer)!) {
      if (!edge.target) continue;
      const target = relative(edge.target);
      expect(['review/', 'sharing/', 'result/', 'recording/'].some(owner => target.startsWith(owner)), edge.specifier).toBe(false);
    }
    const studio = normalize(path.join(sourceRoot, 'components/practice/share-video-studio.tsx'));
    for (const edge of sourceGraph.get(studio)!) {
      if (edge.target && relative(edge.target).startsWith('sharing/')) expect(['session.ts', 'export.ts', 'templates.ts', 'preview.tsx']).toContain(path.basename(edge.target));
    }
  });

  it('rejects reverse presentation edges and source/evaluation knowledge outside their adapters', () => {
    for (const source of ['kernel/artifact.ts', 'step/domain/runtime.ts', 'continuous/domain/practice-session.ts',
      'step/step-practice-controller.ts', 'continuous/continuous-practice-controller.ts', 'acoustic/runtime/source-publication.ts',
      'result/continuous-performance-result.ts', 'recording/recording-artifact.ts']) {
      for (const target of ['score-view/decorations', 'review/review-view-model', 'sharing/video/session']) {
        const file = path.join(practiceRoot, source);
        expect(dependencyAllowed(file, imports(file, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
      }
    }
    for (const source of ['score-view/dom.ts', 'review/review-replay.ts', 'sharing/video/session.ts', 'sharing/video/current-completion-adapter.ts']) {
      const file = path.join(practiceRoot, source);
      for (const target of ['continuous/domain/evaluation/evaluation-types', 'recording/performance-recorder', 'sharing/video/export']) {
        if (source.startsWith('sharing/') && target === 'sharing/video/export') continue;
        expect(dependencyAllowed(file, imports(file, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
      }
      expect(dependencyAllowed(file, imports(file, "import type { PerformanceTakeRead } from '@/lib/api/performance-takes';")[0])).toBe(false);
    }
    for (const file of files.filter(file => relative(file).startsWith('review/'))) {
      const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node)) expect(['fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest'].includes(node.text), relative(file)).toBe(false);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  });

  it('keeps sharing source-neutral through transitive imports and renderer exports', () => {
    for (const start of files.filter(file => relative(file).startsWith('sharing/video/'))) {
      const visited = new Set<string>();
      const visit = (file: string) => {
        if (visited.has(file)) return;
        visited.add(file);
        for (const edge of sourceGraph.get(file) ?? []) {
          if (!edge.target) continue;
          const target = relative(edge.target);
          expect(['result/', 'continuous/', 'step/', 'review/'].some(owner => target.startsWith(owner)), relative(start) + ' -> ' + target).toBe(false);
          if (sourceGraph.has(edge.target)) visit(edge.target);
        }
      };
      visit(normalize(start));
    }
    for (const file of productionFiles(path.join(practiceRoot, 'review'))) for (const edge of imports(file)) {
      expect(edge.bindings.includes('createContinuousPerformanceMetrics'), file).toBe(false);
    }
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
