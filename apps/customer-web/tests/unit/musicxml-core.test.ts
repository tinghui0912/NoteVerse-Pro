// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getDivisions,
  getDurationTypeName,
  getDurationValue,
  getEntityGroupsFromMeasure,
  parsePitchString,
  parseXml,
  serializeXml,
} from '@/lib/musicxml/core';
import { MusicXMLParser } from '@/lib/musicxml/parser';

const readFixture = (name: string) =>
  readFileSync(resolve('tests', 'fixtures', 'musicxml', name), 'utf8');

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

  it('omits forward groups by default but can include them for timing adapters', () => {
    const document = parseXml(`<?xml version="1.0"?>
      <score-partwise>
        <part id="P1">
          <measure number="1">
            <forward id="gap-1">
              <duration>4</duration>
              <voice>1</voice>
              <staff>1</staff>
            </forward>
            <note id="note-1">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>4</duration>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`);
    const measure = document.querySelector('measure');
    expect(measure).not.toBeNull();
    if (!measure) return;

    expect(getEntityGroupsFromMeasure(measure, 1, 1).map((group) => group.type)).toEqual(['note']);
    expect(
      getEntityGroupsFromMeasure(measure, 1, 1, { includeForwardGroups: true }).map((group) => group.type),
    ).toEqual(['forward', 'note']);
  });

  it('reads standard tie and slur MusicXML tags that Verovio and the parser can read', () => {
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
            <note id="n1">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="start"/>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
              <notations>
                <tied type="start"/>
                <slur type="start" number="1"/>
              </notations>
            </note>
            <note id="n2">
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="stop"/>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
              <notations>
                <tied type="stop"/>
                <slur type="stop" number="1"/>
              </notations>
            </note>
          </measure>
        </part>
      </score-partwise>`;

    expect(xml).toContain('<tie type="start"');
    expect(xml).toContain('<slur type="start"');
    expect(xml).not.toContain('common.tie');
    expect(xml).not.toContain('common.slur');
    expect(xml).not.toContain('orientation=');
    expect(xml).not.toContain('placement=');

    const score = new MusicXMLParser(xml).parse();
    const firstConnections = score.connections?.noteConnections.get('n1');
    expect(firstConnections?.ties).toHaveLength(1);
    expect(firstConnections?.slurs).toHaveLength(1);
  });

  it('can read ties and slurs targeting a specific chord member source id', () => {
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
            <note id="n1">
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="start"/>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
              <notations>
                <tied type="start"/>
                <slur type="start" number="1"/>
              </notations>
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
              <tie type="stop"/>
              <voice>1</voice>
              <type>quarter</type>
              <staff>1</staff>
              <notations>
                <tied type="stop"/>
                <slur type="stop" number="1"/>
              </notations>
            </note>
          </measure>
        </part>
      </score-partwise>`;

    const score = new MusicXMLParser(xml).parse();
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
