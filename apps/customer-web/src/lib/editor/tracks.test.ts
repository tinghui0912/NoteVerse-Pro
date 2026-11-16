// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorDocument, note } from '../../../tests/fixtures/editor';
import { deriveEditorTracks } from './tracks';
it('projects typed voice numbers independently of their identity spelling', () => {
  const document = editorDocument(note('a', 'C', 1) + note('b', 'D', 2));
  document.voices[0] = { ...document.voices[0], number: 7 };
  const tracks = deriveEditorTracks(document);
  expect(tracks.map((track) => track.xmlVoice)).toEqual([2, 7]);
  expect(tracks.find((track) => track.xmlVoice === 7)?.voiceId).toBe(document.voices[0].id);
  expect(tracks.every((track) => track.entityCount === 1)).toBe(true);
});
it('projects an input target without persisting an empty voice', () => {
  const document = editorDocument();
  const input = { ...document.voices[0], id: 'input-id' as never, number: 8 };
  expect(deriveEditorTracks(document, [input]).find((track) => track.xmlVoice === 8)).toMatchObject(
    { entityCount: 0, measureCount: 0 },
  );
});

it('keeps separate part voices and maps their staff positions onto the rendered score', () => {
  const first = editorDocument(note());
  const part = { id: 'P2' as never, name: 'Other part' };
  const staff = { id: 'P2:staff-1' as never, partId: part.id, index: 0 };
  const voice = {
    id: 'independent-voice' as never,
    partId: part.id,
    homeStaffId: staff.id,
    number: 1,
    stemPolicy: 'automatic' as const,
  };
  const document = {
    ...first,
    parts: [...first.parts, part],
    staves: [...first.staves, staff],
    voices: [...first.voices, voice],
  };
  expect(
    deriveEditorTracks(document).map((track) => [track.partId, track.xmlVoice, track.staffIndex]),
  ).toEqual([
    ['P1', 1, 0],
    ['P2', 1, 1],
  ]);
});
