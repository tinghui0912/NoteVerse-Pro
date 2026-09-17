// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import type { MeasureId, PartId, ScoreDocument, ScoreDocumentId, StaffId, VoiceId } from '@/lib/editor-domain';
import { createInputDuration, createRhythmicGridResolution } from '@/lib/editor-domain';
import { resolveRhythmicInsertPlacement } from './rhythmic-insert-placement';

const partId = 'P1' as PartId;
const measureId = 'P1:measure-1' as MeasureId;
const staffId = 'P1:staff-1' as StaffId;
const voiceId = 'P1:voice-1' as VoiceId;

function setRect(element: Element, rect: Partial<DOMRect>) {
  const resolved = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)),
    height: rect.height ?? Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0)),
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => resolved;
}

function createMeasure() {
  const measure = document.createElement('g');
  measure.setAttribute('data-class', 'measure');
  setRect(measure, { left: 90, right: 430, width: 340, top: 0, bottom: 100, height: 100 });

  const staff = document.createElement('g');
  staff.setAttribute('data-class', 'staff');
  setRect(staff, { left: 100, right: 400, width: 300, top: 10, bottom: 80, height: 70 });
  measure.appendChild(staff);

  return { measure, staff };
}

function appendNote(parent: Element, id: string, left: number) {
  const note = document.createElement('g');
  note.setAttribute('data-class', 'note');
  note.setAttribute('data-id', id);
  const notehead = document.createElement('g');
  notehead.setAttribute('data-class', 'notehead');
  setRect(notehead, { left, right: left + 10, width: 10, top: 20, bottom: 30, height: 10 });
  note.appendChild(notehead);
  parent.appendChild(note);
}

const domainDocument: ScoreDocument = {
  schemaVersion: 1,
  id: 'score-document-1' as ScoreDocumentId,
  parts: [{ id: partId, name: 'Piano' }],
  staves: [{ id: staffId, partId, index: 0 }],
  voices: [{ id: voiceId, partId, homeStaffId: staffId, stemPolicy: 'automatic' as const }],
  measures: [{ id: measureId, number: 1 }],
  events: [],
  beamRelationships: [],
  tieRelationships: [],
  slurRelationships: [],
  notationControls: [],
};

describe('rhythmic insert placement adapter', () => {
  it('resolves empty-staff insertion from measure geometry and rhythmic grid', () => {
    const { measure } = createMeasure();

    const placement = resolveRhythmicInsertPlacement({
      domainDocument,
      timelineGaps: [],
      scoreData: { timeSignature: '4/4', measures: [{ number: 1, staves: [] }] },
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, xmlVoice: 1 },
      clientX: 250,
      divisions: 4,
      timeSignature: '4/4',
      visibleTrackIdSet: new Set(['voice-1']),
    });

    expect(placement).toMatchObject({
      left: 250,
      gridLines: [100, 175, 250, 325, 400],
      location: {
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        tick: 8,
      },
      caret: {
        kind: 'caret',
        staffId,
        voiceId,
        position: {
          measureId,
          offset: { numerator: 2, denominator: 1 },
        },
      },
      insertionAnchor: {
        kind: 'caret',
        caret: {
          position: {
            measureId,
            offset: { numerator: 2, denominator: 1 },
          },
        },
      },
    });
  });

  it('returns a timeline-gap insertion anchor when the snapped position is inside a domain gap', () => {
    const { measure } = createMeasure();
    const timelineGaps = [
      {
        kind: 'timelineGap' as const,
        voiceId,
        staffId,
        start: {
          measureId,
          offset: { numerator: 1, denominator: 1 },
        },
        duration: { numerator: 2, denominator: 1 },
      },
    ];

    const placement = resolveRhythmicInsertPlacement({
      domainDocument,
      timelineGaps,
      scoreData: { timeSignature: '4/4', measures: [{ number: 1, staves: [] }] },
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, xmlVoice: 1 },
      clientX: 250,
      divisions: 4,
      timeSignature: '4/4',
      visibleTrackIdSet: new Set(['voice-1']),
    });

    expect(placement).toMatchObject({
      insertionAnchor: {
        kind: 'timelineGap',
        voiceId,
        staffId,
        position: {
          measureId,
          offset: { numerator: 2, denominator: 1 },
        },
        gapStart: {
          measureId,
          offset: { numerator: 1, denominator: 1 },
        },
        gapDuration: { numerator: 2, denominator: 1 },
      },
    });
  });

  it('uses rendered rhythmic anchors to avoid a linear-only preview projection', () => {
    const { measure, staff } = createMeasure();
    appendNote(staff, 'note-1', 145);
    appendNote(staff, 'note-2', 295);

    const scoreData: ScoreData = {
      timeSignature: '4/4',
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                {
                  name: 'voiceLabel 1',
                  events: [
                    {
                      type: 'note',
                      pitch: 'C4',
                      duration: 'durationQuarter',
                      meta: {
                        id: 'note-1',
                        measureIndex: 0,
                        staveIndex: 0,
                        xmlVoice: 1,
                        entityIndex: 0,
                        startTick: 0,
                      },
                    },
                    {
                      type: 'note',
                      pitch: 'D4',
                      duration: 'durationQuarter',
                      meta: {
                        id: 'note-2',
                        measureIndex: 0,
                        staveIndex: 0,
                        xmlVoice: 1,
                        entityIndex: 1,
                        startTick: 8,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const placement = resolveRhythmicInsertPlacement({
      domainDocument,
      timelineGaps: [],
      scoreData,
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, xmlVoice: 1 },
      clientX: 200,
      divisions: 4,
      timeSignature: '4/4',
      visibleTrackIdSet: new Set(['voice-1']),
    });

    expect(placement).toMatchObject({
      left: 225,
      location: {
        tick: 4,
      },
      position: {
        offset: { numerator: 1, denominator: 1 },
      },
    });
  });

  it('uses the supplied add-mode grid resolution for empty-staff placement', () => {
    const { measure } = createMeasure();

    const placement = resolveRhythmicInsertPlacement({
      domainDocument,
      timelineGaps: [],
      scoreData: { timeSignature: '4/4', measures: [{ number: 1, staves: [] }] },
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, xmlVoice: 1 },
      clientX: 200,
      divisions: 4,
      grid: createRhythmicGridResolution({ numerator: 1, denominator: 2 }),
      timeSignature: '4/4',
      visibleTrackIdSet: new Set(['voice-1']),
    });

    expect(placement).toMatchObject({
      left: 212.5,
      location: {
        tick: 6,
      },
      position: {
        offset: { numerator: 3, denominator: 2 },
      },
    });
  });

  it('filters grid markers and snapping to starts that fit the selected input duration', () => {
    const { measure } = createMeasure();

    const placement = resolveRhythmicInsertPlacement({
      domainDocument,
      timelineGaps: [],
      scoreData: { timeSignature: '4/4', measures: [{ number: 1, staves: [] }] },
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, xmlVoice: 1 },
      clientX: 398,
      divisions: 4,
      inputDuration: createInputDuration({
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      }),
      timeSignature: '4/4',
      visibleTrackIdSet: new Set(['voice-1']),
    });

    expect(placement).toMatchObject({
      left: 325,
      gridLines: [100, 175, 250, 325],
      location: {
        tick: 12,
      },
      position: {
        offset: { numerator: 3, denominator: 1 },
      },
    });
  });

  it('returns null when the domain measure, staff, or voice cannot be resolved', () => {
    const { measure } = createMeasure();

    expect(resolveRhythmicInsertPlacement({
      domainDocument: null,
      timelineGaps: [],
      scoreData: null,
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, xmlVoice: 1 },
      clientX: 250,
      divisions: 4,
      timeSignature: '4/4',
      visibleTrackIdSet: new Set(['voice-1']),
    })).toBeNull();
  });
});
