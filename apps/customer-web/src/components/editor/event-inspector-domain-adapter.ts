import type {Duration} from './input-values';
import type {RhythmicValue} from '@/lib/editor-domain';
export function toDomainRhythm(duration: Duration, dotted: boolean): RhythmicValue {
  const base = toDomainDurationBase(duration);
  return {
    timelineDuration: toDomainDurationRational(duration, dotted),
    notation: {
      base,
      dots: dotted ? 1 : 0,
    },
  };
}

function toDomainDurationBase(duration: Duration): RhythmicValue['notation']['base'] {
  switch (duration) {
    case 'durationWhole':
      return 'whole';
    case 'durationHalf':
      return 'half';
    case 'durationQuarter':
      return 'quarter';
    case 'durationEighth':
      return 'eighth';
    case 'duration16th':
      return '16th';
    case 'duration32nd':
      return '32nd';
    default:
      return exhaustive(duration);
  }
}

function toDomainDurationRational(duration: Duration, dotted: boolean) {
  const base = (() => {
    switch (duration) {
      case 'durationWhole':
        return { numerator: 4, denominator: 1 };
      case 'durationHalf':
        return { numerator: 2, denominator: 1 };
      case 'durationQuarter':
        return { numerator: 1, denominator: 1 };
      case 'durationEighth':
        return { numerator: 1, denominator: 2 };
      case 'duration16th':
        return { numerator: 1, denominator: 4 };
      case 'duration32nd':
        return { numerator: 1, denominator: 8 };
      default:
        return exhaustive(duration);
    }
  })();

  return normalizeRational(dotted
    ? { numerator: base.numerator * 3, denominator: base.denominator * 2 }
    : base);
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled Inspector domain adapter value: ${String(value)}`);
}

function normalizeRational(value: { numerator: number; denominator: number }) {
  if (value.numerator === 0) return { numerator: 0, denominator: 1 };
  const divisor = greatestCommonDivisor(Math.abs(value.numerator), value.denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}
