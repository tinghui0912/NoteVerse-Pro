import type { Articulation, Duration } from '@/types/score-types';

const DURATION_EPSILON = 0.001;

function isApproxEqual(left: number, right: number) {
  return Math.abs(left - right) < DURATION_EPSILON;
}

export function extractPitch(noteNode: Element): string | null {
  const pitchNode = noteNode.querySelector('pitch');
  if (!pitchNode) return null;
  const step = pitchNode.querySelector('step')?.textContent || '';
  const alter = parseInt(pitchNode.querySelector('alter')?.textContent || '0', 10);
  const octave = pitchNode.querySelector('octave')?.textContent || '4';
  const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  return `${step}${accidental}${octave}`;
}

export function parseDuration(node: Element, divisions: number): Duration {
  const explicitType = node.querySelector('type')?.textContent;
  const explicitDurations: Partial<Record<string, Duration>> = {
    whole: 'durationWhole',
    half: 'durationHalf',
    quarter: 'durationQuarter',
    eighth: 'durationEighth',
    '16th': 'duration16th',
    '32nd': 'duration32nd',
  };
  if (explicitType && explicitDurations[explicitType]) return explicitDurations[explicitType];

  const duration = parseInt(node.querySelector('duration')?.textContent || '4', 10);
  const ratio = duration / divisions;
  if (isApproxEqual(ratio, 4) || isApproxEqual(ratio, 6)) return 'durationWhole';
  if (isApproxEqual(ratio, 3) || isApproxEqual(ratio, 2)) return 'durationHalf';
  if (isApproxEqual(ratio, 1.5) || isApproxEqual(ratio, 1)) return 'durationQuarter';
  if (isApproxEqual(ratio, 0.75) || isApproxEqual(ratio, 0.5)) return 'durationEighth';
  if (isApproxEqual(ratio, 0.375) || isApproxEqual(ratio, 0.25)) return 'duration16th';
  if (isApproxEqual(ratio, 0.125)) return 'duration32nd';
  if (ratio > 2.5) return 'durationWhole';
  if (ratio > 1.25) return 'durationHalf';
  if (ratio > 0.625) return 'durationQuarter';
  if (ratio > 0.375) return 'durationEighth';
  if (ratio > 0.1875) return 'duration16th';
  return 'duration32nd';
}

export function isDottedDuration(duration: number, divisions: number) {
  const ratio = duration / divisions;
  return [6, 3, 1.5, 0.75, 0.375].some((candidate) => isApproxEqual(ratio, candidate));
}

export function parseArticulations(noteNode: Element): Articulation[] {
  const articulations: Articulation[] = [];
  if (noteNode.querySelector('beam')) articulations.push('beam');
  if (noteNode.querySelector('tie')) articulations.push('tie');
  if (noteNode.querySelector('notations > slur')) articulations.push('slur');
  return articulations;
}
