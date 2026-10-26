// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PracticeWorkspaceProvider, usePracticeWorkspace } from './practice-workspace-context';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { PRACTICE_PREFERENCES_KEY } from '@/lib/practice/configuration/preference-storage';

afterEach(() => localStorage.clear());
function environment() {
  return new PracticeEnvironment({ modelUrl: vi.fn(), createEngine: vi.fn(), probe: async (requirements, ready) => requirements.forEach(ready) });
}
it('restores only explicit preferences after remount, never a passed-readiness flag or warm memory', async () => {
  let current!: ReturnType<typeof usePracticeWorkspace>;
  function Capture() { current = usePracticeWorkspace(); return null; }
  const first = environment(), dispose = vi.spyOn(first, 'dispose');
  const view = render(<PracticeWorkspaceProvider createEnvironment={() => first}><Capture /></PracticeWorkspaceProvider>);
  await waitFor(() => expect(current.hydrated).toBe(true));
  expect(current.resolution.status).toBe('INCOMPLETE'); expect(current.ready).toBe(false);
  act(() => current.updateProfile({ schemaVersion: 1, mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', continuous: { recordingMode: 'OFF', liveFeedbackEnabled: false } }));
  await act(async () => { await current.prepare(); }); expect(current.ready).toBe(true);
  expect(Object.keys(JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY)!)).sort()).toEqual(['continuous', 'inputSource', 'mode', 'schemaVersion']);
  view.unmount(); await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  const next = environment();
  render(<PracticeWorkspaceProvider createEnvironment={() => next}><Capture /></PracticeWorkspaceProvider>);
  await waitFor(() => expect(current.hydrated).toBe(true));
  expect(current.configuration).toMatchObject({ mode: 'CONTINUOUS_PLAY', recordingMode: 'OFF' });
  expect(current.ready).toBe(false); expect(current.environment).toBe(next);
});
it('keeps workspace options and its stable environment across child routes and live feedback changes', async () => {
  let current!: ReturnType<typeof usePracticeWorkspace>;
  function Capture({ route }: { route: string }) { current = usePracticeWorkspace(); return <span>{route}</span>; }
  const instance = environment(), createEnvironment = vi.fn(() => instance);
  const view = render(<PracticeWorkspaceProvider createEnvironment={createEnvironment}><Capture route="setup" /></PracticeWorkspaceProvider>);
  await waitFor(() => expect(current.hydrated).toBe(true));
  act(() => {
    current.updateProfile({ schemaVersion: 1, mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', continuous: { recordingMode: 'OFF', liveFeedbackEnabled: true } });
    current.setTempoSelection({ mode: 'CUSTOM_FIXED_BPM', bpm: 90 }); current.setMetronomeEnabled(true);
    current.setScope({ kind: 'RANGE', startGroupId: 'start', endGroupId: 'end' });
  });
  await act(async () => { await current.prepare(); });
  for (const route of ['practice', 'review', 'practice']) {
    view.rerender(<PracticeWorkspaceProvider createEnvironment={createEnvironment}><Capture route={route} /></PracticeWorkspaceProvider>);
    expect(current.ready).toBe(true); expect(current.tempoSelection).toEqual({ mode: 'CUSTOM_FIXED_BPM', bpm: 90 });
    expect(current.scope).toEqual({ kind: 'RANGE', startGroupId: 'start', endGroupId: 'end' }); expect(current.metronomeEnabled).toBe(true);
  }
  const fingerprint = current.readiness.fingerprint;
  act(() => current.updateProfile({ ...current.profile, continuous: { ...current.profile.continuous, liveFeedbackEnabled: false } }));
  expect(current.readiness.fingerprint).toBe(fingerprint); expect(current.ready).toBe(true); expect(createEnvironment).toHaveBeenCalledOnce();
});
