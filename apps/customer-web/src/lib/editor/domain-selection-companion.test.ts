import { describe, expect, it } from 'vitest';

import type { DomainAnchor, EventId, NoteAtom, NoteAtomId } from '@/lib/editor-domain';
import {
  createTestScoreDocument,
  testMeasureId,
  testStaffId,
  testVoiceId,
} from '@/lib/editor-domain/test-fixtures';
import { createDomainSelectionCompanion } from './domain-selection-companion';

const quarter = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter' as const, dots: 0 },
};

function noteAtom(id: string, step: NoteAtom['pitch']['step']): NoteAtom {
  return {
    id: id as NoteAtomId,
    pitch: { step, octave: 4 },
  };
}

const document = createTestScoreDocument({
  events: [
    {
      id: 'event-1' as EventId,
      kind: 'pitched',
      voiceId: testVoiceId,
      staffId: testStaffId,
      position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
      rhythm: quarter,
      notes: [noteAtom('note-1', 'C'), noteAtom('note-2', 'E')],
    },
  ],
});

describe('domain selection companion', () => {
  it('creates an Inspector companion for event anchors', () => {
    expect(createDomainSelectionCompanion(document, {
      kind: 'event',
      eventId: 'event-1' as EventId,
    })).toMatchObject({
      domainAnchor: {
        kind: 'event',
        eventId: 'event-1',
      },
      inspectorViewModel: {
        kind: 'pitchedEvent',
        eventId: 'event-1',
        displayKind: 'chord',
      },
    });
  });

  it('creates an Inspector companion for note atom anchors', () => {
    expect(createDomainSelectionCompanion(document, {
      kind: 'noteAtom',
      eventId: 'event-1' as EventId,
      noteAtomId: 'note-2' as NoteAtomId,
    })).toMatchObject({
      domainAnchor: {
        kind: 'noteAtom',
        eventId: 'event-1',
        noteAtomId: 'note-2',
      },
      inspectorViewModel: {
        kind: 'noteAtom',
        eventId: 'event-1',
        noteAtomId: 'note-2',
        pitch: { step: 'E', octave: 4 },
      },
    });
  });

  it('does not manufacture Inspector companions for structural anchors or missing documents', () => {
    const measureAnchor: DomainAnchor = {
      kind: 'measure',
      measureId: testMeasureId,
    };

    expect(createDomainSelectionCompanion(document, measureAnchor)).toBeNull();
    expect(createDomainSelectionCompanion(null, {
      kind: 'event',
      eventId: 'event-1' as EventId,
    })).toBeNull();
  });
});
