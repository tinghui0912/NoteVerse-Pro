// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PracticeWorkspaceProvider, usePracticeWorkspace } from './practice-workspace-context';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
import { PRACTICE_PREFERENCES_KEY } from '@/lib/practice/configuration/preference-storage';
const route = vi.hoisted(() => ({ path: '/score/s/practice/setup' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
afterEach(() => { localStorage.clear(); route.path = '/score/s/practice/setup'; });
const profile = { schemaVersion: 1 as const, mode: 'STEP_BY_STEP' as const, inputSource: 'MIDI' as const,
  continuous: { recordingMode: 'OFF' as const, liveFeedbackEnabled: false } };
async function rig() {
  let current!: ReturnType<typeof usePracticeWorkspace>;
  function Capture() { current = usePracticeWorkspace(); return null; }
  const environment = new PracticeEnvironment({ modelUrl: vi.fn(), createEngine: vi.fn(), validateCapture: vi.fn() });
  const tree = () => <PracticeWorkspaceProvider createEnvironment={() => environment}><Capture /></PracticeWorkspaceProvider>;
  const view = render(tree()); await waitFor(() => expect(current.hydrated).toBe(true));
  act(() => current.updateProfile(profile));
  const prepare = async () => {
    let transaction!: AbortController; act(() => { transaction = current.beginPreparation(); });
    const midi = midiDeviceFixture(), binding = new PracticeResourceBinding(planPracticeResources(current.configuration!), { acquireMidi: async () => midi.access, acquireStream: vi.fn() });
    await binding.open();
    const admission = Object.freeze({ source: Object.freeze({ sourceId:'source', scoreId:'s', revisionId:'r', artifactId:'a' }), configuration: Object.freeze({mode:profile.mode, inputSource:profile.inputSource, recordingMode:'OFF' as const}) });
    return { transaction, value: Object.freeze({ admission, binding }), midi };
  };
  return { get current() { return current; }, view, tree, prepare, environment };
}
it('commits admission and retained binding atomically; preferences persist without resource admission', async () => {
  const r = await rig(); expect(r.current.preparedPractice).toBeNull(); const p = await r.prepare();
  act(() => { expect(r.current.commitPreparedPractice(p.value,p.transaction)).toBe(true); });
  expect(r.current.preparedPractice).toBe(p.value); expect(p.value.binding.borrowRoots()!.midi).toBe(p.midi.access);
  expect(Object.keys(JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY)!)).sort()).toEqual(['continuous','inputSource','mode','schemaVersion']);
  r.view.unmount(); await waitFor(() => expect(p.value.binding.snapshot().state).toBe('CLOSED'));
  const next = await rig(); expect(next.current.preparedPractice).toBeNull(); expect(next.current.configuration?.inputSource).toBe('MIDI');
});
it('retains one binding across Practice candidate scope/tempo/metronome/feedback edits', async () => {
  const r = await rig(), p = await r.prepare();
  act(() => { r.current.commitPreparedPractice(p.value,p.transaction); });
  route.path = '/score/s/practice'; r.view.rerender(r.tree());
  act(() => { r.current.setScope({kind:'FULL'}); r.current.setTempoSelection({mode:'CUSTOM_FIXED_BPM',bpm:90});
    r.current.setMetronomeEnabled(true); r.current.updateProfile({...r.current.profile,continuous:{...r.current.profile.continuous,liveFeedbackEnabled:true}}); });
  expect(r.current.preparedPractice).toBe(p.value); expect(p.value.binding.borrowRoots()!.midi).toBe(p.midi.access);
});
it.each(['/score/s/practice/setup','/score/s/practice/review'])('entering %s releases the binding, including browser Back', async path => {
  route.path = '/score/s/practice'; const r = await rig(), p = await r.prepare(); act(() => { r.current.commitPreparedPractice(p.value,p.transaction); });
  route.path=path; r.view.rerender(r.tree()); await waitFor(() => expect(r.current.preparedPractice).toBeNull());
  expect(p.value.binding.snapshot().state).toBe('CLOSED');
});
it('resource configuration replacement retires admission while presentation preferences do not', async () => {
  const r=await rig(),p=await r.prepare();act(()=>{r.current.commitPreparedPractice(p.value,p.transaction);});
  act(()=>r.current.updateProfile({...profile,inputSource:'MICROPHONE'}));
  expect(r.current.preparedPractice).toBeNull();expect(p.value.binding.snapshot().state).toBe('CLOSED');
});
it('superseding a preparation fences its commit and closes a stale binding', async()=>{
  const r=await rig(), first=await r.prepare(),second=await r.prepare();
  expect(first.transaction.signal.aborted).toBe(true);
  act(()=>{expect(r.current.commitPreparedPractice(first.value,first.transaction)).toBe(false); expect(r.current.commitPreparedPractice(second.value,second.transaction)).toBe(true);});
  expect(first.value.binding.snapshot().state).toBe('CLOSED');expect(r.current.preparedPractice).toBe(second.value);
  act(()=>r.current.clearPreparedPractice());expect(second.value.binding.borrowRoots()).toBeNull();expect(r.current.preparedPractice).toBeNull();
});
