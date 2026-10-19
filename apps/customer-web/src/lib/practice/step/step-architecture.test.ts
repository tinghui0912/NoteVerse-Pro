import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { MAX_ACTIVE_STEP_ATTEMPTS, MAX_STEP_HISTORY_RECORDS } from '../local-core/step-attempt';
const src = path.resolve(__dirname, '../../..');
const practice = path.join(src, 'lib/practice');
const productionFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
  ? e.name === '__fixtures__' ? [] : productionFiles(path.join(dir,e.name))
  : /\.(ts|tsx|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [path.join(dir,e.name)] : []);
const files = productionFiles(practice);
function read(p: string) { return readFileSync(p,'utf8'); }
function imports(file: string): string[] {
  const ast = ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
  return ast.statements.flatMap(node => {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return [];
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return [];
    if (ts.isExportDeclaration(node) && node.isTypeOnly) return [];
    const p = node.moduleSpecifier.text;
    const base = p.startsWith('@/') ? path.join(src,p.slice(2)) : p.startsWith('.') ? path.resolve(path.dirname(file),p) : null;
    return base ? [base+'.ts',base+'.tsx',path.join(base,'index.ts')].filter(existsSync) : [];
  });
}
function reach(file: string) {
  const seen = new Set<string>(), queue = [file];
  while (queue.length) { const p = queue.pop()!; if (seen.has(p)) continue; seen.add(p); queue.push(...imports(p)); }
  return [...seen];
}
it('React STEP constructs only its application owner; no lifecycle or gesture timers', () => {
  const hook = path.join(src,'hooks/practice/use-step-local-practice.ts'), ast = ts.createSourceFile(hook,read(hook),ts.ScriptTarget.Latest,true), names: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isNewExpression(node)) names.push(node.expression.getText(ast)); ts.forEachChild(node,visit); };
  visit(ast); expect(names).toEqual(['StepPracticeController']);
  expect(read(hook)).not.toMatch(/StepPracticeRuntime|BrowserMidiController|MetronomeController|setTimeout|setInterval|\.rearm\(/);
});
it('generic MIDI has neither target knowledge nor acoustic dependencies', () => {
  const midi = path.join(practice,'midi/browser-midi-controller.ts');
  for (const token of ['StepTarget','StepPracticeRuntime','targetGeneration','expected','getCurrentStepTarget','onStepObservation','setTargetGetter']) expect(read(midi)).not.toContain(token);
  expect(reach(midi).filter(p => /[\\/]acoustic[\\/]|step-runtime/.test(p))).toEqual([]);
});
it('STEP MIDI reachability is entirely independent of acoustic/Continuous execution', () => {
  const reached = reach(path.join(__dirname,'step-practice-controller.ts'));
  expect(reached.filter(p => /[\\/]acoustic[\\/]|model-assets|continuous-practice-controller|continuous-finalizer|continuous-capture|onnx/i.test(p))).toEqual([]);
  expect(read(path.join(__dirname,'step-midi-attempt-input.ts'))).not.toMatch(/attackPitches|expected|currentTarget|StepTarget|advance/);
});
it('pure domain cannot reach browser infrastructure, React, MIDI or assets', () => {
  for (const file of productionFiles(path.join(practice,'local-core'))) {
    expect(reach(file).filter(p => !p.startsWith(path.join(practice,'local-core') + path.sep))).toEqual([]);
    expect(read(file)).not.toMatch(/\bnew (AudioContext|AudioWorklet|Worker)|from ['"]react|navigator\.|requestMIDIAccess/);
  }
});
it('rolling STEP evidence, compatibility APIs and historical acoustic tree are absent', () => {
  expect(existsSync(path.join(practice,'local-core/step-evidence-session.ts'))).toBe(false);
  expect(existsSync(path.join(practice,'acoustic-inference'))).toBe(false);
  for (const file of files) expect(read(file)).not.toMatch(/StepEvidenceSession|StepVerifierObservation|StepVerifierTarget|observationForCurrentTarget|pendingAttackTarget|bytedance-contract|bytedance-decoder/);
  expect(MAX_ACTIVE_STEP_ATTEMPTS).toBe(1); expect(MAX_STEP_HISTORY_RECORDS).toBe(100000);
});
it('one executable model, worker and PCM worklet; one StepPracticeRuntime', () => {
  expect(files.filter(p => /ort\.InferenceSession\.create\(/.test(read(p)))).toHaveLength(1);
  expect(files.filter(p => /worker\.entry\.ts$/.test(p))).toHaveLength(1);
  expect(files.filter(p => /registerProcessor\(/.test(read(p)))).toHaveLength(1);
  expect(files.filter(p => /export class StepPracticeRuntime\b/.test(read(p)))).toHaveLength(1);
});
it('only the domain owns the exclusive activation predicate; MIDI gesture remains half-open', () => {
  const file=path.join(practice,'local-core/step-runtime.ts'),ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
  const runtime=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StepPracticeRuntime') as ts.ClassDeclaration;
  const open=runtime.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='openAttempt')!;
  const comparisons: string[]=[];
  const visit=(node: ts.Node)=>{
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='start.ms'&&node.right.getText(ast)==='this.boundary.ms') comparisons.push(node.operatorToken.getText(ast));
    ts.forEachChild(node,visit);
  };
  visit(open); expect(comparisons).toEqual(['<=']);
  expect(read(path.join(__dirname,'step-midi-attempt-input.ts'))).toContain('note.sessionTime.ms >= this.active.end.ms');
  for(const p of ['step-midi-attempt-input.ts','step-practice-controller.ts']) expect(read(path.join(__dirname,p))).not.toContain('inputEligibleAfter');
});
it('Robust decoder has no historical defaults, padding, or Original model contract', () => {
  for (const p of ['raw-output-contract.ts','robust-piano-decoder.ts','model-inference.ts']) {
    const source = read(path.join(practice,'acoustic/model',p));
    expect(source).not.toMatch(/acoustic-inference|0\.2\b|1600\b|220\b|fixed.anchor|Original|StepTarget/);
  }
  expect(read(path.join(practice,'acoustic/continuous/publication.ts'))).not.toMatch(/\*\s*600|\+\s*600/);
});
it('STEP has one waiting lifecycle, no transport commands or obsolete activation API', () => {
  for (const p of [path.join(practice,'local-core/step-runtime.ts'),path.join(__dirname,'step-practice-controller.ts')]) {
    const ast=ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true);
    for(const node of ast.statements) if(ts.isClassDeclaration(node)) {
      const methods=node.members.filter(ts.isMethodDeclaration).map(n=>n.name.getText(ast));
      expect(methods).not.toContain('pause'); expect(methods).not.toContain('resume');
    }
    expect(read(p)).not.toMatch(/PAUSED|activationGeneration|activationBoundary/);
  }
  const hook=read(path.join(src,'hooks/practice/use-step-local-practice.ts'));
  expect(hook).not.toMatch(/\bpause\b|\bresume\b|PAUSED/);
  expect(read(path.join(__dirname,'step-platform.ts'))).not.toMatch(/'pause'|'resume'/);
  expect(read(path.join(practice,'continuous/continuous-practice-controller.ts'))).toMatch(/\bpause\(/);
  const controls=read(path.join(src,'components/practice/practice-controls.tsx'));
  expect(controls).toContain('export function StepPracticeControls');
  expect(controls).toContain('export function ContinuousPracticeControls');
  for (const file of productionFiles(path.join(practice,'acoustic'))) {
    expect(read(file)).not.toContain('STEP_MIDI_CHORD_COHERENCE_MS');
  }
});
it('paced progression has one commit owner, no modality runtimes or RESET compatibility alias', () => {
  const file = path.join(practice, 'local-core/step-runtime.ts');
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const runtime = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'StepPracticeRuntime') as ts.ClassDeclaration;
  const method = (name: string) => runtime.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === name)!.getText(ast);
  expect(method('completeAttempt')).not.toMatch(/this\.advance\(|this\.end\(/);
  expect(method('completeAttempt')).toContain("this.attemptState = 'POST_VERDICT'");
  expect(method('rearm')).toContain("if (verdict === 'MATCH') this.advance()");
  expect(method('skip')).toContain('!this.canAcceptAttempt');
  for (const p of [file, path.join(practice, 'local-core/step-attempt.ts'), path.join(__dirname, 'step-practice-controller.ts')]) {
    expect(read(p)).not.toMatch(/['"]RESET['"]|MidiStepRuntime|MicrophoneStepRuntime|pendingAttempts|attemptQueue/);
  }
  expect(read(file)).not.toMatch(/inputSource\s*[!=]==?\s*['"](?:MIDI|MICROPHONE)['"]/);
  expect(read(path.join(__dirname, 'step-practice-controller.ts'))).not.toMatch(/\.advance\(/);
  const policy = read(path.join(__dirname, 'step-retirement-policy.ts'));
  expect(policy).toContain('runtimeToSessionTime(this.clock.nowMs())');
  expect(policy).not.toMatch(/setTimeout|setInterval|new Worker|AudioContext|numThreads/);
  for (const file of files) expect(read(file)).not.toMatch(/class (Midi|Microphone)StepRuntime/);
});
