import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { ContinuousMidiEvidence } from '../local-core/continuous-midi-evidence';
import { STEP_MIDI_CHORD_COHERENCE_MS } from './step-midi-attempt-input';

it('re-arm has one required SessionTime argument and no implicit clock read', () => {
  const file = path.join(__dirname, '../local-core/step-runtime.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const owner = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'StepPracticeRuntime') as ts.ClassDeclaration;
  const rearm = owner.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === 'rearm') as ts.MethodDeclaration;
  expect(rearm.parameters).toHaveLength(1);
  expect(rearm.parameters[0].questionToken).toBeUndefined();
  expect(rearm.parameters[0].initializer).toBeUndefined();
  expect(rearm.getText(source)).not.toMatch(/this\.now|Date\.now|performance\.now|EPSILON|toFixed|round/);
});
it('native handler forwards event time into the sole dispatch path', () => {
  const source = readFileSync(path.join(__dirname, '../midi/browser-midi-controller.ts'), 'utf8');
  expect(source).toContain('this.dispatchMidiData(event.data, event.timeStamp)');
  expect(source).not.toContain('StepMidiAttemptInput');
  expect(STEP_MIDI_CHORD_COHERENCE_MS).toBe(35);
});
it('Continuous MIDI keeps adjacent NOTE_ON facts independent, not a STEP gesture', () => {
  const evidence = new ContinuousMidiEvidence('continuous-midi');
  evidence.observe('C4', 100, 1); evidence.observe('E4', 112, 1);
  const publication = evidence.cover(120, 140)!;
  expect(publication.observations.map(o => [o.pitch, o.performanceTimeMs])).toEqual([['C4', 100], ['E4', 112]]);
  expect(new Set(publication.observations.map(o => o.observationId)).size).toBe(2);
  expect(readFileSync(path.join(__dirname, '../continuous/continuous-midi-input.ts'), 'utf8')).not.toMatch(/STEP_MIDI|StepMidiAttemptInput/);
});
