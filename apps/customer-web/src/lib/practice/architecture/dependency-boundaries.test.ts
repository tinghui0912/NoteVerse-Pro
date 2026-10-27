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
  if (source.startsWith('acoustic/runtime/')) return Boolean(target && ['acoustic/runtime/', 'acoustic/model/', 'acoustic/source/'].some(owner => target.startsWith(owner)));
  if (source === 'continuous/input/midi-evidence.ts') return ['continuous/input/midi-evidence-identity.ts', 'continuous/domain/evaluation/resource-policy.ts'].includes(target ?? '')
    || edge.typeOnly && ['continuous/domain/clock-evidence-port.ts', 'continuous/domain/evaluation/evidence-types.ts'].includes(target ?? '');
  if (source.startsWith('device/')) return Boolean(target && (target.startsWith('device/') || target === 'kernel/session.ts'
    || target === 'recording/recording-mode.ts' || target === 'diagnostics/startup-timings.ts'));
  if (source.startsWith('continuous/timing/')) return Boolean(target && (target.startsWith('continuous/timing/') || target.startsWith('kernel/')));
  if (source.startsWith('configuration/')) return Boolean(target && (target.startsWith('configuration/')
    || target.startsWith('kernel/') || target === 'recording/recording-mode.ts'));
  if (source.startsWith('readiness/')) return Boolean(target && (target.startsWith('readiness/') || target.startsWith('configuration/')));
  if (source.startsWith('environment/')) return Boolean(target && (target.startsWith('environment/') || target.startsWith('acoustic/')
    || target.startsWith('readiness/') || ['recording/recorder-capability.ts', 'recording/recording-mode.ts'].includes(target)
    || edge.target === normalize(path.join(sourceRoot, 'lib/api/practice-acoustic-model-asset.ts'))));
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
    || target === 'continuous/timing/timing-provenance.ts'
    || ['acoustic/model/analysis-identity.ts', 'acoustic/model/model-contract.ts', 'continuous/input/midi-evidence-identity.ts'].includes(target)));
  if (source.startsWith('recording/')) return Boolean(target && (target.startsWith('recording/') || target.startsWith('kernel/')));
  if (source.startsWith('step/')) return !target || !['continuous/', 'result/', 'recording/'].some(owner => target.startsWith(owner));
  if (source.startsWith('continuous/')) return !target?.startsWith('step/');
  return true;
}

describe('Practice bounded domain dependencies', () => {
  it('keeps source publication identity and stream chronology independent of product domains', () => {
    const file = path.join(practiceRoot, 'acoustic/runtime/source-publication.ts');
    for (const target of ['step/step-acoustic-attempt-assembler', 'step/domain/runtime', 'continuous/domain/evaluation/assignment-finalizer', 'kernel/artifact']) {
      expect(dependencyAllowed(file, imports(file, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
    }
    const assembler = path.join(practiceRoot, 'step/step-acoustic-attempt-assembler.ts');
    expect(imports(assembler).some(edge => edge.bindings.includes('SourcePublicationSequence')
      && edge.target === normalize(file))).toBe(true);
  });
  it('keeps MIDI evidence score-blind, including type-only imports', () => {
    const file = path.join(practiceRoot, 'continuous/input/midi-evidence.ts');
    for (const target of ['kernel/artifact', 'kernel/scope', 'kernel/tempo', 'continuous/domain/evaluation/assignment-finalizer',
      'continuous/domain/evaluation/assignment-types', 'continuous/domain/evaluation/finalization-policy']) {
      expect(dependencyAllowed(file, imports(file, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
    }
    for (const edge of imports(file)) expect(dependencyAllowed(file, edge), edge.specifier).toBe(true);
  });
  it('keeps research harnesses and CLI runners out of every production source import', () => {
    for (const [file, edges] of sourceGraph) {
      for (const edge of edges) {
        expect(/(?:tests\/research\/|scripts\/(?:practice-timing|benchmark-practice-timing|benchmark-practice-evaluation-scale|analyze-practice-midi-corpus))/.test(
          `${edge.specifier} ${edge.target ?? ''}`), `${file}: ${edge.specifier}`).toBe(false);
      }
    }
  });
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
      'finalization-policy.ts', 'assignment-finalizer.ts', 'assignment-projection.ts', 'evaluation-error.ts', 'immutable-value.ts', 'resource-policy.ts']);
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

  it('separates intent, readiness, workspace infrastructure and per-session production paths', () => {
    for (const [file, edges] of graph) {
      const owner = relative(file);
      if (owner.startsWith('step/') || owner.startsWith('continuous/')) for (const edge of edges) {
        expect(edge.bindings.some(name => ['getPracticeAcousticModelAccess', 'createAcousticModelWorker', 'createVerifiedModelAssetLoader'].includes(name)), owner + ' -> ' + edge.specifier).toBe(false);
      }
      if (owner.startsWith('configuration/') && owner !== 'configuration/preference-storage.ts') {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isIdentifier(node)) expect(['window', 'navigator', 'MediaStream', 'AudioContext', 'Worker', 'localStorage', 'fetch'].includes(node.text), owner).toBe(false);
          ts.forEachChild(node, visit);
        }; visit(source);
      }
      if (owner.startsWith('environment/')) for (const edge of edges) {
        expect(edge.target && ['kernel/artifact.ts', 'kernel/scope.ts', 'kernel/tempo.ts'].includes(relative(edge.target)), owner).toBe(false);
      }
    }
    for (const source of ['configuration/preferences.ts', 'readiness/requirements.ts', 'environment/practice-environment.ts']) {
      for (const target of ['step/domain/runtime', 'continuous/domain/practice-session', 'result/continuous-performance-result', 'review/review-view-model']) {
        const file = path.join(practiceRoot, source);
        expect(dependencyAllowed(file, imports(file, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
      }
    }
    const profile = readFileSync(path.join(practiceRoot, 'configuration/preference-storage.ts'), 'utf8');
    expect(profile).not.toMatch(/sessionStorage|indexedDB/);
    for (const file of files.filter(file => relative(file).startsWith('readiness/'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it('per-session runtime imports cannot reach cold model preparation transitively', () => {
    const coldOwners = ['lib/api/practice-acoustic-model-asset.ts',
      'lib/practice/acoustic/model/worker-client.ts', 'lib/model-assets/verified-model-asset-loader.ts'];
    for (const start of files.filter(file => /^(step|continuous)\//.test(relative(file)))) {
      const visited = new Set<string>();
      const visit = (file: string) => {
        if (visited.has(file)) return;
        visited.add(file);
        for (const edge of sourceGraph.get(file) ?? []) {
          if (!edge.target || edge.typeOnly) continue;
          const target = normalize(path.relative(sourceRoot, edge.target));
          expect(coldOwners.includes(target), relative(start) + ' -> ' + target).toBe(false);
          visit(edge.target);
        }
      };
      visit(normalize(start));
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

it('timing calibration cannot enter transport, interpretation, metrics or presentation', () => {
  const forbidden = [...files.filter(file => ['continuous/domain/performance-clock.ts', 'result/continuous-performance-metrics.ts',
    'continuous/domain/evaluation/interpretation.ts'].includes(relative(file))
    || /^(score-view|review|sharing)\//.test(relative(file))),
    ...productionFiles(path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/review'))];
  for (const start of forbidden) {
    // Type-only artifact contracts are allowed; executable timing policy does not belong in these owners.
    for (const edge of graph.get(normalize(start)) ?? []) {
      expect(edge.target && relative(edge.target).startsWith('continuous/timing/'), relative(start)).toBeFalsy();
    }
    const ast = ts.createSourceFile(start, readFileSync(start, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) expect(['calibrationApplied', 'calibrationPolicyId', 'offsetMs'].includes(node.name.text), relative(start)).toBe(false);
      ts.forEachChild(node, visit);
    }; visit(ast);
  }
  for (const [file, edges] of sourceGraph) for (const edge of edges) {
    if (!edge.target || !relative(edge.target).startsWith('continuous/timing/')) continue;
    expect(relative(file).startsWith('continuous/timing/') || relative(file) === 'result/continuous-result-provenance.ts', relative(file)).toBe(true);
  }
});

it('Practice owns only presentation preference writes; Setup owns mode, input and recording editors', () => {
  const page = path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx');
  const source = ts.createSourceFile(page, readFileSync(page, 'utf8'), ts.ScriptTarget.Latest, true);
  const writes: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'updateProfile') {
      const argument = node.arguments[0];
      expect(ts.isObjectLiteralExpression(argument)).toBe(true);
      if (ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (ts.isSpreadAssignment(property)) continue;
          expect(ts.isPropertyAssignment(property) && property.name.getText(source)).toBe('continuous');
          if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
            for (const field of property.initializer.properties) if (ts.isPropertyAssignment(field)) writes.push(field.name.getText(source));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source); expect(writes).toEqual(['liveFeedbackEnabled']);
  const edges = imports(page);
  expect(edges.some(edge => edge.bindings.includes('PracticeFeedbackSettings'))).toBe(true);
  const setup = path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/setup/page.tsx');
  expect(imports(setup).some(edge => edge.target?.endsWith('/ui/switch.tsx'))).toBe(false);
});

it('fresh attempt binding cannot reach cold Setup qualification', () => {
  const roots = ['step/step-practice-controller.ts', 'continuous/continuous-practice-controller.ts',
    '../../hooks/practice/use-local-practice.ts'];
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return; visited.add(file);
    for (const edge of sourceGraph.get(file) ?? []) {
      if (!edge.target) continue;
      const owner = relative(edge.target);
      expect(owner.startsWith('environment/'), `${relative(file)} -> ${owner}`).toBe(false);
      expect(owner.includes('practice-acoustic-model-asset'), owner).toBe(false);
      expect(edge.bindings.some(name => ['PracticeEnvironment', 'probePracticeRequirements', 'getPracticeAcousticModelAccess', 'AcousticEngine'].includes(name)), owner).toBe(false);
      if (sourceGraph.has(edge.target)) visit(edge.target);
    }
  };
  for (const root of roots) visit(normalize(path.resolve(practiceRoot, root)));
});

it('device acquisition belongs only to Device Lease or explicit Setup qualification, never attempts or recorder', () => {
  const executionFiles = [...files, ...productionFiles(path.join(sourceRoot, 'hooks/practice')),
    ...productionFiles(path.join(sourceRoot, 'components/practice')),
    path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx')];
  for (const file of executionFiles) {
    const owner = relative(file);
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ['getUserMedia', 'requestMIDIAccess'].includes(node.expression.name.text)) {
        expect(owner.startsWith('environment/') || owner === 'device/browser-device-platform.ts', owner).toBe(true);
      }
      ts.forEachChild(node, visit);
    }; visit(ast);
  }
  for (const start of files.filter(file => /^(step|continuous|recording)\//.test(relative(file)))) {
    const visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return; visited.add(file);
      for (const edge of sourceGraph.get(file) ?? []) {
        if (!edge.target || edge.typeOnly) continue;
        expect(relative(edge.target), `${relative(start)} runtime acquisition`).not.toBe('device/browser-device-platform.ts');
        visit(edge.target);
      }
    }; visit(normalize(start));
  }
  expect(existsSync(path.join(sourceRoot, 'hooks/practice/use-practice-video-preview.ts'))).toBe(false);
});

it('STEP learning is subscription-driven without an elapsed timer or animation sampling loop', () => {
  const hook = path.join(sourceRoot, 'hooks/practice/use-step-local-practice.ts');
  const ast = ts.createSourceFile(hook, readFileSync(hook, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) expect(['requestAnimationFrame', 'setInterval'].includes(node.expression.text)).toBe(false);
    ts.forEachChild(node, visit);
  }; visit(ast);
});

it('execution page never propagates arbitrary device or attempt errors into Environment invalidation', () => {
  const page = path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx');
  const ast = ts.createSourceFile(page, readFileSync(page, 'utf8'), ts.ScriptTarget.Latest, true);
  const invalidations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'invalidate') {
      expect(node.arguments).toHaveLength(1);
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      if (ts.isStringLiteral(node.arguments[0])) invalidations.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); expect(invalidations).toEqual(['USER_REQUESTED_REQUALIFICATION']);
  for (const file of files.filter(file => /^(device|step|continuous|recording)\//.test(relative(file)))) {
    expect(imports(file).some(edge => edge.target && relative(edge.target).startsWith('environment/')), relative(file)).toBe(false);
  }
});
