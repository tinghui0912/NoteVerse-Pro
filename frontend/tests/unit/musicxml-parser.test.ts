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

  it('preserves XML note ids for stable SVG/entity mapping', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="4.0" xmlns:xml="http://www.w3.org/XML/1998/namespace">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes>
            <note xml:id="note-stable-1">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;

    const score = new MusicXMLParser(xml).parse();
    const note = score.measures[0].staves[0].voices[0].notes[0];

    expect(note.meta?.id).toBe('note-stable-1');
  });

  it('preserves chord member XML ids as source ids on the parent chord', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="4.0" xmlns:xml="http://www.w3.org/XML/1998/namespace">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes>
            <note xml:id="chord-main">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
            <note xml:id="chord-member-2">
              <chord/>
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;

    const score = new MusicXMLParser(xml).parse();
    const chord = score.measures[0].staves[0].voices[0].notes[0];

    expect(chord.type).toBe('chord');
    expect(chord.meta?.id).toBe('chord-main');
    expect(chord.meta?.sourceIds).toEqual(['chord-main', 'chord-member-2']);
  });

  it('normalizes circled fingering glyphs to editable numeric values', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="4.0" xmlns:xml="http://www.w3.org/XML/1998/namespace">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes>
            <note xml:id="note-with-fingering">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
              <notations><technical><fingering>⑤</fingering></technical></notations>
            </note>
          </measure>
        </part>
      </score-partwise>`;

    const score = new MusicXMLParser(xml).parse();
    const note = score.measures[0].staves[0].voices[0].notes[0];

    expect(note.type).toBe('note');
    if (note.type !== 'note') return;
    expect(note.fingering).toBe('5');
  });
});
