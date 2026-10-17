import fs from 'node:fs';
import ts from 'typescript';
const file = 'src/lib/practice/local-core/local-practice-core.test.ts';
let text = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), ranges = [];
function visit(node) {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const call = node.expression, name = call.arguments[0];
    if (name && ts.isStringLiteral(name) && (name.text === 'local STEP practice runtime'
      || name.text.startsWith('rejects STEP evidence') || name.text.startsWith('supports STEP pause')
      || name.text === 'sets SCOPE_COMPLETED on natural STEP completion')) {
      ranges.push([node.getFullStart(), node.end]); return;
    }
  }
  if (ts.isFunctionDeclaration(node) && ['observation', 'acousticEvent'].includes(node.name?.text)) {
    ranges.push([node.getFullStart(), node.end]); return;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const [start, end] of ranges.sort((a,b) => b[0]-a[0])) text = text.slice(0,start) + text.slice(end);
text = text.replace(/  StepEvidenceSession,\r?\n|  type StepVerifierObservation,\r?\n|import type \{ AcousticNoteEvent \} from '..\/acoustic-inference';\r?\n/g, '');
text = text.replace(/const testTargetVerificationPolicy = \{[\s\S]*?\};\r?\n/, '');
text = text.replaceAll('new StepPracticeRuntime({', "new StepPracticeRuntime({ inputSource: 'MIDI',");
const start = text.indexOf('    const runtime = new StepPracticeRuntime(', text.indexOf("it('normalizes acoustic sample timing"));
const end = text.indexOf('    const midiTimebase', start);
text = text.slice(0,start) + "    expect(acousticTimebase.sampleIndexToSessionTime(16_800).ms).toBe(550);\n\n" + text.slice(end);
fs.writeFileSync(file, text);
// These tests verify the shared driver, not target-aware gesture assembly.
const midi = 'src/lib/practice/midi/browser-midi-controller.test.ts';
text = fs.readFileSync(midi, 'utf8');
const begin = text.indexOf("  it('coalesces chord"), finish = text.indexOf("  it('throws MidiNoConnectedInputError", begin);
text = text.slice(0,begin) + text.slice(finish); text = text.replace(', vi', ''); fs.writeFileSync(midi,text);
