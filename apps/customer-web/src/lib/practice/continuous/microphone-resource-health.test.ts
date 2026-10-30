import { expect, it, vi } from 'vitest';
import { ContinuousMicrophoneHealth } from './microphone-resource-health';

it('combines normalized source facts with independently observed AudioContext health', () => {
  const context = Object.assign(new EventTarget(), { state: 'running' }) as unknown as AudioContext;
  const changed = vi.fn(), owner = new ContinuousMicrophoneHealth('HEALTHY', context, changed);
  owner.observeSourceHealth('INTERRUPTED');
  expect(owner.snapshot()).toEqual({ healthy: false, reason: 'MICROPHONE_SOURCE_LOST', recoverability: 'SAME_PIPELINE_RECOVERABLE' });
  owner.observeSourceHealth('HEALTHY'); expect(owner.snapshot().healthy).toBe(true);
  Object.assign(context, { state: 'suspended' }); context.dispatchEvent(new Event('statechange'));
  expect(owner.snapshot()).toEqual({ healthy: false, reason: 'AUDIO_CONTEXT_INTERRUPTED', recoverability: 'SAME_PIPELINE_RECOVERABLE' });
  Object.assign(context, { state: 'running' }); context.dispatchEvent(new Event('statechange'));
  expect(owner.snapshot().healthy).toBe(true);
  owner.observeSourceHealth('LOST'); expect(owner.snapshot().recoverability).toBe('RESTART_REQUIRED');
  owner.observeSourceHealth('HEALTHY'); Object.assign(context, { state: 'closed' }); context.dispatchEvent(new Event('statechange'));
  expect(owner.snapshot()).toEqual({ healthy: false, reason: 'AUDIO_CONTEXT_INTERRUPTED', recoverability: 'RESTART_REQUIRED' });
  owner.dispose(); const calls = changed.mock.calls.length;
  owner.observeSourceHealth('LOST'); context.dispatchEvent(new Event('statechange')); expect(changed).toHaveBeenCalledTimes(calls);
});
it('releasing analysis-source facts retains canonical clock observation', () => {
  const context = Object.assign(new EventTarget(), { state: 'running' }) as unknown as AudioContext;
  const owner = new ContinuousMicrophoneHealth('HEALTHY', context, vi.fn());
  owner.releaseAnalysisSource(); owner.observeSourceHealth('LOST'); expect(owner.snapshot().healthy).toBe(true);
  Object.assign(context, { state: 'suspended' }); context.dispatchEvent(new Event('statechange'));
  expect(owner.snapshot().reason).toBe('AUDIO_CONTEXT_INTERRUPTED'); expect(owner.snapshot().healthy).toBe(false); owner.dispose();
});
