/** Source-local exact integer written score coordinates. */
export type ScoreTick = number;
export type TicksPerQuarter = number;

export class PracticeScoreContractError extends Error {
  readonly code = 'practice_score_invalid';
}

export function scoreTick(value: unknown): ScoreTick {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new PracticeScoreContractError(
      'Practice score ticks require nonnegative safe integers.'
    );
  return value;
}

export function ticksPerQuarter(value: unknown): TicksPerQuarter {
  const resolution = scoreTick(value);
  if (!resolution)
    throw new PracticeScoreContractError(
      'Practice ticksPerQuarter must be positive.'
    );
  return resolution;
}

function exactTicks(numerator: bigint, denominator: bigint): ScoreTick {
  if (denominator <= 0n || numerator % denominator !== 0n)
    throw new PracticeScoreContractError(
      'Practice timebase cannot represent the meter grid exactly.'
    );
  return scoreTick(Number(numerator / denominator));
}

export function meterPulseTicks(
  meter: { denominator: number },
  resolution: TicksPerQuarter
): ScoreTick {
  if (!Number.isSafeInteger(meter.denominator) || meter.denominator <= 0)
    throw new PracticeScoreContractError('Invalid meter denominator.');
  return exactTicks(
    4n * BigInt(ticksPerQuarter(resolution)),
    BigInt(meter.denominator)
  );
}

export function measureDurationTicks(
  meter: { numerator: number; denominator: number },
  resolution: TicksPerQuarter
): ScoreTick {
  if (!Number.isSafeInteger(meter.numerator) || meter.numerator <= 0)
    throw new PracticeScoreContractError('Invalid meter numerator.');
  meterPulseTicks(meter, resolution);
  return exactTicks(
    BigInt(meter.numerator) * 4n * BigInt(resolution),
    BigInt(meter.denominator)
  );
}

export function pulseAtOrAfter(
  tick: ScoreTick,
  origin: ScoreTick,
  step: ScoreTick
): ScoreTick {
  scoreTick(tick);
  scoreTick(origin);
  scoreTick(step);
  if (!step)
    throw new PracticeScoreContractError('Pulse step must be positive.');
  const delta = BigInt(Math.max(0, tick - origin)),
    width = BigInt(step);
  return scoreTick(
    Number(BigInt(origin) + ((delta + width - 1n) / width) * width)
  );
}
