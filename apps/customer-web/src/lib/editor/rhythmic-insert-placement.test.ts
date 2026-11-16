// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorDocument, note } from '../../../tests/fixtures/editor';
import { documentTimelineGaps } from '@/lib/editor-domain';
import { resolveRhythmicInsertPlacement } from './rhythmic-insert-placement';
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

it('places a rhythmic caret from domain positions and actual SVG anchors', () => {
  const document = editorDocument(note());
  const { measure, staff } = createMeasure();
  appendNote(staff, 'n1', 100);
  const voice = document.voices[0];
  const result = resolveRhythmicInsertPlacement({
    domainDocument: document,
    timelineGaps: documentTimelineGaps(document),
    measureElement: measure,
    measureIndex: 0,
    target: { staveIndex: 0, voiceId: voice.id },
    clientX: 250,
    inputDuration: {
      kind: 'inputDuration',
      rhythm: {
        timelineDuration: { numerator: 2, denominator: 1 },
        notation: { base: 'half', dots: 0 },
      },
    },
    visibleTrackIdSet: new Set([voice.id]),
  });
  expect(result).not.toBeNull();
  expect(result!.position.measureId).toBe(document.measures[0].id);
  expect(
    result!.position.offset.numerator / result!.position.offset.denominator,
  ).toBeLessThanOrEqual(2);
});
it('disables rhythmic insertion when effective meter is unknown', () => {
  const doc = editorDocument();
  doc.measures[0].attributes = {};
  const { measure } = createMeasure();
  expect(
    resolveRhythmicInsertPlacement({
      domainDocument: doc,
      timelineGaps: [],
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, voiceId: doc.voices[0].id },
      clientX: 200,
      visibleTrackIdSet: new Set(),
    }),
  ).toBeNull();
});
it('supports an unpersisted input voice using visible musical anchors', () => {
  const doc = editorDocument();
  const input = { ...doc.voices[0], number: 2, id: 'input-target' as never };
  const { measure, staff } = createMeasure();
  appendNote(staff, 'n1', 100);
  expect(
    resolveRhythmicInsertPlacement({
      domainDocument: doc,
      inputVoices: [input],
      timelineGaps: [],
      measureElement: measure,
      measureIndex: 0,
      target: { staveIndex: 0, voiceId: input.id },
      clientX: 200,
      visibleTrackIdSet: new Set([doc.voices[0].id]),
    })?.caret.voiceId,
  ).toBe(input.id);
});
