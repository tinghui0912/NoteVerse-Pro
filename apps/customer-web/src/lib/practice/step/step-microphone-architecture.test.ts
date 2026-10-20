import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const read = (name: string) => readFileSync(path.join(__dirname, name), 'utf8');
const calls = (name: string, expression: string, construct = false) => {
  const ast = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true), result: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if ((construct ? ts.isNewExpression(node) : ts.isCallExpression(node)) && (node as ts.CallExpression).expression.getText(ast) === expression) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); return result;
};

it('one STEP resource component uses existing infrastructure, never target policy or Continuous product ownership', () => {
  for (const file of ['step-microphone-input.ts', 'step-microphone-platform.ts', 'step-acoustic-capture-bridge.ts']) {
    const source = read(file);
    expect(source).not.toMatch(/PracticeScoreArtifact|StepPracticeRuntime|pitchSetsEqual|targetGeneration|expected|currentTarget|MICROPHONE_CONSERVATIVE_TRISTATE|Continuous|transport|practice-session|WebSocket|\bp2\(/);
    expect(source).not.toMatch(/performance\.now|getOutputTimestamp|setTimeout|setInterval|RMS|spectral|onsetThreshold|frameThreshold|\.rearm\(/);
    expect(source).not.toMatch(/new Worker|InferenceSession|decodeRobust|endAnalysisRegion/);
  }
  expect(calls('step-microphone-input.ts', 'StepAcousticAttemptAssembler', true)).toHaveLength(1);
  expect(calls('step-microphone-input.ts', 'SourceAnalysisRuntime.create')).toHaveLength(1);
  expect(calls('step-acoustic-capture-bridge.ts', 'SourceChronology', true)).toHaveLength(1);
  expect(calls('step-microphone-input.ts', 'this.platform.createWorker')).toHaveLength(1);
  expect(calls('step-microphone-input.ts', 'this.worker.load')).toHaveLength(1);
  expect(calls('step-microphone-input.ts', 'this.runtime!.beginAnalysisRegion')).toHaveLength(1);
  expect(read('step-microphone-platform.ts')).toContain('createWorker: createAcousticModelWorker');
  expect(read('step-microphone-platform.ts')).toContain('BrowserAcousticCapture.connect(options)');
  expect(read('step-microphone-input.ts')).toContain("ownership: 'BORROWED_SESSION_STREAM'");
});

it('physical retirement is issued from capture chronology, never acoustic processed coverage', () => {
  const source = read('step-microphone-input.ts');
  const ast = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true);
  const methods: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node) => { if (ts.isMethodDeclaration(node)) methods.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  for (const name of ['retirementBoundary', 'arm', 'captured']) {
    const method = methods.find(n => n.name.getText(ast) === name)!.getText(ast);
    expect(method).not.toContain('ownedThroughSourceSample');
    expect(method).toContain('capturedThroughSourceSample');
  }
  const bridge = read('step-acoustic-capture-bridge.ts');
  expect(bridge).not.toMatch(/SourceAcousticPublication|ownedThroughSourceSample|observation|\.pitch/);
  expect(bridge).toContain('this.chronology.accept(chunk)');
  expect(bridge).toContain('this.capturedThrough = chunk.sourceEndSampleIndex');
  expect(source).toContain('boundary !== this.issued');
  expect(source).toContain('origin / rate * 1000');
  expect(source).toContain('this.connection.context.currentTime * 1000');
});

it('browser STEP startup and capability remain closed; no application consumer imports new resources', () => {
  const controller = read('step-practice-controller.ts');
  expect(controller).toContain('STEP_ANALYSIS_UNAVAILABLE_REASON');
  expect(controller).not.toMatch(/StepMicrophoneInput|browserStepMicrophonePlatform|createAudioContext|getUserMedia/);
  const hook = readFileSync(path.join(__dirname, '../../../hooks/practice/use-step-local-practice.ts'), 'utf8');
  expect(hook).not.toMatch(/StepMicrophoneInput|browserStepMicrophonePlatform|\.rearm\(/);
  const capability = readFileSync(path.join(__dirname, '../input-capability.ts'), 'utf8');
  expect(capability).toContain('ATTEMPT_ANALYZER_NOT_VALIDATED');
});
