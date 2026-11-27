// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorDocument, note } from '../../../tests/fixtures/editor';
import { buildDirtyMeasureStatuses } from './measure-status';
it('compares domain event end positions with effective measure duration', () => {
  const document = editorDocument(note());
  expect(buildDirtyMeasureStatuses(document)).toMatchObject([
    { kind: 'underfill', expectedDuration: 4, actualDuration: 1, deltaDuration: -3 },
  ]);
  expect(
    buildDirtyMeasureStatuses({
      ...document,
      measures: document.measures.map((measure) => ({ ...measure, attributes: {} })),
    }),
  ).toEqual([]);
});
