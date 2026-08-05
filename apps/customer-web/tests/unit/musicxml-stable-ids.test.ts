// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ensureStableMusicXmlIdsString, MusicXMLParser, parseXml } from '@/lib/musicxml';

const baseScore = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
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
      ${body}
    </measure>
  </part>
</score-partwise>`;

const note = (attributes = '') => `<note ${attributes}>
  <pitch><step>C</step><octave>4</octave></pitch>
  <duration>1</duration>
  <voice>1</voice>
  <type>quarter</type>
  <staff>1</staff>
</note>`;

describe('stable MusicXML ids', () => {
  it('preserves legal unique ids', () => {
    const normalized = ensureStableMusicXmlIdsString(baseScore(note('id="source-note-1"')));
    const parsedNote = new MusicXMLParser(normalized).parse().measures[0]?.staves[0]?.voices[0]?.notes[0];

    expect(normalized).toContain('id="source-note-1"');
    expect(parseXml(normalized).querySelector('note')?.hasAttribute('id')).toBe(true);
    expect(parsedNote?.meta?.id).toBe('source-note-1');
  });

  it('adds app-owned ids to editable elements without source ids', () => {
    const normalized = ensureStableMusicXmlIdsString(baseScore(`${note()}<forward><duration>1</duration><voice>1</voice><staff>1</staff></forward>`));
    const doc = parseXml(normalized);
    const elements = Array.from(doc.querySelectorAll('note, forward'));
    const ids = elements.map((element) => element.getAttribute('id'));

    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id?.startsWith('nv-'))).toBe(true);
    expect(elements.every((element) => element.hasAttribute('id'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renames duplicate ids instead of keeping ambiguous SVG anchors', () => {
    const normalized = ensureStableMusicXmlIdsString(baseScore(`${note('id="same-id"')}${note('id="same-id"')}`));
    const elements = Array.from(parseXml(normalized).querySelectorAll('note'));
    const ids = elements.map((element) => element.getAttribute('id'));

    expect(ids).toEqual(['same-id', 'same-id-2']);
    expect(elements[0].hasAttribute('id')).toBe(true);
    expect(elements[1].getAttribute('id')).toBe('same-id-2');
  });

  it('normalizes invalid ids to legal XML id values', () => {
    const normalized = ensureStableMusicXmlIdsString(baseScore(note('id="1 bad id"')));
    const noteEl = parseXml(normalized).querySelector('note');
    const id = noteEl?.getAttribute('id');

    expect(id).toBe('nv-1-bad-id');
    expect(noteEl?.hasAttribute('id')).toBe(true);
    expect(normalized).not.toContain('id="1 bad id"');
  });
});
