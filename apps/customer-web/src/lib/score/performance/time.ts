import type { BrowserPerformancePlan } from './plan';
import { Rational, SIXTY, ZERO } from './rational';

export function createPerformanceTimeMapper(plan: BrowserPerformancePlan) {
  const segments: {
    start: Rational;
    end: Rational;
    seconds: Rational;
    secondsPerQuarter: Rational;
  }[] = [];
  let position = ZERO;
  let elapsed = ZERO;
  let bpm = plan.initialTempoBpm;
  let originBpm = bpm;
  const advance = (end: Rational) => {
    const secondsPerQuarter = SIXTY.divide(bpm);
    if (end.compare(position) > 0) {
      segments.push({
        start: position,
        end,
        seconds: elapsed,
        secondsPerQuarter,
      });
      elapsed = elapsed.add(end.subtract(position).multiply(secondsPerQuarter));
    }
    position = end;
  };
  for (const event of plan.tempoEvents) {
    advance(event.performancePosition);
    bpm = event.bpm;
    if (position.compare(ZERO) === 0) originBpm = bpm;
  }
  advance(plan.performanceEnd);
  const exactSeconds = (quarter: Rational): Rational => {
    if (quarter.compare(ZERO) < 0 || quarter.compare(plan.performanceEnd) > 0)
      throw new Error('Performance position outside plan.');
    if (quarter.compare(plan.performanceEnd) === 0) return elapsed;
    const segment = segments.find(
      (segment) =>
        quarter.compare(segment.start) >= 0 && quarter.compare(segment.end) <= 0
    );
    if (!segment) throw new Error('Unmapped performance coordinate.');
    return segment.seconds.add(
      quarter.subtract(segment.start).multiply(segment.secondsPerQuarter)
    );
  };
  return Object.freeze({
    performanceQuarterToExactSeconds: exactSeconds,
    performanceQuarterToSeconds: (quarter: Rational) =>
      exactSeconds(quarter).toNumber(),
    performanceEndSeconds: elapsed.toNumber(),
    effectiveOriginTempoBpm: originBpm.toNumber(),
  });
}
