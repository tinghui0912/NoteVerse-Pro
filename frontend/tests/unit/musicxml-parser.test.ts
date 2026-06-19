// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MusicXMLParser, parseXml } from '@/lib/musicxml';

const readFixture = (name: string) =>
  readFileSync(resolve('tests', 'fixtures', 'musicxml', name), 'utf8');

describe('MusicXML package surface', () => {
  it('parses a minimal score through the public package entry point', () => {
    const xml = readFixture('single-page.musicxml');
    const score = new MusicXMLParser(xml).parse();

    expect(parseXml(xml).querySelector('parsererror')).toBeNull();
    expect(score.measureCount).toBe(1);
    expect(score.noteCount).toBe(1);
    expect(score.timeSignature).toBe('4/4');
    expect(score.measures).toHaveLength(1);
  });

  it('rejects malformed XML at the parser boundary', () => {
    expect(() => new MusicXMLParser(readFixture('malformed.musicxml'))).toThrow(
      'Failed to parse XML string'
    );
  });
});
