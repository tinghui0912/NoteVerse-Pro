// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import {
  findScoreEntityById,
  getVerovioElementIdFromTarget,
  getVerovioMeasureIndexFromTarget,
  getVerovioStaffElementForIndex,
} from './verovio-entity-map';

describe('verovio entity mapping', () => {
  it('extracts the nearest Verovio element id from a nested SVG target', () => {
    const group = document.createElement('g');
    group.setAttribute('data-id', 'note-1');
    group.setAttribute('data-class', 'note');
    const path = document.createElement('path');
    group.appendChild(path);

    expect(getVerovioElementIdFromTarget(path)).toBe('note-1');
  });

  it('prefers the nearest Verovio event id over outer page/system ids', () => {
    const page = document.createElement('svg');
    page.setAttribute('id', 'page-random');
    const system = document.createElement('g');
    system.setAttribute('data-id', 'system-random');
    system.setAttribute('data-class', 'system');
    const note = document.createElement('g');
    note.setAttribute('data-id', 'note-stable-1');
    note.setAttribute('data-class', 'note');
    const path = document.createElement('path');

    note.appendChild(path);
    system.appendChild(note);
    page.appendChild(system);

    expect(getVerovioElementIdFromTarget(path)).toBe('note-stable-1');
  });

  it('maps a Verovio measure hit back to its rendered measure index', () => {
    const container = document.createElement('div');
    const firstMeasure = document.createElement('g');
    firstMeasure.setAttribute('data-class', 'measure');
    const secondMeasure = document.createElement('g');
    secondMeasure.setAttribute('data-class', 'measure');
    const target = document.createElement('rect');

    secondMeasure.appendChild(target);
    container.append(firstMeasure, secondMeasure);

    expect(getVerovioMeasureIndexFromTarget(container, target)).toBe(1);
  });

  it('finds a staff by rendered order within the current measure', () => {
    const measure = document.createElement('g');
    measure.setAttribute('data-class', 'measure');
    const firstStaff = document.createElement('g');
    firstStaff.setAttribute('data-class', 'staff');
    const secondStaff = document.createElement('g');
    secondStaff.setAttribute('data-class', 'staff');
    const nestedMeasure = document.createElement('g');
    nestedMeasure.setAttribute('data-class', 'measure');
    const nestedStaff = document.createElement('g');
    nestedStaff.setAttribute('data-class', 'staff');

    nestedMeasure.appendChild(nestedStaff);
    measure.append(firstStaff, secondStaff, nestedMeasure);

    expect(getVerovioStaffElementForIndex(measure, 1)).toBe(secondStaff);
  });

  it('maps a stable element id back to a score entity and location', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                {
                  name: 'voiceLabel 1',
                  notes: [
                    {
                      type: 'note',
                      pitch: 'C4',
                      duration: 'durationQuarter',
                      meta: {
                        id: 'note-1',
                        measureIndex: 0,
                        staveIndex: 0,
                        xmlVoice: 1,
                        entityIndex: 0,
                        startTick: 0,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(findScoreEntityById(scoreData, 'note-1')).toMatchObject({
      entity: { type: 'note', pitch: 'C4' },
      location: {
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 0,
      },
    });
  });

  it('maps chord member source ids back to the parent chord entity', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                {
                  name: 'voiceLabel 1',
                  notes: [
                    {
                      type: 'chord',
                      pitches: ['C4', 'E4'],
                      duration: 'durationQuarter',
                      meta: {
                        id: 'chord-main',
                        sourceIds: ['chord-main', 'chord-member-2'],
                        measureIndex: 0,
                        staveIndex: 0,
                        xmlVoice: 1,
                        entityIndex: 0,
                        startTick: 0,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(findScoreEntityById(scoreData, 'chord-member-2')).toMatchObject({
      entity: { type: 'chord', pitches: ['C4', 'E4'] },
      location: {
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 0,
      },
    });
  });
});
