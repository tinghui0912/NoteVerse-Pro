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
  if (source.startsWith('application/')) return Boolean(target && ['application/', 'planning/', 'kernel/', 'device/', 'step/', 'continuous/', 'recording/', 'diagnostics/', 'score-view/', 'acoustic/runtime/'].some(owner => target.startsWith(owner)) || target === 'input-state.ts');
  if (source.startsWith('planning/')) return Boolean(target && (target.startsWith('planning/')
    || target.startsWith('kernel/') || edge.typeOnly && target === 'recording/recording-mode.ts'));
  if (target === 'acoustic/continuous/capture-bridge.ts') return ['continuous/continuous-microphone-input.ts', 'continuous/continuous-input.ts'].includes(source);
  if (source.startsWith('acoustic/runtime/')) return Boolean(target && ['acoustic/runtime/', 'acoustic/model/', 'acoustic/source/'].some(owner => target.startsWith(owner)));
  if (source === 'continuous/input/midi-evidence.ts') return target === 'continuous/input/midi-evidence-identity.ts'
    || edge.typeOnly && ['continuous/domain/clock-evidence-port.ts', 'continuous/domain/evaluation/evidence-types.ts', 'kernel/piano-key.ts'].includes(target ?? '');
  if (source.startsWith('device/')) return Boolean(target && (target.startsWith('device/') || edge.typeOnly && target === 'planning/resource-plan.ts' || target === 'kernel/session.ts'
    || target === 'recording/recording-mode.ts' || target === 'diagnostics/startup-timings.ts'));
  if (source.startsWith('continuous/timing/')) return Boolean(target && (target.startsWith('continuous/timing/') || target.startsWith('kernel/')));
  if (source.startsWith('configuration/')) return Boolean(target && (target.startsWith('configuration/')
    || target.startsWith('kernel/') || target === 'recording/recording-mode.ts'));
  if (source.startsWith('readiness/')) return Boolean(target && (target.startsWith('readiness/') || edge.typeOnly && target === 'planning/resource-plan.ts'));
  if (source.startsWith('environment/')) return Boolean(target && (target.startsWith('environment/') || target.startsWith('acoustic/')
    || target.startsWith('readiness/') || target === 'planning/resource-plan.ts' || ['recording/recorder-capability.ts', 'recording/recording-mode.ts'].includes(target)
    || edge.target === normalize(path.join(sourceRoot, 'lib/api/practice-acoustic-model-asset.ts'))));
  if (['kernel/', 'step/', 'continuous/', 'acoustic/', 'result/', 'recording/'].some(owner => source.startsWith(owner))
    && target && presentationOwners.some(owner => target.startsWith(owner))) return false;
  if (source.startsWith('score-view/')) {
    if (target?.startsWith('score-view/') || target?.startsWith('kernel/')) return true;
    if (source === 'score-view/verovio-adapter.ts' && edge.target === normalize(path.join(sourceRoot, 'lib/score/verovio/index.ts'))) return true;
    return source === 'score-view/evaluation-annotations.ts' && edge.typeOnly
      && target === 'continuous/domain/evaluation/target-feedback.ts' && edge.bindings.length > 0
      && edge.bindings.every(name => name === 'ContinuousTargetFeedback');
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
      'continuous/domain/evaluation/assignment-types', 'continuous/domain/evaluation/finalization-policy', 'continuous/domain/evaluation/resource-policy']) {
      expect(dependencyAllowed(file, imports(file, `import type { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
      expect(dependencyAllowed(file, imports(file, `import { Contract } from '@/lib/practice/${target}';`)[0])).toBe(false);
    }
    for (const edge of imports(file)) expect(dependencyAllowed(file, edge), edge.specifier).toBe(true);
  });
  it('keeps research harnesses and CLI runners out of every production source import', () => {
    const toolingRoots = ['tests', 'scripts'].map(owner => normalize(path.resolve(owner)) + '/');
    const forbidden = (edge: Edge) => toolingRoots.some(root => edge.target?.startsWith(root));
    for (const [file, edges] of sourceGraph) for (const edge of edges) expect(forbidden(edge), `${file}: ${edge.specifier}`).toBe(false);
    const consumer = path.join(practiceRoot, 'continuous/domain/evaluation/session.ts');
    for (const owner of ['policy-benchmark', 'corpus-analysis', 'research-report', 'command']) {
      const specifier = `@/../tests/research/practice-timing/${owner}`;
      for (const statement of [`import { Tool } from '${specifier}';`, `export { Tool } from '${specifier}';`, `const candidate = import('${specifier}');`]) {
        const edges = imports(consumer, statement);
        expect(edges).toHaveLength(1); expect(forbidden(edges[0]), statement).toBe(true);
      }
    }
  });


  it('keeps kernel and mode domains pure and independent', () => {
    for (const file of files) {
      const owner = domain(relative(file));
      if (!owner && !relative(file).startsWith('result/') && !relative(file).startsWith('planning/')) continue;
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

  it('owns execution scope/tempo resolution in the pure planning boundary', () => {
    const planner = imports(path.join(practiceRoot, 'planning/session-plan.ts'));
    expect(planner.some(edge => edge.bindings.includes('resolvePracticeScope') && edge.target?.endsWith('/kernel/scope.ts'))).toBe(true);
    expect(planner.some(edge => edge.bindings.includes('resolvePracticeTempoPlan') && edge.target?.endsWith('/kernel/tempo.ts'))).toBe(true);
    const execution = ['step/domain/runtime.ts', 'step/step-practice-controller.ts',
      'continuous/domain/practice-session.ts', 'continuous/domain/performance-clock.ts',
      'continuous/domain/evaluation/session.ts', 'continuous/continuous-practice-controller.ts',
      'result/continuous-performance-result.ts'];
    for (const owner of execution) {
      for (const edge of imports(path.join(practiceRoot, owner))) {
        if (edge.target?.endsWith('/kernel/scope.ts')) expect(edge.typeOnly, owner).toBe(true);
        if (edge.target?.endsWith('/kernel/tempo.ts')) {
          expect(edge.bindings.every(binding => binding !== 'resolvePracticeTempoPlan'), owner).toBe(true);
        }
      }
    }
  });

  it('projects resource planning into readiness, live roots and controller bindings', () => {
    const resourcePath = path.join(practiceRoot, 'planning/resource-plan.ts');
    expect(imports(resourcePath).every(edge => edge.typeOnly && edge.target === normalize(path.join(practiceRoot, 'planning/execution-intent.ts')))).toBe(true);
    for (const owner of ['readiness/readiness-state.ts', 'device/practice-device-lease.ts']) {
      const edges = imports(path.join(practiceRoot, owner));
      expect(edges.some(edge => edge.target?.endsWith('/planning/resource-plan.ts') && edge.typeOnly)).toBe(true);
      expect(edges.every(edge => !edge.target?.includes('/configuration/'))).toBe(true);
    }
    const environmentImports = imports(path.join(practiceRoot, 'environment/practice-environment.ts'));
    const qualification = environmentImports.find(edge => edge.target?.endsWith('/planning/resource-plan.ts'));
    expect(qualification?.bindings).toEqual(['qualificationFingerprint', 'PracticeQualificationRequirement']);
    const workspace = readFileSync(path.join(sourceRoot, 'contexts/practice-workspace-context.tsx'), 'utf8');
    expect(workspace).toContain('environment.requalify(resourcePlan.qualification)');
    expect(workspace).toContain('environment.matches(resourcePlan.qualification)');
    const lease = readFileSync(path.join(practiceRoot, 'device/practice-device-lease.ts'), 'utf8');
    expect(lease).toContain('this.required = resources.liveRoots');
    const controller = readFileSync(path.join(practiceRoot, 'continuous/continuous-practice-controller.ts'), 'utf8');
    expect(controller).toContain('this.options.devices[recording.audioRoot]');
    expect(controller).toContain('this.options.devices[recording.videoRoot]');
    expect(controller).toContain('this.options.devices[resources.analysis.sourceRoot]');
    expect(controller).toContain('this.options.devices[resources.input.root]');
  });

  it('projects device physical facts through a read-only health port into independent pipelines', () => {
    const events = (owner: string) => {
      const file = path.join(practiceRoot, owner), source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const found: { target: string; event: string }[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addEventListener') {
          found.push({ target: node.expression.expression.getText(source), event: node.arguments[0].getText(source) });
        }
        ts.forEachChild(node, visit);
      }; visit(source); return found;
    };
    for (const owner of ['step/step-practice-controller.ts', 'continuous/continuous-practice-controller.ts']) {
      const text = readFileSync(path.join(practiceRoot, owner), 'utf8');
      expect(text).toContain('rootHealth: PracticeRootHealthPort'); expect(text).toContain('this.options.rootHealth.subscribe');
      expect(text).toContain('this.rootHealthChanged(this.options.rootHealth.snapshot())');
      expect(events(owner)).toEqual([]);
    }
    expect(events('midi/browser-midi-controller.ts')).toEqual([{ target: 'input', event: "'midimessage'" }]);
    expect(events('continuous/microphone-resource-health.ts')).toEqual([{ target: 'context', event: "'statechange'" }]);
    const pipeline = readFileSync(path.join(practiceRoot, 'continuous/microphone-resource-health.ts'), 'utf8');
    expect(pipeline).toContain('observeSourceHealth(health: PracticeDeviceHealth)');
    const recorder = readFileSync(path.join(practiceRoot, 'recording/performance-recorder.ts'), 'utf8');
    expect(recorder).toContain('observeSourceHealth(sources: Readonly<');
    expect(recorder).toContain('this.ownedStream.getTracks()');
    expect(events('recording/performance-recorder.ts').every(event => event.target === 'track')).toBe(true);
    const device = readFileSync(path.join(practiceRoot, 'device/practice-device-lease.ts'), 'utf8');
    expect(device).toContain('readonly rootHealth: PracticeRootHealthPort');
    expect(device).toContain('listener(this.rootHealth.snapshot())');
    expect(events('device/practice-device-lease.ts')).toContainEqual({ target: 'access', event: "'statechange'" });
  });

  it('composes exactly one explicit execution owner behind the page bridge and consumes admitted score values', () => {
    const ownerPath = path.join(practiceRoot, 'application/practice-execution-owner.ts');
    const bridge = path.join(sourceRoot, 'hooks/practice/use-practice-execution.ts');
    const page = path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx');
    expect(imports(page).filter(edge => edge.target?.includes('/hooks/practice/') && edge.bindings.includes('usePracticeExecution'))).toHaveLength(1);
    expect(imports(bridge).filter(edge => !edge.typeOnly && edge.target?.startsWith(normalize(practiceRoot)))).toMatchObject([
      { target: normalize(ownerPath), bindings: ['PracticeExecutionOwner', 'PracticeExecutionPorts'] },
    ]);
    const constructions = new Map<string, Set<string>>();
    for (const file of productionFiles(sourceRoot)) {
      const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['StepPracticeController', 'ContinuousPracticeController'].includes(node.expression.text)) {
          const names = constructions.get(normalize(file)) ?? new Set<string>(); names.add(node.expression.text); constructions.set(normalize(file), names);
        } ts.forEachChild(node, visit);
      }; visit(ast);
    }
    expect([...constructions.keys()]).toEqual([normalize(ownerPath)]);
    expect([...constructions.get(normalize(ownerPath))!].sort()).toEqual(['ContinuousPracticeController', 'StepPracticeController']);
    for (const owner of ['planning/session-plan.ts', 'kernel/scope.ts', 'step/domain/runtime.ts', 'continuous/domain/performance-clock.ts',
      'continuous/domain/evaluation/expected-strikes.ts', 'score-view/cursor-scope.ts']) {
      const artifact = imports(path.join(practiceRoot, owner)).find(edge => edge.target?.endsWith('/kernel/artifact.ts'));
      expect(artifact?.bindings.every(name => ['PracticeScoreArtifact', 'roundBeat', 'notesForIds', 'attackNoteIds'].includes(name))).toBe(true);
    }
    const source = imports(path.join(sourceRoot, 'hooks/practice/use-practice-revision-source.ts'));
    expect(source.find(edge => edge.target?.endsWith('/kernel/artifact.ts'))?.bindings).toEqual(['parsePracticeScoreArtifact', 'PracticeScoreContractError']);
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

  it('separates raw assignment mechanics from target feedback and presentation', () => {
    const rawModules = new Set(['assignment-types.ts', 'evidence-types.ts', 'same-key-matching.ts', 'observation-store.ts',
      'finalization-policy.ts', 'assignment-finalizer.ts', 'assignment-projection.ts', 'evaluation-error.ts', 'immutable-value.ts']);
    const evaluationRoot = 'continuous/domain/evaluation/';
    for (const file of files) {
      const name = relative(file);
      if (name.startsWith(evaluationRoot) && rawModules.has(path.basename(file))) {
        for (const edge of graph.get(normalize(file))!) {
          expect(edge.target && (relative(edge.target) === 'kernel/piano-key.ts' || relative(edge.target).startsWith(evaluationRoot) && rawModules.has(path.basename(edge.target))), name + ' -> ' + edge.specifier).toBe(true);
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
          ['evaluation-types.ts', 'target-feedback.ts'].includes(path.basename(edge.target)), file + ' -> ' + edge.specifier).toBe(true);
      }
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node)) expect(node.name.text, file).not.toBe('assignment');
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  });

  it('keeps result, recording and STEP ownership separate, including hooks and boundary probes', () => {
    for (const [owner, forbidden] of [
      ['result', ['recording/performance-recorder', 'step/domain/runtime']],
      ['recording', ['result/continuous-performance-result', 'continuous/domain/evaluation/target-feedback', 'step/domain/runtime']],
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

  it('keeps persisted evidence provenance separate from resource, transport, liveness and intervention implementations', () => {
    for (const file of files.filter(file => relative(file).startsWith('result/'))) {
      for (const edge of imports(file)) expect(dependencyAllowed(file, edge), relative(file) + ' -> ' + edge.specifier).toBe(true);
    }
    const file = path.join(practiceRoot, 'result/continuous-result-provenance.ts');
    for (const target of [
      'acoustic/runtime/resource-policy', 'acoustic/source/capture-transport-contract',
      'acoustic/source/capture.worklet.js', 'acoustic/continuous/capture', 'acoustic/continuous/capture-bridge',
      'acoustic/model/worker-client', 'acoustic/model/model-inference', 'acoustic/model/acoustic-worker.entry',
      'acoustic/model/acoustic-engine', 'acoustic/model/worker-liveness-policy',
      'continuous/continuous-microphone-input', 'continuous/continuous-practice-controller',
      'continuous/analysis-intervention', 'continuous/resource-intervention',
      'step/step-analysis-intervention', 'step/step-infrastructure-intervention',
    ]) for (const statement of [
      `import { Contract } from '@/lib/practice/${target}';`,
      `import type { Contract } from '@/lib/practice/${target}';`,
      `export * from '@/lib/practice/${target}';`,
      `const contract = import('@/lib/practice/${target}');`,
    ]) expect(dependencyAllowed(file, imports(file, statement)[0]), target).toBe(false);
    for (const target of ['acoustic/model/analysis-identity', 'acoustic/model/model-contract', 'continuous/timing/timing-provenance']) {
      expect(dependencyAllowed(file, imports(file, `import { Contract } from '@/lib/practice/${target}';`)[0]), target).toBe(true);
    }
  });

  it('exposes concrete result/recording owners with explicit entry points', () => {
    for (const file of ['result/continuous-performance-result.ts',
      'recording/recording-artifact.ts', 'recording/recording-timebase.ts', 'recording/performance-recorder.ts',
      'recording/performance-replay.ts', 'continuous/completion.ts', 'continuous/completion-store.ts']) {
      expect(existsSync(path.join(practiceRoot, file)), file).toBe(true);
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
      'finalize', 'setCompletion', 'onNaturalCompletion', 'finish']);
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
      expect(edge.bindings.some(name => ['ContinuousPracticeCompletion', 'ContinuousPerformanceResult', 'CompletedContinuousEvaluation'].includes(name))).toBe(false);
    }
  });

  it('keeps rendering, review and sharing under their concrete owners with presentation dependency direction', () => {
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
    for (const source of ['configuration/preferences.ts', 'planning/resource-plan.ts', 'readiness/readiness-state.ts', 'environment/practice-environment.ts']) {
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

it('timing calibration cannot enter transport, target feedback or presentation', () => {
  const forbidden = [...files.filter(file => ['continuous/domain/performance-clock.ts',
    'continuous/domain/evaluation/target-feedback.ts'].includes(relative(file))
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
    'application/practice-execution-owner.ts'];
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
});

it('STEP learning is subscription-driven without an elapsed timer or animation sampling loop', () => {
  const hook = path.join(sourceRoot, 'hooks/practice/use-practice-execution.ts');
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
  visit(ast); expect(invalidations).toEqual([]);
  for (const file of files.filter(file => /^(device|step|continuous|recording)\//.test(relative(file)))) {
    expect(imports(file).some(edge => edge.target && relative(edge.target).startsWith('environment/')), relative(file)).toBe(false);
  }
});

it('keeps live presentation on the narrow feedback contract, never the diagnostic assignment snapshot', () => {
  const consumers = [...sourceGraph.keys()].filter(file => file.includes('/components/practice/') || file.includes('/hooks/practice/')
    || file.includes('/app/[locale]/(workspace)/score/[id]/practice/') || relative(file) === 'continuous/continuous-practice-controller.ts'
    || relative(file) === 'score-view/evaluation-annotations.ts');
  for (const file of consumers) {
    for (const edge of sourceGraph.get(file)!) {
      expect(edge.bindings.some(name => ['ContinuousEvaluationSnapshot','ContinuousAssignmentSnapshot','ContinuousEvidenceStore','ContinuousAssignmentFinalizer'].includes(name)), file + ' -> ' + edge.specifier).toBe(false);
    }
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) expect(node.name.text, file).not.toBe('evaluationSnapshot');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const file of ['continuous/domain/evaluation/assignment-finalizer.ts','continuous/domain/evaluation/session.ts']) {
    const source = ts.createSourceFile(file, readFileSync(path.join(practiceRoot, file), 'utf8'), ts.ScriptTarget.Latest, true);
    let checked = 0;
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && ['publish','complete'].includes(node.name.getText(source))) {
        checked++;
        const inspect = (child: ts.Node) => {
          if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) expect(child.expression.name.text, file).not.toBe('snapshot');
          ts.forEachChild(child, inspect);
        };
        ts.forEachChild(node, inspect);
      }
      ts.forEachChild(node, visit);
    };
    visit(source); expect(checked).toBe(2);
  }
});





it('keeps score-view independent of assignment policy identities',()=>{
  for(const file of [...productionFiles(path.join(practiceRoot,'score-view')),path.join(sourceRoot,'components/practice/practice-score-viewer.tsx')]) {
    const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const inspect=(node:ts.Node)=>{
      if(ts.isIdentifier(node))expect(['assignmentPolicyId','CONTINUOUS_ASSIGNMENT_POLICY_ID'].includes(node.text),file).toBe(false);
      ts.forEachChild(node,inspect);
    };inspect(ast);
  }
});

it('keeps terminal Continuous analysis choice separate from resource faults, STEP and persisted truth', () => {
  const violations: string[] = [];
  const analysis = path.join(practiceRoot, 'continuous/analysis-intervention.ts');
  expect(imports(analysis)).toEqual([]);
  for (const [file, edges] of sourceGraph) {
    const rel = relative(file);
    if (rel.startsWith('step/') || rel.startsWith('result/') || rel === 'continuous/resource-intervention.ts') {
      if (edges.some(edge => edge.bindings.includes('ContinuousAnalysisIntervention'))) violations.push(file + ': intervention dependency');
    }
    if (file.includes('/components/practice/') || file.includes('/app/[locale]/(workspace)/score/[id]/practice/')) {
      if (edges.some(edge => /acoustic\/(runtime|model|continuous)|continuous-microphone-input|continuous-practice-controller/.test(edge.specifier))) violations.push(file + ': runtime presentation dependency');
    }
  }
  for (const file of files) {
    const rel = relative(file), source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && (node.text === 'PracticeInterventionStore' || rel.startsWith('result/') && ['analysisIntervention', 'infrastructureIntervention', 'StepInfrastructureIntervention'].includes(node.text))) violations.push(file + ': ' + node.text);
      if (rel === 'continuous/continuous-practice-controller.ts' && ts.isMethodDeclaration(node) && node.name.getText(source) === 'continueWithoutAnalysis') {
        const inspect = (child: ts.Node) => {
          if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)
            && ['acquire', 'connect', 'acquireInference', 'createAudioContext', 'createRecorder', 'start'].includes(child.expression.name.text)) violations.push('silent analysis restart: ' + child.expression.name.text);
          ts.forEachChild(child, inspect);
        }; ts.forEachChild(node, inspect);
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  expect(violations).toEqual([]);
  const resource = readFileSync(path.join(practiceRoot, 'continuous/resource-intervention.ts'), 'utf8');
  expect(resource).not.toContain('ANALYSIS_FAILED');
  const page = ts.createSourceFile('page.tsx', readFileSync(path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let resourceGuard = false, analysisShell = false;
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.getText(page).includes('<ResourceInterruptionDialog')) {
      resourceGuard ||= node.getText(page).includes('!analysisIntervention && intervention');
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === 'AnalysisInterruptionDialog') {
      analysisShell = true; expect(node.getText(page)).not.toContain('analysisError');
      expect(node.getText(page)).toContain('execution.continueWithoutAnalysis');
      expect(node.getText(page)).toContain('onEnd={handleEnd}');
    }
    ts.forEachChild(node, visit);
  };visit(page); expect(resourceGuard).toBe(true); expect(analysisShell).toBe(true);
});

it('keeps distinct STEP interventions application-owned and failure actions honest',()=>{
  const failures:string[]=[];
  for(const leaf of ['step-analysis-intervention.ts','step-infrastructure-intervention.ts']) expect(imports(path.join(practiceRoot,'step',leaf))).toEqual([]);
  for(const [file,edges] of sourceGraph){
    if(relative(file).startsWith('step/')&&edges.some(edge=>edge.bindings.includes('PracticeResourceIntervention')))failures.push(file+': Continuous resource intervention');
    const rel=relative(file);
    if(rel.startsWith('continuous/')&&edges.some(edge=>edge.bindings.some(name=>['StepAnalysisIntervention','StepInfrastructureIntervention'].includes(name))))failures.push(file+': STEP intervention');
    if(rel.startsWith('step/domain/')&&edges.some(edge=>edge.bindings.some(name=>['StepAnalysisIntervention','StepInfrastructureIntervention'].includes(name))))failures.push(file+': application into domain');
  }
  for(const rel of ['step/domain/session.ts','result/continuous-performance-result.ts']){
    const source=ts.createSourceFile(rel,readFileSync(path.join(practiceRoot,rel),'utf8'),ts.ScriptTarget.Latest,true);
    const visit=(node:ts.Node)=>{if(ts.isIdentifier(node)&&['analysisIntervention','StepAnalysisIntervention','infrastructureIntervention','StepInfrastructureIntervention'].includes(node.text))failures.push(rel+': persisted intervention');ts.forEachChild(node,visit);};visit(source);
  }
  for(const name of ['analysis-interruption-dialog.tsx','resource-interruption-dialog.tsx','step-analysis-interruption-dialog.tsx','step-infrastructure-interruption-dialog.tsx']){
    const file=path.join(sourceRoot,'components/practice',name);
    expect(readFileSync(file,'utf8')).toContain('onEnd');
  }
  const pagePath=path.join(sourceRoot,'app/[locale]/(workspace)/score/[id]/practice/page.tsx');
  const page=ts.createSourceFile(pagePath,readFileSync(pagePath,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let stepDialog=false,infrastructureDialog=false,end=false,completionRetry=false;
  const visit=(node:ts.Node)=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(page)==='handleEnd') {
      end=true; expect(node.getText(page)).toContain('await execution.end()');
    }
    if(ts.isJsxSelfClosingElement(node)) {
      const tag=node.tagName.getText(page),text=node.getText(page);
      if(tag==='StepInfrastructureInterruptionDialog'){infrastructureDialog=true;expect(text).toContain('onEnd={handleEnd}');}
      if(tag==='StepAnalysisInterruptionDialog'){stepDialog=true;expect(text).toContain('onEnd={handleEnd}');}
      if(tag==='PracticeCompletionDialog'){completionRetry=true;expect(text).toContain('onRetry={handleRetry}');}
    }ts.forEachChild(node,visit);
  };visit(page);expect(stepDialog&&infrastructureDialog&&end&&completionRetry).toBe(true);expect(failures).toEqual([]);
});


it('keeps execution device status informational and requalification exclusively behind Setup', () => {
  const components = path.join(sourceRoot, 'components/practice');
  const pagePath = path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx');
  const page = ts.createSourceFile(pagePath, readFileSync(pagePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let statusCount = 0, popoverCount = 0, navigation = false, topNavigation = false, settingsLink = false, requirements = false, end = false, stepControls = false, completionGuard = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) expect(['getUserMedia', 'requestMIDIAccess', 'browserDevicePlatform', 'PracticeDeviceLease']).not.toContain(node.text);
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'requiredDevices') {
      requirements = true; expect(node.initializer?.getText(page)).toBe('workspace.resourcePlan?.liveRoots ?? []');
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'goToPracticeSetup') {
      navigation = true;
      const text = node.getText(page);
      expect(text).toContain("router.push(practiceLocation(id, 'setup', selectedRevisionId))");
      expect(text).not.toMatch(/workspace\.|device\.|execution\./);
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'handleEnd') {
      end = true; expect(node.getText(page)).toContain('await execution.end()');
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'handleRetry') {
      completionGuard = true; const text = node.getText(page);
      expect(text).toContain('!canPreparePractice'); expect(text).toContain('goToPracticeSetup(); return;');
      expect(text).toContain('await execution.retry()'); expect(text).not.toContain('device.');
    }
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(page), text = node.getText(page);
      if (tag === 'PracticeStatus') { statusCount++; expect(ts.isConditionalExpression(node.parent)).toBe(false); expect(text).toContain('deviceControls='); }
      if (tag === 'PracticeDeviceStatusPopover') { popoverCount++; expect(text).not.toMatch(/onReconnect|canReconnect/); }
      if (tag === 'StepPracticeControls') { stepControls = true; expect(text).toContain('lifecycle={execution.lifecycle}'); }
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(page) === 'button') {
      const text = node.getText(page);
      if (text.includes("t('practiceSetup')")) { topNavigation = true; expect(text).toContain('onClick={goToPracticeSetup}'); }
      if (text.includes("t('setupChangeConfiguration')")) { settingsLink = true; expect(text).toContain('onClick={goToPracticeSetup}'); }
    }
    ts.forEachChild(node, visit);
  }; visit(page);
  expect({ statusCount, popoverCount, navigation, topNavigation, settingsLink, requirements, end, stepControls, completionGuard }).toEqual({ statusCount: 1, popoverCount: 1, navigation: true, topNavigation: true, settingsLink: true, requirements: true, end: true, stepControls: true, completionGuard: true });
  const popoverPath = path.join(components, 'practice-device-status-popover.tsx');
  expect(imports(popoverPath).every(edge => edge.typeOnly || !edge.specifier.includes('/lib/practice/'))).toBe(true);
  const popover = ts.createSourceFile(popoverPath, readFileSync(popoverPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inspect = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'PracticeDeviceStatusPopover') {
      const type = node.parameters[0].type;
      expect(type && ts.isTypeLiteralNode(type) ? type.members.map(member => member.name?.getText(popover)).sort() : []).toEqual(['health', 'issue', 'resource']);
    }
    if (ts.isIdentifier(node)) expect(['MediaStream', 'MIDIAccess', 'PracticeDeviceLease', 'getUserMedia', 'requestMIDIAccess', 'onReconnect', 'canReconnect', 'useState', 'useRef', 'environment', 'router']).not.toContain(node.text);
    ts.forEachChild(node, inspect);
  }; inspect(popover);
  for (const locale of ['en', 'zh']) {
    const messages = JSON.parse(readFileSync(path.resolve('messages', locale, 'practice.json'), 'utf8'));
    expect(messages).not.toHaveProperty('deviceRetry'); expect(messages).not.toHaveProperty('deviceReconnect'); expect(messages).not.toHaveProperty('setupContinue');
  }
});

it('Setup always invokes explicit fresh qualification, while ready remains admission evidence', () => {
  const file = path.join(sourceRoot, 'app/[locale]/(workspace)/score/[id]/practice/setup/page.tsx');
  const source = ts.createSourceFile(file, readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls: string[]=[];
  const inspect = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) expect(node.getText(source)).not.toBe('workspace.ready');
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(source));
    ts.forEachChild(node, inspect);
  }; inspect(source);
  expect(calls.filter(call=>call==='workspace.requalify')).toHaveLength(1);
  expect(calls).not.toContain('workspace.prepare');
  const environmentFile=path.join(practiceRoot,'environment/practice-environment.ts');
  const environment=ts.createSourceFile(environmentFile,readFileSync(environmentFile,'utf8'),ts.ScriptTarget.Latest,true);
  let fresh=false;
  const visit=(node:ts.Node)=>{
    if(ts.isMethodDeclaration(node)) {
      expect(node.name.getText(environment)).not.toBe('prepare');
      if(node.name.getText(environment)==='requalify') {fresh=true;expect(node.getText(environment)).not.toContain('this.matches(');expect(node.getText(environment)).toContain('this.platform.probe(');}
    }
    ts.forEachChild(node,visit);
  };visit(environment);expect(fresh).toBe(true);
});


it('Environment observes acoustic retirement without taking the attempt lease or polling', () => {
  const file = path.join(practiceRoot, 'environment/practice-environment.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  let waitFound = false, failureGuardFound = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && ['PracticeReleaseManager', 'GlobalResourceCoordinator', 'SetupRecoveryCoordinator'].includes(node.text)) violations.push(node.text);
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'awaitEngineRetirement') {
      waitFound = true;
      expect(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword)).toBe(true);
      const calls: string[] = [];
      const inspect = (child: ts.Node) => {
        if (ts.isIdentifier(child) && ['setTimeout', 'setInterval', 'requestAnimationFrame', 'sleep'].includes(child.text)) violations.push(child.text);
        if (ts.isWhileStatement(child) || ts.isDoStatement(child) || ts.isForStatement(child)) violations.push('polling loop');
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) calls.push(child.expression.getText(source));
        ts.forEachChild(child, inspect);
      }; inspect(node);
      expect(calls.filter(call => call.startsWith('engine.')).sort()).toEqual(['engine.snapshot', 'engine.subscribe']);
      expect(calls).toContain('signal.addEventListener'); expect(calls).toContain('signal.removeEventListener');
      expect(calls.some(call => /dispose|retire|terminate|acquire|endSession/.test(call))).toBe(false);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'onFailure') {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)) {
        const guard = callback.body.statements[0];
        if (guard && ts.isIfStatement(guard)) {
          failureGuardFound = true;
          expect(guard.expression.getText(source)).toBe("this.readiness.status === 'READY' && this.readiness.components.acousticEngine === 'READY'");
          expect(guard.thenStatement.getText(source)).toContain('this.invalidate(error.message)');
          expect(guard.elseStatement).toBeUndefined();
        }
      }
    }
    ts.forEachChild(node, visit);
  }; visit(source);
  expect({ waitFound, failureGuardFound, violations }).toEqual({ waitFound: true, failureGuardFound: true, violations: [] });
});

it('keeps Continuous readiness observation local to the attempt input and outside source, STEP and Result', () => {
  const consumers: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'subscribeReadiness') consumers.push(relative(file));
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  expect(consumers).toEqual(['continuous/continuous-microphone-input.ts']);
  for (const owner of ['acoustic/runtime', 'step', 'result', 'kernel']) {
    const file = path.join(practiceRoot, owner, 'boundary-probe.ts');
    expect(dependencyAllowed(file, imports(file, "import { ContinuousCaptureBridge } from '@/lib/practice/acoustic/continuous/capture-bridge';")[0])).toBe(false);
  }
});

it('R03 boundary admission is read only by capture/control ownership, never source, STEP or Result', () => {
  const owners = new Set<string>(), readers = new Set<string>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === 'maxScheduledBoundaries') {
        owners.add(relative(file));
        if (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) readers.add(relative(file));
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  expect([...owners].sort()).toEqual(['acoustic/continuous/capture-bridge.ts', 'acoustic/runtime/resource-policy.ts']);
  expect([...readers]).toEqual(['acoustic/continuous/capture-bridge.ts']);
});
