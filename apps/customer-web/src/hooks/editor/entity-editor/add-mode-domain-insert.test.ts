// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { importEditorMusicXml } from '@/lib/editor-musicxml';
import { applyAddModeDomainInsert } from './add-mode-domain-insert';
import { editorXml, note } from '../../../../tests/fixtures/editor';
const rhythm = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter' as const, dots: 0 },
};
it('uses the effective meter and rejects unknown context', () => {
  const document = importEditorMusicXml(editorXml(note())).document;
  const voice = document.voices[0];
  const insertionAnchor = {
    kind: 'caret' as const,
    caret: {
      kind: 'caret' as const,
      staffId: voice.homeStaffId,
      voiceId: voice.id,
      position: { measureId: document.measures[0].id, offset: { numerator: 1, denominator: 1 } },
    },
  };
  const command = {
    kind: 'insertPitchedEvent' as const,
    pitch: { step: 'D' as const, octave: 4 },
    inputDuration: { kind: 'inputDuration' as const, rhythm },
  };
  expect(
    applyAddModeDomainInsert({ document, insertionAnchor, command, inputVoices: [] }).success,
  ).toBe(true);
  const unknown = {
    ...document,
    measures: document.measures.map((measure) => ({ ...measure, attributes: {} })),
  };
  expect(
    applyAddModeDomainInsert({ document: unknown, insertionAnchor, command, inputVoices: [] })
      .success,
  ).toBe(false);
});
