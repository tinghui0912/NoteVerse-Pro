// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorDocument, editorXml, note } from '../../../tests/fixtures/editor';
import { validateDataIntegrity } from './validator';
it('validates XML syntax and reports domain duration observations', () => {
  const document = editorDocument(note());
  const result = validateDataIntegrity(document, editorXml(note()), (key) => key);
  expect(result.success).toBe(true);
  expect(result.warnings).toMatchObject([
    {
      code: 'measure.duration_underfill',
      details: { expectedDuration: 4, actualDuration: 1, deltaDuration: -3 },
    },
  ]);
  expect(validateDataIntegrity(null, '<bad>', (key) => key).success).toBe(false);
});
it('validates malformed beam transport without constructing a second music model', () => {
  const result = validateDataIntegrity(
    null,
    editorXml(note().replace('</note>', '<beam number="2">begin</beam></note>')),
    (key) => key,
  );
  expect(result.warnings.map((issue) => issue.code)).toEqual([
    'beam.level_gap',
    'beam.unpaired_begin',
  ]);
});
