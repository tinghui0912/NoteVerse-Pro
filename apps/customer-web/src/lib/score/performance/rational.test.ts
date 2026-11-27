import { describe, expect, it } from 'vitest';
import { Rational } from './rational';
import { decodeWrittenQstamp } from './written-realization';

describe('exact playback rational', () => {
  it('normalizes and preserves thirds through arithmetic and tick conversion', () => {
    const third = Rational.decode({ numerator: 1, denominator: 3 });
    expect(third.add(new Rational(1n))).toEqual(new Rational(4n, 3n));
    expect(third.multiply(new Rational(4n)).divide(new Rational(2n))).toEqual(
      new Rational(2n, 3n)
    );
    expect(third.subtract(new Rational(1n))).toEqual(new Rational(-2n, 3n));
    expect(new Rational(-2n, -6n)).toEqual(third);
    expect(Rational.ticks(40, 120)).toEqual(third);
    expect(Rational.ticks(160, 120)).toEqual(new Rational(4n, 3n));
    expect(third.compare(new Rational(333333n, 1000000n))).toBe(1);
    expect(Object.isFrozen(third)).toBe(true);
  });

  it.each([
    { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 1 },
    { numerator: 1.5, denominator: 1 },
    { numerator: NaN, denominator: 1 },
    { numerator: 1, denominator: 0 },
    { numerator: 1, denominator: -3 },
    { numerator: 1, denominator: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid transport integers: %j', (value) => {
    expect(() => Rational.decode(value)).toThrow();
  });

  it('rejects unsafe ticks, zero division and unsafe scheduling conversion', () => {
    expect(() => Rational.ticks(1.5, 120)).toThrow();
    expect(() => Rational.ticks(1, 0)).toThrow();
    expect(() => new Rational(1n).divide(new Rational(0n))).toThrow();
    expect(() => new Rational(1n << 4000n).toNumber()).toThrow();
    expect(() => new Rational(1n, 1n << 4000n).toNumber()).toThrow();
  });

  it.each([1, 2, 4, 5])(
    'decodes the renderer double for %i/3 to its unique exact MIDI-grid point',
    (n) => {
      expect(decodeWrittenQstamp(n / 3, 120)).toEqual(
        new Rational(BigInt(n), 3n)
      );
    }
  );

  it.each([0.1, 1.000001, -1, Infinity, NaN, '1/3'])(
    'rejects a qstamp without a unique grid representation: %s',
    (value) => {
      expect(() => decodeWrittenQstamp(value, 3)).toThrow();
    }
  );
});
