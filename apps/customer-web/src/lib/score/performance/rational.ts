import type { RationalRead } from '@/generated/api';

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function safeInteger(value: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error('Invalid exact integer.');
  return value;
}

export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;

  constructor(numerator: bigint, denominator = 1n) {
    if (denominator === 0n) throw new Error('Invalid rational denominator.');
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = gcd(numerator, denominator * sign);
    this.numerator = (numerator * sign) / divisor;
    this.denominator = (denominator * sign) / divisor;
    Object.freeze(this);
  }

  static decode(value: RationalRead): Rational {
    safeInteger(value.numerator, -Number.MAX_SAFE_INTEGER);
    safeInteger(value.denominator, 1);
    return new Rational(BigInt(value.numerator), BigInt(value.denominator));
  }

  static ticks(ticks: number, ppq: number): Rational {
    return new Rational(
      BigInt(safeInteger(ticks)),
      BigInt(safeInteger(ppq, 1))
    );
  }

  add(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator
    );
  }

  subtract(other: Rational): Rational {
    return this.add(new Rational(-other.numerator, other.denominator));
  }

  multiply(other: Rational): Rational {
    return new Rational(
      this.numerator * other.numerator,
      this.denominator * other.denominator
    );
  }

  divide(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator,
      this.denominator * other.numerator
    );
  }

  compare(other: Rational): number {
    const difference =
      this.numerator * other.denominator - other.numerator * this.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  /** Conversion only at WebAudio seconds / UI rate boundaries. */
  toNumber(): number {
    const value = Number(this.numerator) / Number(this.denominator);
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER ||
      (value === 0 && this.numerator !== 0n)
    ) {
      throw new Error('Rational cannot be safely converted for playback.');
    }
    return value;
  }
}

export const ZERO = new Rational(0n);
export const SIXTY = new Rational(60n);
