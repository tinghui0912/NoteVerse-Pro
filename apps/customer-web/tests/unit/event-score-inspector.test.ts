import { describe, expect, it } from 'vitest';
import { parseTimeSignatureParts } from '@/components/editor/event-score-inspector';

describe('event score inspector helpers', () => {
  it('parses valid time signatures', () => {
    expect(parseTimeSignatureParts('6/8')).toEqual({ beats: 6, beatType: 8 });
  });

  it('falls back to common time for invalid values', () => {
    expect(parseTimeSignatureParts('0/0')).toEqual({ beats: 4, beatType: 4 });
    expect(parseTimeSignatureParts(undefined)).toEqual({ beats: 4, beatType: 4 });
  });
});
