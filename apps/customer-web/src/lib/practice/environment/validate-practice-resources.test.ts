import { recordingProbeFixture } from '../__fixtures__/recording-probe';
import { PracticeResourceBinding } from '../device/practice-resource-binding';
import { midiDeviceFixture } from '../__fixtures__/device-roots';
import { afterEach,expect,it,vi } from 'vitest';
import { validatePracticeResources } from './validate-practice-resources';
import { PracticeEnvironment } from './practice-environment';
import { planPracticeResources } from '../planning/resource-plan';
import { borrowedDevices } from '../__fixtures__/device-roots';
import * as recording from '../recording/recorder-capability';
vi.mock('../input-capability',()=>({evaluatePracticeInputCapabilities:()=>({}),getSelectedInputCapability:()=>({supported:true})}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function root(kind:'audio'|'video') {
 const clones:{stop:ReturnType<typeof vi.fn>}[]=[];
 const track={kind,readyState:'live',muted:false,stop:vi.fn(),clone:vi.fn(()=>{const clone={kind,readyState:'live',stop:vi.fn()};clones.push(clone);return clone;})};
 const stream={getTracks:()=>[track],getAudioTracks:()=>kind==='audio'?[track]:[],getVideoTracks:()=>kind==='video'?[track]:[]} as unknown as MediaStream;
 return {stream,track,clones};
}
it.each(['MICROPHONE','MIDI'] as const)('%s VIDEO validates exact roots and probes recording only on owned clones',async inputSource=>{
 const mic=root('audio'),camera=root('video'); const roots=borrowedDevices(inputSource==='MICROPHONE'?mic.stream:null,inputSource==='MIDI'?mic.stream:null,camera.stream);
 const environment=new PracticeEnvironment(),acoustic=vi.spyOn(environment,'validateAcoustic').mockResolvedValue();
 vi.stubGlobal('MediaStream',class {constructor(readonly tracks:MediaStreamTrack[]){} getTracks(){return this.tracks;} });
 const probe=vi.spyOn(recording,'probeRecording').mockResolvedValue(); const plan=planPracticeResources({mode:'CONTINUOUS_PLAY',inputSource,recordingMode:'VIDEO'});
 await validatePracticeResources({plan,roots,environment,signal:new AbortController().signal,onComponent:vi.fn()});
 expect(probe.mock.calls[0][1].getTracks()).toEqual([mic.clones[0],camera.clones[0]]);
 for(const original of [mic,camera]){expect(original.track.stop).not.toHaveBeenCalled();expect(original.clones[0].stop).toHaveBeenCalledOnce();}
 if(inputSource==='MICROPHONE')expect(acoustic).toHaveBeenCalledWith(expect.objectContaining({inputMicrophone:mic.stream}));else expect(acoustic).not.toHaveBeenCalled();
 await environment.dispose();
});
it('recording probe failure still stops only cloned tracks, never retained originals',async()=>{
 const mic=root('audio'),camera=root('video'),environment=new PracticeEnvironment();
 vi.stubGlobal('MediaStream',class{constructor(readonly tracks:MediaStreamTrack[]){}getTracks(){return this.tracks;}});
 vi.spyOn(recording,'probeRecording').mockRejectedValue(new Error('probe'));
 await expect(validatePracticeResources({plan:planPracticeResources({mode:'CONTINUOUS_PLAY',inputSource:'MIDI',recordingMode:'VIDEO'}),roots:borrowedDevices(null,mic.stream,camera.stream),environment,signal:new AbortController().signal,onComponent:vi.fn()})).rejects.toThrow('probe');
 for(const original of [mic,camera]){expect(original.track.stop).not.toHaveBeenCalled();expect(original.clones[0].stop).toHaveBeenCalledOnce();}await environment.dispose();
});

it('abort releases recording clones immediately; retained roots are released only by the binding',async()=>{
  vi.useFakeTimers();const r=recordingProbeFixture(),microphone=r.root('audio'),camera=r.root('video');
  const plan=planPracticeResources({mode:'CONTINUOUS_PLAY',inputSource:'MIDI',recordingMode:'VIDEO'});
  const binding=new PracticeResourceBinding(plan,{acquireMidi:async()=>midiDeviceFixture().access,
    acquireStream:async root=>root==='camera'?camera.stream:microphone.stream});
  await binding.open();const environment=new PracticeEnvironment(),controller=new AbortController(),ready=vi.fn();
  const pending=validatePracticeResources({plan,roots:binding.borrowRoots()!,environment,signal:controller.signal,onComponent:ready});
  const recorder=r.instances[0],lateStop=recorder.onstop!,lateError=recorder.onerror!;
  expect(recorder.state).toBe('recording');const reason=new DOMException('retired','AbortError');
  const rejected=expect(pending).rejects.toBe(reason);controller.abort(reason);await rejected;
  expect(vi.getTimerCount()).toBe(0);expect(recorder.stop).toHaveBeenCalledTimes(2);
  expect(recorder).toMatchObject({onstop:null,onerror:null,ondataavailable:null});
  for(const root of [microphone,camera]){expect(root.track.clones[0].stop).toHaveBeenCalledOnce();expect(root.track.stop).not.toHaveBeenCalled();}
  expect(binding.snapshot().state).toBe('READY');const calls=ready.mock.calls.length;lateStop();lateError();expect(ready).toHaveBeenCalledTimes(calls);
  binding.close();for(const root of [microphone,camera])expect(root.track.stop).toHaveBeenCalledOnce();
  await environment.dispose();
});
