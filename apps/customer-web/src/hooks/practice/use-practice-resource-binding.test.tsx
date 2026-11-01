// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { usePracticeResourceBinding } from './use-practice-resource-binding';
import { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
it('only observes supplied binding; replacement/clear and late old events cannot retain stale roots',async()=>{
  const one=midiDeviceFixture(),two=midiDeviceFixture();
  const acquire=vi.fn().mockResolvedValueOnce(one.access).mockResolvedValueOnce(two.access);
  const plan=planPracticeResources({mode:'STEP_BY_STEP',inputSource:'MIDI',recordingMode:'OFF'});
  const a=new PracticeResourceBinding(plan,{acquireMidi:acquire,acquireStream:vi.fn()}),b=new PracticeResourceBinding(plan,{acquireMidi:acquire,acquireStream:vi.fn()});
  await a.open();await b.open();
  const {result,rerender,unmount}=renderHook(({binding}:{binding:PracticeResourceBinding|null})=>usePracticeResourceBinding(binding),{initialProps:{binding:a as PracticeResourceBinding|null}});
  expect(result.current.borrow()!.midi).toBe(one.access);rerender({binding:b});
  act(()=>one.connect(false));expect(result.current.borrow()!.midi).toBe(two.access);expect(result.current.snapshot!.health.midi).toBe('HEALTHY');
  rerender({binding:null});expect(result.current.snapshot).toBeNull();expect(result.current.borrow()).toBeNull();
  act(()=>two.connect(false));expect(result.current.snapshot).toBeNull();unmount();expect(acquire).toHaveBeenCalledTimes(2);
  expect(a.snapshot().state).not.toBe('CLOSED');a.close();b.close();
});
