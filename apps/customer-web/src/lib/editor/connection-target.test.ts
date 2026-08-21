import { describe, expect, it } from 'vitest';
import {
  createExplicitRestEvent,
  createPitchedEvent,
  type EventId,
  type NoteAtomId,
  type RenderAnchor,
} from '@/lib/editor-domain';
import {
  createTestScoreDocument,
  testMeasureId,
  testStaffId,
  testVoiceId,
} from '@/lib/editor-domain/test-fixtures';
import {
  getConnectionTarget,
  getConnectionTargetSourceId,
} from './connection-target';

const quarter = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter' as const, dots: 0 },
};

const noteAtomAnchor = {
  kind: 'noteAtom' as const,
  eventId: 'event-1' as EventId,
  noteAtomId: 'note-member' as NoteAtomId,
};

describe('editor connection target adapter', () => {
  it('prefers the domain note-atom anchor source id for connection targets', () => {
    const anchors: RenderAnchor[] = [
      {
        renderId: 'verovio-member',
        sourceId: 'domain-member-source',
        domain: noteAtomAnchor,
      },
    ];

    expect(getConnectionTargetSourceId(noteAtomAnchor, anchors)).toBe('domain-member-source');
  });

  it('builds a connection target from a pitched domain event source ids', () => {
    const document = createTestScoreDocument({
      events: [
        createPitchedEvent({
          id: 'event-1' as EventId,
          voiceId: testVoiceId,
          staffId: testStaffId,
          position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
          rhythm: quarter,
          notes: [
            {
              id: 'note-root' as NoteAtomId,
              pitch: { step: 'C', octave: 4 },
              source: { musicXmlElementId: 'note-root-source' },
            },
            {
              id: 'note-member' as NoteAtomId,
              pitch: { step: 'E', octave: 4 },
              source: { musicXmlElementId: 'note-member-source' },
            },
          ],
          source: { musicXmlElementIds: ['note-root-source', 'note-member-source'] },
        }),
      ],
    });

    expect(getConnectionTarget(document, { kind: 'event', eventId: 'event-1' as EventId })).toEqual({
      sourceIds: ['note-root-source', 'note-member-source'],
    });
  });

  it('builds a connection target from a note-atom domain anchor when a render source id exists', () => {
    const document = createTestScoreDocument();
    const anchors: RenderAnchor[] = [
      {
        renderId: 'verovio-member',
        sourceId: 'note-member-source',
        domain: noteAtomAnchor,
      },
    ];

    expect(getConnectionTarget(document, noteAtomAnchor, anchors)).toEqual({
      sourceIds: ['note-member-source'],
    });
  });

  it('does not build a connection target for explicit rests', () => {
    const document = createTestScoreDocument({
      events: [
        createExplicitRestEvent({
          id: 'rest-1' as EventId,
          voiceId: testVoiceId,
          staffId: testStaffId,
          position: { measureId: testMeasureId, offset: { numerator: 0, denominator: 1 } },
          rhythm: quarter,
          source: { musicXmlElementId: 'rest-source' },
        }),
      ],
    });

    expect(getConnectionTarget(document, { kind: 'event', eventId: 'rest-1' as EventId })).toBeNull();
  });
});
