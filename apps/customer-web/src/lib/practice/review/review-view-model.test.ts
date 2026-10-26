import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { expect, it } from 'vitest';
import { reviewViewModel } from './review-view-model';
it.each(['MIDI', 'MICROPHONE'] as const)('projects %s cards directly from retained metrics', source => {
  const result = canonicalContinuousResultFixture(source);
  const view = reviewViewModel(result);
  expect(view.metrics).toBe(result.metrics);
  expect(view.targetCards[0]).toMatchObject({ label: 'targetStrikes', value: result.metrics.targetStrikeCount });
  expect(view.targetCards.map(c => c.label)).toEqual(source === 'MIDI'
    ? ['targetStrikes', 'confirmedCorrectStrikes', 'wrongStrikeCount', 'missingStrikes', 'notReachedStrikes']
    : ['targetStrikes', 'detectedTargetNotes', 'unconfirmedTargetNotes', 'notReachedStrikes']);
  expect(view.durationText).toBe('00:10');
});
it('unavailable analysis does not invent zero outcome cards', () => {
  const view = reviewViewModel(canonicalContinuousResultFixture('MICROPHONE', 48000, false));
  expect(view.targetCards).toHaveLength(1); expect(view.metrics.status).toBe('UNAVAILABLE');
});

it.each(['SCORE', 'CUSTOM_FIXED_BPM'] as const)('returns semantic %s tempo and numeric scope instead of localized copy', mode => {
  const result = canonicalContinuousResultFixture();
  const view = reviewViewModel({
    ...result,
    tempoPlan: { ...result.tempoPlan, selection: mode === 'SCORE' ? { mode } : { mode, bpm: 96 } },
    scope: { ...result.scope, kind: 'RANGE', startGroupId: 'start', endGroupId: 'end', startBeat: 4, terminalBeat: 8 },
  });
  expect(view.tempo).toEqual(mode === 'SCORE' ? { kind: 'SCORE' } : { kind: 'CUSTOM_FIXED_BPM', bpm: 96 });
  expect(view.scope).toEqual({ label: 'scopeSection', startBeat: 4, terminalBeat: 8 });
  expect(Object.keys(view).sort()).toEqual([
    'durationText', 'inputSourceLabel', 'metrics', 'scope', 'targetCards', 'tempo',
  ]);
});

it('exposes the full-scope translation key with its numeric bounds', () => {
  const result = canonicalContinuousResultFixture();
  expect(reviewViewModel(result).scope).toEqual({
    label: 'scopeFull', startBeat: result.scope.startBeat, terminalBeat: result.scope.terminalBeat,
  });
});
