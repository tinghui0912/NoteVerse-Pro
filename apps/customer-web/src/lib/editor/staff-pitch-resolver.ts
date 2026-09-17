import type { Pitch, PitchStep } from '@/lib/editor-domain';

export type StaffPitchClef = 'treble' | 'bass';

export type StaffPitchPosition = {
  pitch: Pitch;
  centerY: number;
  diatonicOffsetFromBottomLine: number;
  lineSpacing: number;
};

const DIATONIC_STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

const BOTTOM_LINE_BY_CLEF: Record<StaffPitchClef, Pitch> = {
  treble: { step: 'E', octave: 4 },
  bass: { step: 'G', octave: 2 },
};

export function resolvePitchFromStaffPointer(params: {
  staffElement: Element | null;
  clientY: number;
  clef: StaffPitchClef | undefined;
}): Pitch | null {
  return resolvePitchPositionFromStaffPointer(params)?.pitch ?? null;
}

export function resolvePitchPositionFromStaffPointer(params: {
  staffElement: Element | null;
  clientY: number;
  clef: StaffPitchClef | undefined;
}): StaffPitchPosition | null {
  if (!params.staffElement || !params.clef) return null;
  const rect = params.staffElement.getBoundingClientRect();
  if (rect.height <= 0) return null;

  const lineSpacing = rect.height / 4;
  if (lineSpacing <= 0) return null;

  const diatonicOffsetFromBottomLine = Math.round(((rect.bottom - params.clientY) / lineSpacing) * 2);
  return {
    pitch: transposeDiatonic(BOTTOM_LINE_BY_CLEF[params.clef], diatonicOffsetFromBottomLine),
    centerY: rect.bottom - (diatonicOffsetFromBottomLine * lineSpacing) / 2,
    diatonicOffsetFromBottomLine,
    lineSpacing,
  };
}

export function getLedgerLineOffsets(diatonicOffsetFromBottomLine: number): number[] {
  if (diatonicOffsetFromBottomLine < 0) {
    return evenRange(diatonicOffsetFromBottomLine, -2);
  }
  if (diatonicOffsetFromBottomLine > 8) {
    return evenRange(10, diatonicOffsetFromBottomLine);
  }
  return [];
}

export function formatPitch(pitch: Pitch): string {
  return `${pitch.step}${formatAlter(pitch.alter)}${pitch.octave}`;
}

function transposeDiatonic(anchor: Pitch, offset: number): Pitch {
  const anchorStepIndex = DIATONIC_STEPS.indexOf(anchor.step);
  const absolute = anchor.octave * DIATONIC_STEPS.length + anchorStepIndex + offset;
  const stepIndex = positiveModulo(absolute, DIATONIC_STEPS.length);
  const octave = Math.floor(absolute / DIATONIC_STEPS.length);

  return {
    step: DIATONIC_STEPS[stepIndex] ?? 'C',
    octave,
  };
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function formatAlter(alter: number | undefined): string {
  if (alter === 1) return '#';
  if (alter === -1) return 'b';
  if (alter === 2) return '##';
  if (alter === -2) return 'bb';
  return '';
}

function evenRange(start: number, end: number): number[] {
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const values: number[] = [];
  for (let value = min; value <= max; value += 1) {
    if (value % 2 === 0) values.push(value);
  }
  return values;
}
