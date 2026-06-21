// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findNoteElementsByMeta,
  parseXml,
} from '@/lib/musicxml';
import { orderConnectionEndpoints } from '@/lib/musicxml/connection-targets';
import { extractPitch, isDottedDuration, parseDuration } from '@/lib/musicxml/parser-values';
import type { EntityMeta } from '@/types/score-types';

describe('MusicXML parser value boundary', () => {
  it('parses pitch, duration, and dotted ratios independently of document traversal', () => {
    const document = parseXml(`
      <score-partwise><part><measure><note>
        <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
        <duration>3</duration><voice>1</voice><staff>1</staff>
      </note></measure></part></score-partwise>
    `);
    const note = document.querySelector('note');
    expect(note).not.toBeNull();
    if (!note) return;
    expect(extractPitch(note)).toBe('F#5');
    expect(parseDuration(note, 4)).toBe('durationEighth');
    expect(isDottedDuration(3, 4)).toBe(true);
  });
});

describe('MusicXML connection target boundary', () => {
  it('resolves an entity and all of its chord note elements', () => {
    const xml = readFileSync(resolve('tests', 'fixtures', 'musicxml', 'chords-voices.musicxml'), 'utf8');
    const document = parseXml(xml);
    expect(findNoteElementsByMeta(document, 0, 0, 1, 0)).toHaveLength(2);
    expect(findNoteElementsByMeta(document, 0, 1, 5, 0)).toHaveLength(1);
  });

  it('orders connection endpoints by measure and tick', () => {
    const later = { measureIndex: 1, startTick: 0 } as EntityMeta;
    const earlier = { measureIndex: 0, startTick: 8 } as EntityMeta;
    expect(orderConnectionEndpoints(later, earlier)).toEqual([earlier, later]);
  });
});
