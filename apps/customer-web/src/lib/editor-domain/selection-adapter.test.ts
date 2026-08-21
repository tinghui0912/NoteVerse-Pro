import { describe, expect, it } from 'vitest';

import type {
  DerivedRest,
  EventId,
  MeasureId,
  NoteAtomId,
  NotationId,
  RhythmicValue,
  StaffId,
  TimelineGap,
  VoiceId,
} from './model';
import {
  domainAnchorToEditorSelection,
  editorSelectionToDomainAnchor,
  insertionAnchorToDomainAnchor,
  isCommandInsertionSelection,
  isInspectorSelection,
} from './selection-adapter';
import type { DomainAnchor } from './render-anchors';

const measureId = 'measure-1' as MeasureId;
const staffId = 'staff-1' as StaffId;
const voiceId = 'voice-1' as VoiceId;
const quarter: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter', dots: 0 },
};
const gap: TimelineGap = {
  kind: 'timelineGap',
  voiceId,
  staffId,
  start: {
    measureId,
    offset: { numerator: 1, denominator: 1 },
  },
  duration: { numerator: 1, denominator: 1 },
};
const derivedRest: DerivedRest = {
  kind: 'derivedRest',
  voiceId,
  staffId,
  position: {
    measureId,
    offset: { numerator: 1, denominator: 1 },
  },
  rhythm: quarter,
  sourceGap: gap,
};

describe('editor domain selection adapter', () => {
  it('converts event and note atom anchors to editor selections', () => {
    expect(domainAnchorToEditorSelection({
      kind: 'event',
      eventId: 'event-1' as EventId,
    })).toEqual({
      kind: 'event',
      eventId: 'event-1',
    });

    expect(domainAnchorToEditorSelection({
      kind: 'noteAtom',
      eventId: 'event-1' as EventId,
      noteAtomId: 'note-1' as NoteAtomId,
    })).toEqual({
      kind: 'noteAtom',
      eventId: 'event-1',
      noteAtomId: 'note-1',
    });
  });

  it('converts gap and derived rest anchors to explicit selection kinds', () => {
    expect(domainAnchorToEditorSelection({
      kind: 'timelineGap',
      gap,
    })).toEqual({
      kind: 'timelineGap',
      gap,
    });

    expect(domainAnchorToEditorSelection({
      kind: 'derivedRest',
      rest: derivedRest,
    })).toEqual({
      kind: 'derivedRest',
      rest: derivedRest,
    });
  });

  it('does not turn measure or staff anchors into fake editor selections', () => {
    expect(domainAnchorToEditorSelection({
      kind: 'measure',
      measureId,
    })).toBeNull();
    expect(domainAnchorToEditorSelection({
      kind: 'staff',
      measureId,
      staffId,
    })).toBeNull();
  });

  it('round-trips selectable anchors through editor selection', () => {
    const anchors: DomainAnchor[] = [
      { kind: 'event', eventId: 'event-1' as EventId },
      { kind: 'noteAtom', eventId: 'event-1' as EventId, noteAtomId: 'note-1' as NoteAtomId },
      { kind: 'timelineGap', gap },
      { kind: 'derivedRest', rest: derivedRest },
      {
        kind: 'caret',
        position: { measureId, offset: { numerator: 3, denominator: 2 } },
        staffId,
        voiceId,
      },
      { kind: 'notation', notationId: 'notation-1' as NotationId },
    ];

    anchors.forEach((anchor) => {
      const selection = domainAnchorToEditorSelection(anchor);
      expect(selection).not.toBeNull();
      expect(editorSelectionToDomainAnchor(selection!)).toEqual(anchor);
    });
  });

  it('converts insertion anchors to selectable domain anchors without losing caret offset', () => {
    expect(insertionAnchorToDomainAnchor({
      kind: 'caret',
      caret: {
        kind: 'caret',
        staffId,
        voiceId,
        position: { measureId, offset: { numerator: 3, denominator: 2 } },
      },
    })).toEqual({
      kind: 'caret',
      position: { measureId, offset: { numerator: 3, denominator: 2 } },
      staffId,
      voiceId,
    });

    expect(insertionAnchorToDomainAnchor({
      kind: 'timelineGap',
      voiceId,
      staffId,
      position: { measureId, offset: { numerator: 3, denominator: 2 } },
      gapStart: gap.start,
      gapDuration: gap.duration,
    })).toEqual({
      kind: 'timelineGap',
      gap,
    });
  });

  it('classifies inspector and insertion selections without using legacy parsed entities', () => {
    expect(isInspectorSelection({ kind: 'event', eventId: 'event-1' as EventId })).toBe(true);
    expect(isInspectorSelection({
      kind: 'caret',
      position: { measureId, offset: { numerator: 0, denominator: 1 } },
      voiceId,
      staffId,
    })).toBe(false);

    expect(isCommandInsertionSelection({
      kind: 'caret',
      position: { measureId, offset: { numerator: 0, denominator: 1 } },
      voiceId,
      staffId,
    })).toBe(true);
    expect(isCommandInsertionSelection({ kind: 'event', eventId: 'event-1' as EventId })).toBe(false);
  });
});
