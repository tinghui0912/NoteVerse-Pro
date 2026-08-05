// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { extractTempoBpm } from '@/lib/musicxml';

describe('extractTempoBpm', () => {
  it('reads sound and metronome tempo values', () => {
    expect(
      extractTempoBpm('<score-partwise><sound tempo="132" /></score-partwise>')
    ).toBe(132);
    expect(
      extractTempoBpm(
        '<score-partwise><direction><metronome><per-minute>88</per-minute></metronome></direction></score-partwise>'
      )
    ).toBe(88);
  });

  it('uses the requested fallback for missing, invalid, or malformed tempo', () => {
    expect(extractTempoBpm('<score-partwise />', 96)).toBe(96);
    expect(extractTempoBpm('<score-partwise><sound tempo="0" /></score-partwise>', 96)).toBe(96);
    expect(extractTempoBpm('<score-partwise>', 96)).toBe(96);
  });
});
