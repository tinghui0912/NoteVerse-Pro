import { expect, it } from 'vitest';
import { AudioContextPerformanceClock } from './audio-context-performance-clock';

it('reads currentTime exactly once and preserves that instant throughout a transition', () => {
  let reads = 0;
  const clock = new AudioContextPerformanceClock({ get currentTime() { return ++reads / 44100; } });
  clock.transaction(C => { expect(clock.nowMs()).toBe(C * 1000); expect(clock.nowMs()).toBe(C * 1000); });
  expect(reads).toBe(1); expect(clock.nowMs()).toBe(2 / 44100 * 1000);
});
it('rejects nested and asynchronous transitions and releases after failure', () => {
  const context = { currentTime: 1 }, clock = new AudioContextPerformanceClock(context);
  expect(() => clock.transaction(() => clock.transaction(() => {}))).toThrow('NESTED');
  expect(() => clock.transaction(() => Promise.resolve())).toThrow('ASYNCHRONOUS');
  context.currentTime = 2; expect(clock.nowMs()).toBe(2000);
});
