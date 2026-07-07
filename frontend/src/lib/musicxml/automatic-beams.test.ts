// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { rebuildAutomaticBeamsForMeasure } from './automatic-beams';

function note(duration: number, type: string, extra = '') {
  return `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff>${extra}</note>`;
}

function documentFor(beats: string, beatType: number, notes: string, divisions = 4) {
  const xml = `<score-partwise><part-list/><part><measure number="1"><attributes><divisions>${divisions}</divisions><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function beams(xmlDoc: XMLDocument) {
  return Array.from(xmlDoc.querySelectorAll('note')).map((item) => (
    Array.from(item.querySelectorAll(':scope > beam')).map((beam) => (
      `${beam.getAttribute('number')}:${beam.textContent}`
    ))
  ));
}

describe('Automatic Beam v2 foundation', () => {
  it('groups eighth notes by quarter-note beats in 4/4', () => {
    const xmlDoc = documentFor('4', 4, Array.from({ length: 4 }, () => note(2, 'eighth')).join(''));
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc)).toEqual([
      ['1:begin'], ['1:end'], ['1:begin'], ['1:end'],
    ]);
  });

  it('writes independent secondary beams and hooks for mixed note types', () => {
    const xmlDoc = documentFor('4', 4, note(1, '16th') + note(3, 'eighth') + note(3, 'eighth') + note(1, '16th'));
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc)[0]).toEqual(['1:begin', '2:forward hook']);
    expect(beams(xmlDoc)[1]).toEqual(['1:end']);
    expect(beams(xmlDoc)[2]).toEqual(['1:begin']);
    expect(beams(xmlDoc)[3]).toEqual(['1:end', '2:backward hook']);
  });

  it('groups compound 6/8 as two dotted-quarter beats', () => {
    const xmlDoc = documentFor('6', 8, Array.from({ length: 6 }, () => note(2, 'eighth')).join(''));
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc).map((items) => items[0])).toEqual([
      '1:begin', '1:continue', '1:end', '1:begin', '1:continue', '1:end',
    ]);
  });

  it('honors explicit additive 3+2/8 grouping', () => {
    const xmlDoc = documentFor('3+2', 8, Array.from({ length: 5 }, () => note(2, 'eighth')).join(''));
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc).map((items) => items[0])).toEqual([
      '1:begin', '1:continue', '1:end', '1:begin', '1:end',
    ]);
  });

  it('honors explicit additive 2+2+3/8 grouping', () => {
    const xmlDoc = documentFor('2+2+3', 8, Array.from({ length: 7 }, () => note(2, 'eighth')).join(''));
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc).map((items) => items[0])).toEqual([
      '1:begin', '1:end', '1:begin', '1:end', '1:begin', '1:continue', '1:end',
    ]);
  });

  it('writes all three beam levels for 32nd notes', () => {
    const xmlDoc = documentFor('4', 4, note(1, '32nd') + note(1, '32nd'), 8);
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc)).toEqual([
      ['1:begin', '2:begin', '3:begin'],
      ['1:end', '2:end', '3:end'],
    ]);
  });

  it('preserves unsupported nested tuplet beam content', () => {
    const tuplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">begin</beam><notations><tuplet number="1" type="start"/><tuplet number="2" type="start"/></notations>';
    const xmlDoc = documentFor('4', 4, note(1, 'eighth', tuplet));
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc)).toEqual([['1:begin']]);
  });

  it('automatically beams a regular eighth-note triplet', () => {
    const tuplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
    const xmlDoc = documentFor('4', 4, Array.from({ length: 3 }, () => note(4, 'eighth', tuplet)).join(''), 12);
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc).map((items) => items[0])).toEqual(['1:begin', '1:continue', '1:end']);
  });

  it('aligns an implicit pickup to the end of the full measure grid', () => {
    const xmlDoc = documentFor('4', 4, Array.from({ length: 3 }, () => note(2, 'eighth')).join(''));
    xmlDoc.querySelector('measure')!.setAttribute('implicit', 'yes');
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc)).toEqual([[], ['1:begin'], ['1:end']]);
  });

  it('preserves an existing cross-staff beam in the same voice', () => {
    const first = note(2, 'eighth', '<beam number="1">begin</beam>');
    const second = note(2, 'eighth', '<beam number="1">end</beam>').replace('<staff>1</staff>', '<staff>2</staff>');
    const xmlDoc = documentFor('4', 4, first + second);
    rebuildAutomaticBeamsForMeasure(xmlDoc, xmlDoc.querySelector('measure')!);
    expect(beams(xmlDoc)).toEqual([['1:begin'], ['1:end']]);
  });
});
