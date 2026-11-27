// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { EditorSession } from './session';
import {
  updateScoreMetadata,
  deleteVoiceEvent,
  updateNoteAtom,
  updateMeter,
  deleteVoice,
  effectiveMeasureContext,
  initialMeasure,
  insertExplicitRest,
  type EventId,
  type VoiceId,
  type NoteAtomId,
} from '@/lib/editor-domain';
import { editorXml, note } from '../../../tests/fixtures/editor';
import * as adapter from '@/lib/editor-musicxml';
const xml = editorXml(
  note('n1') + note('n2', 'D', 1, 4, 'eighth') + note('n3', 'E', 1, 4, 'eighth'),
);
function loaded() {
  const session = new EditorSession();
  session.loadMusicXml(xml);
  return session;
}
function materializeSecondVoice(session: EditorSession) {
  return session.applyCommand((document) => {
    const voice = { ...document.voices[0], id: 'P1:voice-2' as VoiceId, number: 2 };
    return insertExplicitRest(
      { ...document, voices: [...document.voices, voice] },
      {
        id: 'second-voice-rest' as EventId,
        voiceId: voice.id,
        staffId: voice.homeStaffId,
        position: { measureId: document.measures[0].id, offset: { numerator: 0, denominator: 1 } },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
      },
    );
  }, 'insert rest in second voice');
}
describe('EditorSession semantic authority', () => {
  it('loads a coherent typed document, opaque source and XML projection', () => {
    const state = loaded().getSnapshot();
    expect(state.document?.metadata.notationTitle).toBe('Source title');
    expect(state.document?.voices[0].number).toBe(1);
    expect(Object.keys(state.source!)).toEqual([]);
    expect(state.serializedXml).toContain('Retain lyric');
  });
  it('applies a domain command atomically and preserves unrelated source', () => {
    const session = loaded();
    const before = session.getSnapshot();
    const result = session.applyCommand(
      (document) =>
        updateNoteAtom({
          document,
          eventId: document.events[0].id,
          noteAtomId: 'n1' as NoteAtomId,
          patch: { pitch: { step: 'F', octave: 5 } },
        }),
      'pitch',
    );
    expect(result.success).toBe(true);
    expect(session.getSnapshot().document).not.toBe(before.document);
    expect(session.getSnapshot().serializedXml).toContain('<step>F</step>');
    expect(session.getSnapshot().serializedXml).toContain('Preserved rights');
    expect(session.getSnapshot().serializedXml).toContain('Retain lyric');
  });
  it('writes metadata from typed commands including visible credits and tempo', () => {
    const session = loaded();
    expect(
      session.applyCommand(
        (document) =>
          updateScoreMetadata(document, {
            notationTitle: 'Edited',
            composer: 'New composer',
            lyricist: 'Writer',
            copyright: 'New rights',
            subtitle: 'New subtitle',
            tempoNotation: { perMinute: 72, beatUnit: 'eighth', dots: 1, visible: false },
          }),
        'metadata',
      ).success,
    ).toBe(true);
    const state = session.getSnapshot();
    expect(state.document?.metadata.composer).toBe('New composer');
    const xml = new DOMParser().parseFromString(state.serializedXml!, 'application/xml');
    expect(xml.querySelector('work-title')?.textContent).toBe('Edited');
    expect(xml.querySelector('creator[type="lyricist"]')?.textContent).toBe('Writer');
    expect(xml.querySelector('metronome > beat-unit-dot')).not.toBeNull();
    expect(xml.querySelector('metronome')?.closest('direction')?.getAttribute('print-object')).toBe(
      'no',
    );
    expect(xml.querySelector('credit-type')?.textContent).toBe('subtitle');
  });
  it('restores semantic snapshots for undo and redo without importing XML', () => {
    const session = loaded();
    const initial = session.getSnapshot().document;
    const spy = vi.spyOn(adapter, 'importEditorMusicXml');
    session.applyCommand(
      (document) => updateScoreMetadata(document, { notationTitle: 'Edit' }),
      'title',
    );
    const changed = session.getSnapshot().document;
    session.undo();
    expect(session.getSnapshot().document).toBe(initial);
    session.redo();
    expect(session.getSnapshot().document).toBe(changed);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('loads a draft as a new coherent session baseline', () => {
    const session = loaded();
    const draft = xml.replace('Source title', 'Draft title');
    session.loadMusicXml(draft);
    expect(session.getSnapshot().document?.metadata.notationTitle).toBe('Draft title');
    expect(session.getSnapshot().canUndo).toBe(false);
  });
  it('replaces an external full document atomically and restores its source on undo', () => {
    const session = loaded();
    const previous = session.getSnapshot().document;
    session.replaceFromExternalMusicXml(
      xml.replace('Retain lyric', 'External lyric'),
      'fingering service',
    );
    expect(session.getSnapshot().serializedXml).toContain('External lyric');
    session.undo();
    expect(session.getSnapshot().document).toBe(previous);
    expect(session.getSnapshot().serializedXml).toContain('Retain lyric');
    session.redo();
    expect(session.getSnapshot().serializedXml).toContain('External lyric');
  });
  it('rejects invalid external replacement without changing the current snapshot', () => {
    const session = loaded();
    const before = session.getSnapshot();
    expect(() => session.replaceFromExternalMusicXml('<bad>', 'external')).toThrow();
    expect(session.getSnapshot()).toBe(before);
  });
  it('keeps an invalid command out of document and history', () => {
    const session = loaded();
    const before = session.getSnapshot();
    expect(
      session.applyCommand(() => ({ success: false, error: 'Rejected' }), 'edit').success,
    ).toBe(false);
    expect(session.getSnapshot()).toBe(before);
  });
  it('treats an empty input voice as session state until first insertion', () => {
    const session = loaded();
    const before = session.getSnapshot();
    const voice = session.prepareVoice()!;
    expect(voice.number).toBe(2);
    expect(session.getSnapshot().document).toBe(before.document);
    expect(session.getSnapshot().serializedXml).toBe(before.serializedXml);
    expect(session.getSnapshot().inputVoices).toEqual([voice]);
    session.discardInputVoice(voice.id);
    expect(session.getSnapshot().inputVoices).toEqual([]);
  });
  it('preserves independent input voices through metadata edits, undo and redo', () => {
    const session = loaded();
    const input = session.prepareVoice()!;
    const original = session.getSnapshot().document;
    expect(
      session.applyCommand(
        (document) => updateScoreMetadata(document, { notationTitle: 'Edited' }),
        'title',
      ).success,
    ).toBe(true);
    expect(session.getSnapshot().inputVoices).toEqual([input]);
    session.undo();
    expect(session.getSnapshot().document).toBe(original);
    expect(session.getSnapshot().inputVoices).toEqual([input]);
    session.redo();
    expect(session.getSnapshot().document?.metadata.notationTitle).toBe('Edited');
    expect(session.getSnapshot().inputVoices).toEqual([input]);
  });
  it('reconciles input voices by part and number when a command materializes a musical voice', () => {
    const session = loaded();
    const input = session.prepareVoice()!;
    const unrelated = session.prepareVoice()!;
    expect(materializeSecondVoice(session).success).toBe(true);
    const persistent = session.getSnapshot().document!.voices.find((voice) => voice.number === 2)!;
    expect(persistent.id).not.toBe(input.id);
    expect(persistent.partId).toBe(input.partId);
    expect(session.getSnapshot().inputVoices).toEqual([unrelated]);
  });
  it('reconciles independent input voices against a document restored by undo', () => {
    const session = loaded();
    expect(materializeSecondVoice(session).success).toBe(true);
    const persistent = session.getSnapshot().document!.voices.find((voice) => voice.number === 2)!;
    expect(
      session.applyCommand((document) => deleteVoice(document, persistent.id), 'delete voice')
        .success,
    ).toBe(true);
    const input = session.prepareVoice()!;
    const unrelated = session.prepareVoice()!;
    expect(input.number).toBe(persistent.number);
    expect(input.id).not.toBe(persistent.id);
    session.undo();
    expect(session.getSnapshot().document!.voices).toContainEqual(persistent);
    expect(session.getSnapshot().inputVoices).toEqual([unrelated]);
  });
  it('reconciles independent input voices against a document restored by redo', () => {
    const session = loaded();
    expect(materializeSecondVoice(session).success).toBe(true);
    session.undo();
    const input = session.prepareVoice()!;
    const unrelated = session.prepareVoice()!;
    session.redo();
    expect(
      session
        .getSnapshot()
        .document!.voices.some(
          (voice) =>
            voice.partId === input.partId && voice.number === input.number && voice.id !== input.id,
        ),
    ).toBe(true);
    expect(session.getSnapshot().inputVoices).toEqual([unrelated]);
  });
  it.each(['load', 'external replacement', 'clear'] as const)(
    '%s clears input targets from the preceding document',
    (operation) => {
      const session = loaded();
      session.prepareVoice();
      expect(session.getSnapshot().inputVoices).toHaveLength(1);
      if (operation === 'load') session.loadMusicXml(xml);
      else if (operation === 'external replacement')
        session.replaceFromExternalMusicXml(xml, 'external');
      else session.clearDocument();
      expect(session.getSnapshot().inputVoices).toEqual([]);
    },
  );
  it('rebuilds domain beams using the effective meter', () => {
    const session = new EditorSession();
    session.loadMusicXml(
      editorXml(
        note('a', 'C', 1, 4, 'eighth') +
          note('b', 'D', 1, 4, 'eighth') +
          note('c', 'E', 1, 4, 'eighth') +
          note('d', 'F', 1, 4, 'eighth'),
      ),
    );
    session.applyCommand(
      (document) => updateMeter(document, initialMeasure(document).id, { beats: 2, beatType: 4 }),
      'meter',
    );
    const doc = session.getSnapshot().document!;
    expect(doc.beamRelationships.map((beam) => beam.eventIds.length)).toEqual([2, 2]);
    expect(effectiveMeasureContext(doc, doc.measures[0].id).duration).toEqual({
      numerator: 8,
      denominator: 4,
    });
    expect(session.getSnapshot().serializedXml).toContain('<beats>2</beats>');
  });
  it('deletes a voice and its events and relationships through a domain command', () => {
    const session = loaded();
    const voice = session.getSnapshot().document!.voices[0];
    expect(
      session.applyCommand((document) => deleteVoice(document, voice.id), 'delete voice').success,
    ).toBe(true);
    expect(session.getSnapshot().document?.events).toEqual([]);
    expect(session.getSnapshot().serializedXml).not.toContain('<note');
    session.undo();
    expect(session.getSnapshot().document?.events).toHaveLength(3);
  });
});

it('does not keep an empty musical voice after its last event is deleted', () => {
  const session = new EditorSession();
  session.loadMusicXml(editorXml(note()));
  const event = session.getSnapshot().document!.events[0];
  expect(
    session.applyCommand(
      (document) => deleteVoiceEvent({ document, eventId: event.id }),
      'delete event',
    ).success,
  ).toBe(true);
  expect(session.getSnapshot().document?.voices).toEqual([]);
  const restored = adapter.importEditorMusicXml(session.getSnapshot().serializedXml!).document;
  expect(restored.voices).toEqual([]);
  session.undo();
  expect(session.getSnapshot().document?.voices).toHaveLength(1);
});
