import { describe, expect, it } from 'vitest';

import type { EventId, InspectorViewModel, NoteAtomId } from '@/lib/editor-domain';
import {
  getDomainSelectionSummary,
  toEditableEventFromDomainInspectorViewModel,
} from './event-inspector-domain-view-model';

const quarter = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter' as const, dots: 0 },
};

const dottedHalf = {
  timelineDuration: { numerator: 3, denominator: 1 },
  notation: { base: 'half' as const, dots: 1 },
};

describe('event inspector domain view-model adapter', () => {
  it('maps a domain single-note view model to the current editable event shape', () => {
    const viewModel: InspectorViewModel = {
      kind: 'pitchedEvent',
      eventId: 'event-1' as EventId,
      displayKind: 'note',
      voiceId: 'voice-1' as never,
      staffId: 'staff-1' as never,
      position: { measureId: 'measure-1' as never, offset: { numerator: 0, denominator: 1 } },
      rhythm: dottedHalf,
      stemDirection: 'up',
      notes: [
        {
          noteAtomId: 'note-1' as NoteAtomId,
          pitch: { step: 'F', octave: 5, alter: 1 },
          accidental: 'sharp',
          fingering: '2',
        },
      ],
    };

    expect(toEditableEventFromDomainInspectorViewModel(viewModel)).toEqual({
      duration: 'durationHalf',
      dotted: true,
      pitches: ['F#5'],
      stemDirection: 'up',
      fingerings: ['2'],
      accidentals: ['sharp'],
    });
  });

  it('maps a domain chord view model to aligned editable pitches and per-note metadata', () => {
    const viewModel: InspectorViewModel = {
      kind: 'pitchedEvent',
      eventId: 'event-1' as EventId,
      displayKind: 'chord',
      voiceId: 'voice-1' as never,
      staffId: 'staff-1' as never,
      position: { measureId: 'measure-1' as never, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
      stemDirection: 'down',
      notes: [
        {
          noteAtomId: 'note-1' as NoteAtomId,
          pitch: { step: 'C', octave: 4 },
          fingering: '1',
        },
        {
          noteAtomId: 'note-2' as NoteAtomId,
          pitch: { step: 'E', octave: 4, alter: -1 },
          accidental: 'flat',
        },
      ],
    };

    expect(toEditableEventFromDomainInspectorViewModel(viewModel)).toEqual({
      duration: 'durationQuarter',
      dotted: false,
      pitches: ['C4', 'Eb4'],
      stemDirection: 'down',
      fingerings: ['1', 'none'],
      accidentals: [undefined, 'flat'],
    });
  });

  it('maps a domain explicit rest view model to an explicit rest editable event', () => {
    const viewModel: InspectorViewModel = {
      kind: 'explicitRest',
      eventId: 'rest-1' as EventId,
      voiceId: 'voice-1' as never,
      staffId: 'staff-1' as never,
      position: { measureId: 'measure-1' as never, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
    };

    expect(toEditableEventFromDomainInspectorViewModel(viewModel)).toEqual({
      duration: 'durationQuarter',
      dotted: false,
      pitches: [],
      stemDirection: 'none',
      fingerings: [],
      accidentals: [],
    });
  });

  it('derives selection summary numbers from domain position, voice, and staff ids', () => {
    const viewModel: InspectorViewModel = {
      kind: 'explicitRest',
      eventId: 'rest-1' as EventId,
      voiceId: 'P1:voice-3' as never,
      staffId: 'P1:staff-2' as never,
      position: { measureId: 'P1:measure-12' as never, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
    };

    expect(getDomainSelectionSummary(viewModel)).toEqual({
      measure: 12,
      voice: 3,
      staffIndex: 1,
    });
  });

  it('uses one-based defaults when domain ids do not end in numbers', () => {
    const viewModel: InspectorViewModel = {
      kind: 'explicitRest',
      eventId: 'rest-1' as EventId,
      voiceId: 'voice' as never,
      staffId: 'staff' as never,
      position: { measureId: 'measure' as never, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
    };

    expect(getDomainSelectionSummary(viewModel)).toEqual({
      measure: 1,
      voice: 1,
      staffIndex: 0,
    });
  });
});
