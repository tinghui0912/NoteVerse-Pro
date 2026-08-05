// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseNotatedDuration } from './notated-duration';

function parseNote(content: string) {
  return new DOMParser().parseFromString(`<note>${content}</note>`, 'application/xml').documentElement;
}

describe('parseNotatedDuration fallback', () => {
  it('uses explicit type as the authoritative beam level', () => {
    const value = parseNotatedDuration(parseNote('<duration>7</duration><type>16th</type>'), 8);
    expect(value.beamLevel).toBe(2);
  });

  it('infers only exact binary durations when type is absent', () => {
    expect(parseNotatedDuration(parseNote('<duration>4</duration>'), 8).beamLevel).toBe(1);
    expect(parseNotatedDuration(parseNote('<duration>2</duration>'), 8).beamLevel).toBe(2);
    expect(parseNotatedDuration(parseNote('<duration>3</duration>'), 8).beamLevel).toBe(0);
  });

  it('accounts for explicit dots during conservative inference', () => {
    expect(parseNotatedDuration(parseNote('<duration>6</duration><dot/>'), 8).beamLevel).toBe(1);
  });
});
