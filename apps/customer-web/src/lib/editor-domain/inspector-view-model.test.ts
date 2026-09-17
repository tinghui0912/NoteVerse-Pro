import { describe, expect, it } from 'vitest';

import {
  createExplicitRestEvent,
  createPitchedEvent,
  createTimelineGap,
  type DerivedRest,
  type EventId,
  type MeasureId,
  type NoteAtomId,
  type PartId,
  type RhythmicValue,
  type ScoreDocument,
  type ScoreDocumentId,
  type StaffId,
  type VoiceId,
} from './model';
import { getInspectorViewModelForSelection } from './inspector-view-model';

const partId = 'part-1' as PartId;
const staffId = 'part-1:staff-1' as StaffId;
const voiceId = 'part-1:voice-1' as VoiceId;
const measureId = 'measure-1' as MeasureId;
const position = { measureId, offset: { numerator: 0, denominator: 1 } };
const quarter: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter', dots: 0 },
};

const singleNoteEvent = createPitchedEvent({
  id: 'event-note-1' as EventId,
  voiceId,
  staffId,
  position,
  rhythm: quarter,
  notes: [
    {
      id: 'note-1' as NoteAtomId,
      pitch: { step: 'C', octave: 4 },
      fingering: '1',
    },
  ],
});

const chordEvent = createPitchedEvent({
  id: 'event-chord-1' as EventId,
  voiceId,
  staffId,
  position: { measureId, offset: { numerator: 1, denominator: 1 } },
  rhythm: quarter,
  notes: [
    {
      id: 'note-2' as NoteAtomId,
      pitch: { step: 'E', octave: 4 },
    },
    {
      id: 'note-3' as NoteAtomId,
      pitch: { step: 'G', octave: 4 },
      accidental: 'sharp',
    },
  ],
});

const restEvent = createExplicitRestEvent({
  id: 'event-rest-1' as EventId,
  voiceId,
  staffId,
  position: { measureId, offset: { numerator: 2, denominator: 1 } },
  rhythm: quarter,
});

const document: ScoreDocument = {
  schemaVersion: 1,
  id: 'score-1' as ScoreDocumentId,
  parts: [{ id: partId, name: 'Piano' }],
  staves: [{ id: staffId, partId, index: 0 }],
  voices: [{ id: voiceId, partId, homeStaffId: staffId, stemPolicy: 'automatic' }],
  measures: [{ id: measureId, number: 1 }],
  events: [singleNoteEvent, chordEvent, restEvent],
  beamRelationships: [],
  tieRelationships: [],
  slurRelationships: [],
  notationControls: [],
};

describe('editor domain inspector view model', () => {
  it('describes a single-note pitched event without exposing legacy note entities', () => {
    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'event',
      eventId: singleNoteEvent.id,
    });

    expect(viewModel).toMatchObject({
      kind: 'pitchedEvent',
      eventId: 'event-note-1',
      displayKind: 'note',
      voiceId,
      staffId,
      rhythm: quarter,
      notes: [
        {
          noteAtomId: 'note-1',
          pitch: { step: 'C', octave: 4 },
          fingering: '1',
        },
      ],
    });
  });

  it('describes a chord as one pitched event with multiple note atoms', () => {
    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'event',
      eventId: chordEvent.id,
    });

    expect(viewModel).toMatchObject({
      kind: 'pitchedEvent',
      eventId: 'event-chord-1',
      displayKind: 'chord',
      notes: [
        {
          noteAtomId: 'note-2',
          pitch: { step: 'E', octave: 4 },
        },
        {
          noteAtomId: 'note-3',
          pitch: { step: 'G', octave: 4 },
          accidental: 'sharp',
        },
      ],
    });
  });

  it('describes a selected note atom separately from the containing event', () => {
    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'noteAtom',
      eventId: chordEvent.id,
      noteAtomId: 'note-3' as NoteAtomId,
    });

    expect(viewModel).toMatchObject({
      kind: 'noteAtom',
      eventId: 'event-chord-1',
      noteAtomId: 'note-3',
      pitch: { step: 'G', octave: 4 },
      accidental: 'sharp',
    });
  });

  it('exposes event-level notation controls without using parsed-score state', () => {
    const viewModel = getInspectorViewModelForSelection({
      ...document,
      notationControls: [
        {
          kind: 'eventNotation',
          eventId: chordEvent.id,
          stemDirection: 'down',
        },
      ],
    }, {
      kind: 'event',
      eventId: chordEvent.id,
    });

    expect(viewModel).toMatchObject({
      kind: 'pitchedEvent',
      eventId: chordEvent.id,
      stemDirection: 'down',
    });
  });

  it('describes an explicit rest as a first-class event', () => {
    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'event',
      eventId: restEvent.id,
    });

    expect(viewModel).toMatchObject({
      kind: 'explicitRest',
      eventId: 'event-rest-1',
      voiceId,
      staffId,
      rhythm: quarter,
    });
  });

  it('describes timeline gaps without pretending they are rest events', () => {
    const gap = createTimelineGap({
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 3, denominator: 1 } },
      duration: { numerator: 1, denominator: 1 },
    });

    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'timelineGap',
      gap,
    });

    expect(viewModel).toEqual({
      kind: 'timelineGap',
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 3, denominator: 1 } },
      duration: { numerator: 1, denominator: 1 },
    });
  });

  it('describes derived rests as display rests backed by a timeline gap', () => {
    const sourceGap = createTimelineGap({
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 3, denominator: 1 } },
      duration: { numerator: 1, denominator: 1 },
    });
    const rest: DerivedRest = {
      kind: 'derivedRest',
      voiceId,
      staffId,
      position: sourceGap.start,
      rhythm: quarter,
      sourceGap,
    };

    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'derivedRest',
      rest,
    });

    expect(viewModel).toEqual({
      kind: 'derivedRest',
      voiceId,
      staffId,
      position: sourceGap.start,
      rhythm: quarter,
      sourceGap,
    });
  });

  it('does not expose caret and range selections to the inspector', () => {
    expect(
      getInspectorViewModelForSelection(document, {
        kind: 'caret',
        staffId,
        voiceId,
        position,
      }),
    ).toBeNull();

    expect(
      getInspectorViewModelForSelection(document, {
        kind: 'range',
        start: singleNoteEvent.position,
        end: chordEvent.position,
        staffId,
        voiceId,
      }),
    ).toBeNull();
  });
});
