import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { decodePracticeScoreArtifact } from './generated/score-artifact';
const conformance = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      '../../contracts/practice/score/artifact-transport-cases.json',
    ),
    'utf8',
  ),
);
type Edit = { path: (string | number)[]; value?: unknown; remove?: boolean };
function apply(edits: Edit[]): unknown {
  const value = structuredClone(conformance.base);
  for (const edit of edits) {
    let owner = value;
    for (const key of edit.path.slice(0, -1)) owner = owner[key];
    const key = edit.path.at(-1)!;
    if (edit.remove) delete owner[key];
    else owner[key] = edit.value;
  }
  return value;
}
it.each(conformance.cases as { name: string; valid: boolean; edits: Edit[] }[])(
  '$name structural agreement',
  (test) => {
    const value = apply(test.edits),
      before = structuredClone(value);
    if (test.valid) expect(decodePracticeScoreArtifact(value)).toBe(value);
    else expect(() => decodePracticeScoreArtifact(value)).toThrow();
    expect(value).toEqual(before);
    expect(Object.isFrozen(value)).toBe(false);
  },
);
it.each([NaN, Infinity, -Infinity])(
  'rejects runtime nonfinite BPM and ticks %s',
  (value) => {
    for (const path of [
      ['scoreTempoSegments', 0, 'bpm'],
      ['events', 0, 'onsetTick'],
    ] as Edit['path'][]) {
      expect(() =>
        decodePracticeScoreArtifact(apply([{ path, value }])),
      ).toThrow();
    }
  },
);
it('rejects a sparse transport array', () => {
  const value = structuredClone(conformance.base);
  delete value.notes[0];
  expect(() => decodePracticeScoreArtifact(value)).toThrow();
});
