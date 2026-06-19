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
});
