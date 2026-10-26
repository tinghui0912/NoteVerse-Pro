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
