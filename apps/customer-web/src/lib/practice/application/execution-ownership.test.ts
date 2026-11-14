import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = path.resolve('src');
const base = 'lib/practice/';
const source = (file: string) => ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(file: ts.SourceFile) {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { result.push(node); ts.forEachChild(node, visit); };
  visit(file); return result;
}
const modeMethods = ['skip','pause','resume','continueWithoutAnalysis','continueWithoutRecording','continueAfterRecovery','setMetronomeEnabled'];

it('root effect hosting consumes neutral sessions while the machine owns execution state', () => {
  const actor = source(`${base}application/practice-execution-actor.ts`);
  const imports = nodes(actor).filter(ts.isImportDeclaration).map(n => n.getText(actor));
  expect(imports.some(n => /StepPracticeController|ContinuousPracticeController|browserStepPlatform|browserContinuousPlatform|projectStepFailure|projectContinuousFailure/.test(n))).toBe(false);
  const methods = nodes(actor).filter(ts.isMethodDeclaration).map(n => n.name.getText(actor));
  expect(methods.filter(n => modeMethods.includes(n))).toEqual([]);
  for (const method of ['start','end','retry','releaseForTeardown','dispose','modeCommands']) expect(methods).toContain(method);
  expect(actor.text).toContain('transitionExecution(this.state, queued.event)');
  expect(actor.text).toContain('session.observe()');
  expect(actor.text).toContain('this.state.tag === \'RUNNING\'');
  expect(actor.text).toContain('this.state.execution.executionId === executionId');
  expect(actor.text).toContain('this.handle === handle');
  const machine = source(`${base}application/execution-machine.ts`);
  expect(nodes(machine).filter(ts.isImportDeclaration).some(n => /Controller|Platform|react/.test(n.getText(machine)))).toBe(false);
});

it.each(['step','continuous'] as const)('%s owns a fenced mode command port and its observation/failure projection', mode => {
  const commands = source(`${base}${mode}/execution-commands.ts`);
  const fields = nodes(commands).filter(ts.isMethodSignature).map(n => n.name.getText(commands));
  expect(fields.filter(n => ['start','end','retry','retire','dispose','replace'].includes(n))).toEqual([]);
  expect(fields.sort()).toEqual((mode === 'step' ? ['skip','setMetronomeEnabled'] : modeMethods.filter(n => n !== 'skip')).sort());
  const adapter = source(`${base}${mode}/${mode}-execution-session.ts`);
  const commandPort = nodes(adapter).filter(ts.isPropertyAssignment).find(n => n.name.getText(adapter) === 'commands')!;
  const delegates = nodes(ts.createSourceFile('port.ts', commandPort.getText(adapter), ts.ScriptTarget.Latest, true))
    .filter(ts.isPropertyAssignment).filter(n => modeMethods.includes(n.name.getText()));
  expect(delegates).toHaveLength(fields.length);
  for (const delegate of delegates) expect(delegate.getText()).toContain('request.isCommandAccepted()');
  expect(adapter.text).toContain(mode === 'step' ? 'projectStepFailure' : 'projectContinuousFailure');
  expect(adapter.text).toContain('controller.snapshot()');
});

it('browser cross-mode composition is explicit and the React bridge separates root and mode capabilities', () => {
  const bridges = readdirSync(path.join(root, base, 'application')).filter(n => n.endsWith('.ts') && !n.endsWith('.test.ts'))
    .filter(n => {
      const file = source(`${base}application/${n}`);
      const imports = nodes(file).filter(ts.isImportDeclaration).map(n => n.getText(file)).join('\n');
      return imports.includes('createStepExecutionSession') && imports.includes('createContinuousExecutionSession');
    });
  expect(bridges).toEqual(['browser-execution-session-factory.ts']);
  const hook = source('hooks/practice/use-practice-execution.ts');
  expect(hook.text).toContain('new PracticeExecutionActor(options, browserExecutionSessionFactory)');
  expect(hook.text).toContain('modeCommands: actor.modeCommands()');
  expect(nodes(hook).filter(ts.isImportDeclaration).some(n => /StepPracticeController|ContinuousPracticeController/.test(n.getText(hook)))).toBe(false);
  const page = source('app/[locale]/(workspace)/score/[id]/practice/page.tsx');
  expect(page.text).toContain("execution.modeCommands?.mode === 'STEP_BY_STEP'");
  expect(page.text).toContain("execution.modeCommands?.mode === 'CONTINUOUS_PLAY'");
  expect(nodes(page).filter(ts.isImportDeclaration).some(n => /StepPracticeController|ContinuousPracticeController|browserStepPlatform|browserContinuousPlatform/.test(n.getText(page)))).toBe(false);
  const view = source(`${base}application/execution-view.ts`);
  expect(view.text).not.toContain('ExecutionCommands');
});
