import { describe, expect, it } from 'vitest';

import type { EventId, NoteAtomId } from './model';
import { resolveDomainAnchorsBySourceId, createRenderAnchorIndex } from './render-anchors';
import {
  createSourceRenderAnchorsFromDocument,
  resolveDomainAnchorFromRenderOrSourceId,
} from './source-render-anchors';
import {
  createTestScoreDocument,
  testMeasureId,
  testStaffId,
  testVoiceId,
} from './test-fixtures';

const quarter = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter' as const, dots: 0 },
};

describe('source render anchors', () => {
  it('creates source-id anchors for pitched event note atoms and event fallback lookup', () => {
    const document = createTestScoreDocument({
      events: [
        {
          id: 'event-1' as EventId,
          kind: 'pitched',
          voiceId: testVoiceId,
          staffId: testStaffId,
          position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
          rhythm: quarter,
          notes: [
            {
              id: 'note-1' as NoteAtomId,
              pitch: { step: 'C', octave: 4 },
              source: { musicXmlElementId: 'musicxml-note-1' },
            },
            {
              id: 'note-2' as NoteAtomId,
              pitch: { step: 'E', octave: 4 },
              source: { musicXmlElementId: 'musicxml-note-2' },
            },
          ],
          source: { musicXmlElementIds: ['musicxml-note-1', 'musicxml-note-2'] },
        },
      ],
    });

    const anchors = createSourceRenderAnchorsFromDocument(document);
    const index = createRenderAnchorIndex(anchors);

    expect(resolveDomainAnchorFromRenderOrSourceId(anchors, 'musicxml-note-2')).toEqual({
      kind: 'noteAtom',
      eventId: 'event-1',
      noteAtomId: 'note-2',
    });
    expect(resolveDomainAnchorsBySourceId(index, 'musicxml-note-2')).toEqual([
      {
        kind: 'noteAtom',
        eventId: 'event-1',
        noteAtomId: 'note-2',
      },
      {
        kind: 'event',
        eventId: 'event-1',
      },
    ]);
  });

  it('creates event fallback anchors for event source ids not owned by note atoms', () => {
    const document = createTestScoreDocument({
      events: [
        {
          id: 'event-1' as EventId,
          kind: 'pitched',
          voiceId: testVoiceId,
          staffId: testStaffId,
          position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
          rhythm: quarter,
          notes: [
            {
              id: 'note-1' as NoteAtomId,
              pitch: { step: 'C', octave: 4 },
            },
          ],
          source: { musicXmlElementIds: ['musicxml-event-1'] },
        },
      ],
    });

    const anchors = createSourceRenderAnchorsFromDocument(document);

    expect(resolveDomainAnchorFromRenderOrSourceId(anchors, 'musicxml-event-1')).toEqual({
      kind: 'event',
      eventId: 'event-1',
    });
  });

  it('creates source-id anchors for explicit rests', () => {
    const document = createTestScoreDocument({
      events: [
        {
          id: 'rest-1' as EventId,
          kind: 'explicitRest',
          voiceId: testVoiceId,
          staffId: testStaffId,
          position: { measureId: testMeasureId, offset: { numerator: 1, denominator: 4 } },
          rhythm: quarter,
          source: { musicXmlElementId: 'musicxml-rest-1' },
        },
      ],
    });

    const anchors = createSourceRenderAnchorsFromDocument(document);

    expect(resolveDomainAnchorFromRenderOrSourceId(anchors, 'musicxml-rest-1')).toEqual({
      kind: 'event',
      eventId: 'rest-1',
    });
  });

  it('keeps missing source ids unresolved instead of manufacturing anchors', () => {
    const document = createTestScoreDocument({
      events: [
        {
          id: 'event-1' as EventId,
          kind: 'pitched',
          voiceId: testVoiceId,
          staffId: testStaffId,
          position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
          rhythm: quarter,
          notes: [
            {
              id: 'note-1' as NoteAtomId,
              pitch: { step: 'C', octave: 4 },
            },
          ],
        },
      ],
    });

    const anchors = createSourceRenderAnchorsFromDocument(document);

    expect(anchors).toEqual([]);
    expect(resolveDomainAnchorFromRenderOrSourceId(anchors, 'missing')).toBeNull();
  });
});
