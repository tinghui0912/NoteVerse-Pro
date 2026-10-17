import { describe, expect, it } from 'vitest';
import { RenderTimelineClock, sourceBoundary } from '../../scripts/audio-context-clock/latch';

describe('qualification render-timeline latch', () => {
  it('reads the actual context once per synchronous transaction and then releases', () => {
    let reads = 0;
    const clock = new RenderTimelineClock({ get currentTime() { return ++reads; } });
    clock.transaction(time => { expect(time).toBe(1); expect(clock.nowMs()).toBe(1000); expect(clock.nowMs()).toBe(1000); });
    expect(reads).toBe(1); expect(clock.nowMs()).toBe(2000);
  });
  it('releases after throw', () => {
    const context = { currentTime: 1 }, clock = new RenderTimelineClock(context);
    expect(() => clock.transaction(() => { throw new Error('test'); })).toThrow('test');
    context.currentTime = 2; expect(clock.nowMs()).toBe(2000);
  });
  it('rejects nested and asynchronous transactions', () => {
    const clock = new RenderTimelineClock({ currentTime: 1 });
    expect(() => clock.transaction(() => clock.transaction(() => 1))).toThrow('NESTED');
    expect(() => clock.transaction(() => Promise.resolve())).toThrow('ASYNCHRONOUS');
  });
  for (const rate of [44100, 48000]) it(`maps the same render frame exactly at ${rate}`, () => {
    const frame = 128 * 123, origin = 128;
    const result = sourceBoundary(frame / rate, rate, origin, frame - origin);
    expect(result.sourceSample).toBe(frame - origin); expect(result.leadSamples).toBe(0);
    expect(Math.abs(result.fractionalFrameError)).toBeLessThan(1e-8);
  });
  it('does not insert a boundary behind received PCM', () => {
    expect(() => sourceBoundary(1, 48000, 0, 48001)).toThrow('BOUNDARY_ALREADY_CONSUMED');
  });
});
