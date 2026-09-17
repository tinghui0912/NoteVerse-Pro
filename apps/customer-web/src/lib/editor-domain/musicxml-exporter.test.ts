// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  type EventId,
  type BeamId,
  type MeasureId,
  type NoteAtomId,
  type NotationId,
  type PartId,
  type ScoreDocument,
  type ScoreDocumentId,
  type StaffId,
  type TieId,
  type VoiceId,
} from './model';
import type { NotationControl } from './notation-model';
import { setEventStemDirectionOverride } from './commands';
import { exportEditorDomainToMusicXml } from './musicxml-exporter';

const partId = 'P1' as PartId;
const trebleStaffId = 'P1:staff-1' as StaffId;
const bassStaffId = 'P1:staff-2' as StaffId;
const voiceOneId = 'P1:voice-1' as VoiceId;
const voiceTwoId = 'P1:voice-2' as VoiceId;
const measureId = 'P1:measure-1' as MeasureId;

function baseDocument(
  events: ScoreDocument['events'],
  notationControls: NotationControl[] = [],
  beamRelationships: ScoreDocument['beamRelationships'] = [],
  tieRelationships: ScoreDocument['tieRelationships'] = [],
  slurRelationships: ScoreDocument['slurRelationships'] = [],
): ScoreDocument {
  return {
    schemaVersion: 1,
    id: 'score-document-1' as ScoreDocumentId,
    parts: [
      {
        id: partId,
        name: 'Piano',
      },
    ],
    staves: [
      {
        id: trebleStaffId,
        partId,
        index: 0,
      },
      {
        id: bassStaffId,
        partId,
        index: 1,
      },
    ],
    voices: [
      {
        id: voiceOneId,
        partId,
        homeStaffId: trebleStaffId,
        stemPolicy: 'automatic',
      },
      {
        id: voiceTwoId,
        partId,
        homeStaffId: trebleStaffId,
        stemPolicy: 'automatic',
      },
    ],
    measures: [
      {
        id: measureId,
        number: 1,
      },
    ],
    events,
    beamRelationships,
    tieRelationships,
    slurRelationships,
    notationControls,
  };
}

function parse(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

describe('editor domain to MusicXML exporter', () => {
  it('exports one pitched event as a MusicXML note', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          {
            id: 'note-c' as NoteAtomId,
            pitch: { step: 'C', octave: 4 },
          },
        ],
      },
    ])));

    const note = xmlDoc.querySelector('part > measure > note');

    expect(note?.querySelector('pitch > step')?.textContent).toBe('C');
    expect(note?.querySelector(':scope > duration')?.textContent).toBe('4');
    expect(note?.querySelector(':scope > voice')?.textContent).toBe('1');
    expect(note?.querySelector(':scope > type')?.textContent).toBe('quarter');
    expect(note?.querySelector(':scope > staff')?.textContent).toBe('1');
    expect(note?.querySelector(':scope > stem')).toBeNull();
  });

  it('exports explicit stem direction notation controls on pitched event roots', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 } },
          { id: 'note-e' as NoteAtomId, pitch: { step: 'E', octave: 4 } },
        ],
      },
    ], [
      {
        kind: 'eventNotation',
        eventId: 'event-1' as EventId,
        stemDirection: 'double',
      },
    ])));

    const notes = Array.from(xmlDoc.querySelectorAll('part > measure > note'));

    expect(notes[0]?.querySelector(':scope > stem')?.textContent).toBe('double');
    expect(notes[1]?.querySelector(':scope > stem')).toBeNull();
  });

  it('exports stem overrides produced by the domain command helper', () => {
    const document = baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 } },
        ],
      },
    ]);
    const setStem = setEventStemDirectionOverride({
      document,
      eventId: 'event-1' as EventId,
      stemDirection: 'up',
    });
    expect(setStem.success).toBe(true);
    if (!setStem.success) return;

    const withStem = parse(exportEditorDomainToMusicXml(setStem.document));
    expect(withStem.querySelector('part > measure > note > stem')?.textContent).toBe('up');

    const clearStem = setEventStemDirectionOverride({
      document: setStem.document,
      eventId: 'event-1' as EventId,
    });
    expect(clearStem.success).toBe(true);
    if (!clearStem.success) return;

    const withoutStem = parse(exportEditorDomainToMusicXml(clearStem.document));
    expect(withoutStem.querySelector('part > measure > note > stem')).toBeNull();
  });

  it('does not synthesize beam relationships for plain beamable events', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 2 },
          notation: { base: 'eighth', dots: 0 },
        },
        notes: [
          { id: 'note-1' as NoteAtomId, pitch: { step: 'C', octave: 4 } },
        ],
      },
      {
        id: 'event-2' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 1, denominator: 2 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 2 },
          notation: { base: 'eighth', dots: 0 },
        },
        notes: [
          { id: 'note-2' as NoteAtomId, pitch: { step: 'D', octave: 4 } },
        ],
      },
    ])));

    expect(xmlDoc.querySelectorAll('note > beam')).toHaveLength(0);
  });

  it('exports explicit domain beam relationships as MusicXML beam groups', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 2 },
          notation: { base: 'eighth', dots: 0 },
        },
        notes: [
          { id: 'note-1' as NoteAtomId, pitch: { step: 'C', octave: 4 } },
        ],
      },
      {
        id: 'event-2' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 1, denominator: 2 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 2 },
          notation: { base: 'eighth', dots: 0 },
        },
        notes: [
          { id: 'note-2' as NoteAtomId, pitch: { step: 'D', octave: 4 } },
        ],
      },
    ], [], [
      {
        id: 'beam-1' as BeamId,
        eventIds: ['event-1' as EventId, 'event-2' as EventId],
      },
    ])));

    expect(Array.from(xmlDoc.querySelectorAll('note > beam')).map((beam) => beam.textContent)).toEqual([
      'begin',
      'end',
    ]);
  });

  it('exports domain tie relationships as MusicXML tie and tied elements', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-1' as NoteAtomId, pitch: { step: 'C', octave: 4 }, tieOut: 'tie-1' as TieId },
        ],
      },
      {
        id: 'event-2' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 1, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-2' as NoteAtomId, pitch: { step: 'C', octave: 4 }, tieIn: 'tie-1' as TieId },
        ],
      },
    ], [
      {
        kind: 'tieNotation',
        tieId: 'tie-1' as TieId,
        placement: 'below',
      },
    ], [], [
      {
        id: 'tie-1' as TieId,
        startNoteAtomId: 'note-1' as NoteAtomId,
        stopNoteAtomId: 'note-2' as NoteAtomId,
      },
    ])));

    const notes = Array.from(xmlDoc.querySelectorAll('part > measure > note'));
    expect(notes[0]?.querySelector(':scope > tie[type="start"]')).not.toBeNull();
    expect(notes[0]?.querySelector(':scope > notations > tied[type="start"]')).not.toBeNull();
    expect(notes[0]?.querySelector(':scope > notations > tied[type="start"]')?.getAttribute('orientation')).toBe('under');
    expect(notes[1]?.querySelector(':scope > tie[type="stop"]')).not.toBeNull();
    expect(notes[1]?.querySelector(':scope > notations > tied[type="stop"]')).not.toBeNull();
  });

  it('exports domain slur relationships as MusicXML slur elements', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-1' as NoteAtomId, pitch: { step: 'C', octave: 4 } },
        ],
      },
      {
        id: 'event-2' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 1, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-2' as NoteAtomId, pitch: { step: 'E', octave: 4 } },
        ],
      },
    ], [
      {
        kind: 'slurNotation',
        notationId: 'slur-1' as NotationId,
        placement: 'above',
      },
    ], [], [], [
      {
        id: 'slur-1' as NotationId,
        startNoteAtomId: 'note-1' as NoteAtomId,
        stopNoteAtomId: 'note-2' as NoteAtomId,
      },
    ])));

    const notes = Array.from(xmlDoc.querySelectorAll('part > measure > note'));
    expect(notes[0]?.querySelector(':scope > notations > slur[type="start"]')?.getAttribute('number')).toBe('1');
    expect(notes[0]?.querySelector(':scope > notations > slur[type="start"]')?.getAttribute('placement')).toBe('above');
    expect(notes[1]?.querySelector(':scope > notations > slur[type="stop"]')?.getAttribute('number')).toBe('1');
  });

  it('exports a pitched event with multiple note atoms as MusicXML chord encoding', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          { id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 } },
          { id: 'note-e' as NoteAtomId, pitch: { step: 'E', octave: 4 } },
          { id: 'note-g' as NoteAtomId, pitch: { step: 'G', octave: 4 } },
        ],
      },
    ])));

    const notes = Array.from(xmlDoc.querySelectorAll('part > measure > note'));

    expect(notes).toHaveLength(3);
    expect(notes[0]?.querySelector(':scope > chord')).toBeNull();
    expect(notes[1]?.querySelector(':scope > chord')).not.toBeNull();
    expect(notes[2]?.querySelector(':scope > chord')).not.toBeNull();
    expect(notes.map((note) => note.querySelector('pitch > step')?.textContent)).toEqual(['C', 'E', 'G']);
  });

  it('exports explicit rests as MusicXML rest notes', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'rest-1' as EventId,
        kind: 'explicitRest',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 1 },
        },
      },
    ])));

    const note = xmlDoc.querySelector('part > measure > note');

    expect(note?.querySelector(':scope > rest')).not.toBeNull();
    expect(note?.querySelector(':scope > duration')?.textContent).toBe('4');
    expect(note?.querySelectorAll(':scope > dot')).toHaveLength(1);
  });

  it('generates forward elements for gaps before the next voice event', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 2, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [{ id: 'note-c' as NoteAtomId, pitch: { step: 'C', octave: 4 } }],
      },
    ])));

    const forward = xmlDoc.querySelector('part > measure > forward');

    expect(forward?.querySelector(':scope > duration')?.textContent).toBe('8');
    expect(forward?.querySelector(':scope > voice')?.textContent).toBe('1');
    expect(forward?.querySelector(':scope > staff')?.textContent).toBe('1');
  });

  it('generates backup before writing a second voice', () => {
    const xmlDoc = parse(exportEditorDomainToMusicXml(baseDocument([
      {
        id: 'event-v1' as EventId,
        kind: 'pitched',
        voiceId: voiceOneId,
        staffId: trebleStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [{ id: 'note-v1' as NoteAtomId, pitch: { step: 'C', octave: 4 } }],
      },
      {
        id: 'event-v2' as EventId,
        kind: 'pitched',
        voiceId: voiceTwoId,
        staffId: bassStaffId,
        position: {
          measureId,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [{ id: 'note-v2' as NoteAtomId, pitch: { step: 'G', octave: 3 } }],
      },
    ])));

    const children = Array.from(xmlDoc.querySelector('part > measure')?.children ?? []);

    expect(children.map((child) => child.tagName)).toContain('backup');
    expect(xmlDoc.querySelector('part > measure > backup > duration')?.textContent).toBe('4');
    expect(Array.from(xmlDoc.querySelectorAll('part > measure > note')).map((note) => note.querySelector(':scope > voice')?.textContent)).toEqual(['1', '2']);
    expect(Array.from(xmlDoc.querySelectorAll('part > measure > note')).map((note) => note.querySelector(':scope > staff')?.textContent)).toEqual(['1', '2']);
  });
});
