// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getDivisions,
  getDurationTypeName,
  getDurationValue,
  parsePitchString,
  parseXml,
  serializeXml,
} from '@/lib/musicxml/core';
import {
  addSlurElementsToXML,
  addTieElementsToXML,
  getSlurConnectionDirectionFromXML,
  getTieConnectionDirectionFromXML,
  setSlurConnectionDirectionInXML,
  setTieConnectionDirectionInXML,
} from '@/lib/musicxml/connections';
import { MusicXMLParser } from '@/lib/musicxml/parser';

const readFixture = (name: string) =>
  readFileSync(resolve('tests', 'fixtures', 'musicxml', name), 'utf8');

function findNoteById(document: XMLDocument, id: string) {
  return Array.from(document.querySelectorAll('note')).find((note) => (
    note.getAttribute('id') === id
  )) ?? null;
}

describe('MusicXML core utilities', () => {
  it('parses and serializes a valid score without losing its structure', () => {
    const document = parseXml(readFixture('single-page.musicxml'));
    const serialized = serializeXml(document);

    expect(document.querySelector('parsererror')).toBeNull();
    expect(getDivisions(document)).toBe(4);
    expect(serialized).toContain('<score-partwise version="4.0">');
    expect(serialized).toContain('<step>C</step>');
    expect(parseXml(serialized).querySelector('parsererror')).toBeNull();
  });

  it('exposes parser errors for malformed input', () => {
    const document = parseXml(readFixture('malformed.musicxml'));

    expect(document.querySelector('parsererror')).not.toBeNull();
  });

  it('normalizes pitch and duration inputs', () => {
    expect(parsePitchString('C##5')).toEqual({ step: 'C', alter: 2, octave: 5 });
    expect(parsePitchString('ebb3')).toEqual({ step: 'E', alter: -2, octave: 3 });
    expect(parsePitchString('invalid')).toEqual({ step: 'C', alter: 0, octave: 4 });
    expect(getDurationValue('durationEighth', 4)).toBe(2);
    expect(getDurationValue('unknown', 4)).toBe(4);
    expect(getDurationTypeName('duration16th')).toBe('16th');
    expect(getDurationTypeName('unknown')).toBe('quarter');
  });

  it('writes standard tie and slur MusicXML tags that Verovio and the parser can read', () => {
    const document = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
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
            <note id="n1">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
            <note id="n2">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`);
    const first = { id: 'n1', measureIndex: 0, staveIndex: 0, voiceIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 };
    const second = { id: 'n2', measureIndex: 0, staveIndex: 0, voiceIndex: 0, xmlVoice: 1, entityIndex: 1, startTick: 1 };

    addTieElementsToXML(document, first, second);
    addSlurElementsToXML(document, first, second);

    const serialized = serializeXml(document);
    expect(serialized).toContain('<tie type="start"');
    expect(serialized).toContain('<slur type="start"');
    expect(serialized).not.toContain('common.tie');
    expect(serialized).not.toContain('common.slur');
    expect(serialized).not.toContain('orientation=');
    expect(serialized).not.toContain('placement=');

    const score = new MusicXMLParser(serialized).parse();
    const firstConnections = score.connections?.noteConnections.get('n1');
    expect(firstConnections?.ties).toHaveLength(1);
    expect(firstConnections?.slurs).toHaveLength(1);
  });

  it('updates tie and slur direction hints without replacing automatic layout by default', () => {
    const document = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
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
            <note id="n1">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
            <note id="n2">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`);
    const first = { id: 'n1', measureIndex: 0, staveIndex: 0, voiceIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 };
    const second = { id: 'n2', measureIndex: 0, staveIndex: 0, voiceIndex: 0, xmlVoice: 1, entityIndex: 1, startTick: 1 };

    addTieElementsToXML(document, first, second);
    addSlurElementsToXML(document, first, second);
    expect(getTieConnectionDirectionFromXML(document, first, second)).toBe('auto');
    expect(getSlurConnectionDirectionFromXML(document, first, second)).toBe('auto');

    setTieConnectionDirectionInXML(document, first, second, 'above');
    setSlurConnectionDirectionInXML(document, first, second, 'below');
    expect(getTieConnectionDirectionFromXML(document, first, second)).toBe('above');
    expect(getSlurConnectionDirectionFromXML(document, first, second)).toBe('below');
    expect(serializeXml(document)).toContain('orientation="over"');
    expect(serializeXml(document)).toContain('placement="below"');

    setTieConnectionDirectionInXML(document, first, second, 'auto');
    setSlurConnectionDirectionInXML(document, first, second, 'auto');
    const serialized = serializeXml(document);
    expect(serialized).not.toContain('orientation=');
    expect(serialized).not.toContain('placement=');
  });

  it('can write ties and slurs to a specific chord member source id', () => {
    const document = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
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
            <note id="n1">
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
            <note id="chord-c">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
            <note id="chord-e">
              <chord/>
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`);
    const first = { id: 'n1', measureIndex: 0, staveIndex: 0, voiceIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 };
    const chord = { id: 'chord-c', measureIndex: 0, staveIndex: 0, voiceIndex: 0, xmlVoice: 1, entityIndex: 1, startTick: 1 };

    addTieElementsToXML(document, first, chord, {
      startSourceId: 'n1',
      endSourceId: 'chord-e',
    });
    addSlurElementsToXML(document, first, chord, {
      startSourceId: 'n1',
      endSourceId: 'chord-e',
    });

    const chordRoot = findNoteById(document, 'chord-c');
    const chordMember = findNoteById(document, 'chord-e');
    expect(chordRoot?.querySelector('tie')).toBeNull();
    expect(chordRoot?.querySelector('notations > slur')).toBeNull();
    expect(chordMember?.querySelector('tie[type="stop"]')).not.toBeNull();
    expect(chordMember?.querySelector('notations > slur[type="stop"]')).not.toBeNull();

    const score = new MusicXMLParser(serializeXml(document)).parse();
    const firstConnections = score.connections?.noteConnections.get('n1');
    expect(firstConnections?.ties[0]).toMatchObject({
      partnerId: 'chord-c',
      sourceId: 'n1',
      partnerSourceId: 'chord-e',
    });
    expect(firstConnections?.slurs[0]).toMatchObject({
      partnerIds: ['n1', 'chord-c'],
      sourceId: 'n1',
      partnerSourceIds: ['n1', 'chord-e'],
    });
  });
});
