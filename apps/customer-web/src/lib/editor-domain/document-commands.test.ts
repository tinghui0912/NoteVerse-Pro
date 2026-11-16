// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorXml, note } from '../../../tests/fixtures/editor';
import { importEditorMusicXml, serializeEditorMusicXml } from '@/lib/editor-musicxml';
import {
  effectiveMeasureContext,
  updateMeter,
  addTieRelationship,
  addSlurRelationship,
  deleteVoice,
} from './index';
it('inherits meter, key and staff clef per part until an explicit context change', () => {
  const xml = editorXml(note()).replace(
    '</part>',
    '<measure number="2">' +
      note('n2') +
      '</measure><measure number="3"><attributes><time><beats>3</beats><beat-type>8</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>' +
      note('n3') +
      '</measure></part>',
  );
  const document = importEditorMusicXml(xml).document;
  const staff = document.staves[0];
  expect(effectiveMeasureContext(document, document.measures[1].id, staff.id)).toMatchObject({
    meter: { beats: 4, beatType: 4 },
    key: { fifths: -2 },
    clef: { sign: 'G', line: 2 },
  });
  expect(effectiveMeasureContext(document, document.measures[2].id, staff.id)).toMatchObject({
    meter: { beats: 3, beatType: 8 },
    clef: { sign: 'F', line: 4 },
  });
  const changed = updateMeter(document, document.measures[0].id, { beats: 2, beatType: 4 });
  if (!changed.success) throw new Error(changed.error);
  expect(effectiveMeasureContext(changed.document, document.measures[1].id).meter?.beats).toBe(2);
  expect(effectiveMeasureContext(changed.document, document.measures[2].id).meter?.beats).toBe(3);
});
it('retains beam intent beyond the changed meter inheritance scope', () => {
  const body = note('a', 'C', 1, 4, 'eighth') + note('b', 'D', 1, 4, 'eighth');
  // A domain beam on the second measure is independent of editing the first meter.
  const imported = importEditorMusicXml(
    editorXml(body).replace(
      '</part>',
      '<measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
        note('c', 'C', 1, 4, 'eighth') +
        note('d', 'D', 1, 4, 'eighth') +
        '</measure></part>',
    ),
  );
  const ids = imported.document.events.slice(2).map((event) => event.id);
  const beam = {
    id: 'second-beam' as never,
    eventIds: ids as [(typeof ids)[number], (typeof ids)[number]],
  };
  const document = { ...imported.document, beamRelationships: [beam] };
  const result = updateMeter(document, document.measures[0].id, { beats: 2, beatType: 4 });
  expect(result.success).toBe(true);
  if (result.success) expect(result.document.beamRelationships).toContain(beam);
});
it('removes a voice and all touching relationship intent', () => {
  let document = importEditorMusicXml(editorXml(note('a') + note('b'))).document;
  const tie = addTieRelationship({
    document,
    startNoteAtomId: 'a' as never,
    stopNoteAtomId: 'b' as never,
  });
  if (!tie.success) throw new Error(tie.error);
  document = tie.document;
  const slur = addSlurRelationship({
    document,
    startNoteAtomId: 'a' as never,
    stopNoteAtomId: 'b' as never,
  });
  if (!slur.success) throw new Error(slur.error);
  const withNotation = {
    ...slur.document,
    notationControls: [
      ...slur.document.notationControls,
      {
        kind: 'beamNotation' as const,
        notationId: 'beam-control' as never,
        eventIds: [document.events[0].id] as [(typeof document.events)[number]['id']],
        direction: 'up' as const,
      },
    ],
  };
  const result = deleteVoice(withNotation, document.voices[0].id);
  expect(result.success).toBe(true);
  if (result.success)
    expect(result.document).toMatchObject({
      events: [],
      voices: [],
      tieRelationships: [],
      slurRelationships: [],
      beamRelationships: [],
      notationControls: [],
    });
});
it('preserves unrelated mixed direction content when tempo notation changes', () => {
  const source = editorXml(
    '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome><words>Keep words</words></direction-type></direction>' +
      note(),
  );
  const imported = importEditorMusicXml(source);
  const document = {
    ...imported.document,
    metadata: {
      ...imported.document.metadata,
      tempoNotation: { perMinute: 90, beatUnit: 'quarter' as const, dots: 0, visible: true },
    },
  };
  expect(serializeEditorMusicXml({ document, source: imported.source })).toContain('Keep words');
  expect(() =>
    serializeEditorMusicXml({
      document: {
        ...document,
        metadata: {
          ...document.metadata,
          tempoNotation: { ...document.metadata.tempoNotation, visible: false },
        },
      },
      source: imported.source,
    }),
  ).toThrow();
});
