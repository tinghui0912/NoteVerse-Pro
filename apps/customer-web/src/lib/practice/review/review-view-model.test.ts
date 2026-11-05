import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { expect, it } from 'vitest';
import { reviewViewModel } from './review-view-model';
it.each(['MIDI', 'MICROPHONE'] as const)('projects only replay metadata for %s', source => {
  const view = reviewViewModel(canonicalContinuousResultFixture(source));
  expect(view.durationText).toBe('00:10');
  expect(view.inputSourceLabel).toBe(source === 'MIDI' ? 'inputSourceMidi' : 'inputSourceMic');
  expect(Object.keys(view).sort()).toEqual(['durationText', 'inputSourceLabel', 'scope', 'tempo']);
});
it('unavailable analysis does not create outcome cards or aggregates', () => {
  const view = reviewViewModel(canonicalContinuousResultFixture('MICROPHONE', 48000, false));
  expect(Object.keys(view).sort()).toEqual(['durationText', 'inputSourceLabel', 'scope', 'tempo']);
});

it.each(['SCORE', 'CUSTOM_FIXED_BPM'] as const)('returns semantic %s tempo and numeric scope instead of localized copy', mode => {
  const result = canonicalContinuousResultFixture();
  const view = reviewViewModel({
    ...result,
    tempoPlan: { ...result.tempoPlan, selection: mode === 'SCORE' ? { mode } : { mode, bpm: 96 } },
    scope: { ...result.scope, kind: 'RANGE', startGroupId: 'start', endGroupId: 'end', startTick: 4, terminalTick: 8 },
  });
  expect(view.tempo).toEqual(mode === 'SCORE' ? { kind: 'SCORE' } : { kind: 'CUSTOM_FIXED_BPM', bpm: 96 });
  expect(view.scope).toEqual({ label: 'scopeSection', startTick: 4, terminalTick: 8 });
  expect(Object.keys(view).sort()).toEqual([
    'durationText', 'inputSourceLabel', 'scope', 'tempo',
  ]);
});

it('exposes the full-scope translation key with its numeric bounds', () => {
  const result = canonicalContinuousResultFixture();
  expect(reviewViewModel(result).scope).toEqual({
    label: 'scopeFull', startTick: result.scope.startTick, terminalTick: result.scope.terminalTick,
  });
});
