// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  formatPitch,
  getLedgerLineOffsets,
  resolvePitchFromStaffPointer,
  resolvePitchPositionFromStaffPointer,
} from './staff-pitch-resolver';

describe('staff pitch resolver', () => {
  it('maps treble staff vertical positions to diatonic pitches', () => {
    const staff = staffElement({ top: 10, bottom: 50, height: 40 });

    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 50, clef: 'treble' })).toEqual({
      step: 'E',
      octave: 4,
    });
    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 40, clef: 'treble' })).toEqual({
      step: 'G',
      octave: 4,
    });
    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 30, clef: 'treble' })).toEqual({
      step: 'B',
      octave: 4,
    });
    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 20, clef: 'treble' })).toEqual({
      step: 'D',
      octave: 5,
    });
    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 10, clef: 'treble' })).toEqual({
      step: 'F',
      octave: 5,
    });
  });

  it('maps bass staff vertical positions to diatonic pitches', () => {
    const staff = staffElement({ top: 10, bottom: 50, height: 40 });

    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 50, clef: 'bass' })).toEqual({
      step: 'G',
      octave: 2,
    });
    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 30, clef: 'bass' })).toEqual({
      step: 'D',
      octave: 3,
    });
    expect(resolvePitchFromStaffPointer({ staffElement: staff, clientY: 10, clef: 'bass' })).toEqual({
      step: 'A',
      octave: 3,
    });
  });

  it('formats pitches for visible note-entry state', () => {
    expect(formatPitch({ step: 'C', octave: 4 })).toBe('C4');
    expect(formatPitch({ step: 'F', alter: 1, octave: 5 })).toBe('F#5');
    expect(formatPitch({ step: 'B', alter: -1, octave: 3 })).toBe('Bb3');
  });

  it('returns the snapped notehead center y for ghost preview placement', () => {
    const staff = staffElement({ top: 10, bottom: 50, height: 40 });

    expect(resolvePitchPositionFromStaffPointer({
      staffElement: staff,
      clientY: 31,
      clef: 'treble',
    })).toEqual({
      pitch: {
        step: 'B',
        octave: 4,
      },
      centerY: 30,
      diatonicOffsetFromBottomLine: 4,
      lineSpacing: 10,
    });
  });

  it('returns ledger-line offsets outside the five-line staff', () => {
    expect(getLedgerLineOffsets(8)).toEqual([]);
    expect(getLedgerLineOffsets(10)).toEqual([10]);
    expect(getLedgerLineOffsets(12)).toEqual([10, 12]);
    expect(getLedgerLineOffsets(0)).toEqual([]);
    expect(getLedgerLineOffsets(-2)).toEqual([-2]);
    expect(getLedgerLineOffsets(-4)).toEqual([-4, -2]);
  });
});

function staffElement(rect: Partial<DOMRect>): Element {
  const element = document.createElement('g');
  element.getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? 0,
    bottom: rect.bottom ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON: () => ({}),
  } as DOMRect);
  return element;
}
