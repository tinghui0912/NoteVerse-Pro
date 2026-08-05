// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { recalculateBackups } from '@/lib/musicxml/backup';
import { parseXml } from '@/lib/musicxml/core';
import { normalizeMeasureVoices } from '@/lib/musicxml/flatten';

const readFixture = (name: string) =>
  readFileSync(resolve('tests', 'fixtures', 'musicxml', name), 'utf8');

describe('MusicXML transformations', () => {
  it('recalculates backup duration from the preceding timeline', () => {
    const document = parseXml(readFixture('chords-voices.musicxml'));
    const measure = document.querySelector('measure');
    const backup = measure?.querySelector('backup duration');
    expect(measure).not.toBeNull();
    expect(backup).not.toBeNull();

    if (!measure || !backup) return;
    backup.textContent = '99';
    recalculateBackups(measure);

    expect(measure.querySelector('backup duration')?.textContent).toBe('4');
  });

  it('normalizes every staff to voice one while preserving chord and staff semantics', () => {
    const flattened = normalizeMeasureVoices(readFixture('chords-voices.musicxml'));
    const document = parseXml(flattened);
    const notes = Array.from(document.querySelectorAll('note'));

    expect(document.querySelector('parsererror')).toBeNull();
    expect(notes).toHaveLength(3);
    expect(notes.map((note) => note.querySelector('voice')?.textContent)).toEqual([
      '1',
      '1',
      '1',
    ]);
    expect(document.querySelectorAll('note chord')).toHaveLength(1);
    expect(document.querySelector('backup duration')?.textContent).toBe('4');
  });
});
