import { afterEach, expect, it, vi } from 'vitest';
import { browserDevicePlatform } from '../device/browser-device-platform';
import { probePracticeRequirements } from '../environment/browser-readiness-probes';
import { createPracticeAudioContext, resumePracticeAudioContext, recordingBrowserFailure } from './browser-failures';
import { RecordingFailure } from './causal-failure';
import { browserMicrophoneCapture } from '../acoustic/source/browser-microphone-platform';
afterEach(() => vi.unstubAllGlobals());
it.each([['NotAllowedError','PERMISSION_DENIED'], ['NotFoundError','NOT_FOUND'], ['NotReadableError','BUSY']] as const)('getUserMedia %s is normalized once at the browser boundary', async (name,code) => {
  const cause = new DOMException('private URL and native text',name), getUserMedia=vi.fn().mockRejectedValue(cause);
  vi.stubGlobal('navigator', {mediaDevices:{getUserMedia}});
  await expect(browserDevicePlatform.acquireStream('inputMicrophone')).rejects.toMatchObject({kind:'DEVICE',code,resource:'MICROPHONE',cause});
  await expect(browserDevicePlatform.acquireStream('camera')).rejects.toMatchObject({kind:'DEVICE',code,resource:'CAMERA',cause});
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});
it('native message text never supplies permission semantics', async () => {
  const cause=new Error('NotAllowedError permission denied'); vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockRejectedValue(cause)}});
  await expect(browserDevicePlatform.acquireStream('inputMicrophone')).rejects.toMatchObject({kind:'DEVICE',code:'UNAVAILABLE',cause});
});
it('MIDI permission, unsupported browser and connectedness have explicit facts', async () => {
  const cause=new DOMException('private','NotAllowedError'); vi.stubGlobal('navigator',{requestMIDIAccess:vi.fn().mockRejectedValue(cause)});
  await expect(browserDevicePlatform.acquireMidi()).rejects.toMatchObject({kind:'MIDI',code:'PERMISSION_DENIED',cause});
  vi.stubGlobal('navigator',{}); await expect(browserDevicePlatform.acquireMidi()).rejects.toMatchObject({kind:'MIDI',code:'UNSUPPORTED'});
  vi.stubGlobal('navigator',{requestMIDIAccess:vi.fn().mockResolvedValue({inputs:new Map()})});
  await expect(probePracticeRequirements(['midi'],vi.fn(),new AbortController().signal)).rejects.toMatchObject({kind:'MIDI',code:'NO_CONNECTED_INPUT'});
});
it('AudioContext availability and resume failures stay separate from physical device health', async () => {
  vi.stubGlobal('AudioContext',undefined); expect(createPracticeAudioContext).toThrow(expect.objectContaining({kind:'AUDIO_CONTEXT',code:'UNAVAILABLE'}));
  const cause=new Error('private');
  await expect(resumePracticeAudioContext({state:'suspended',resume:vi.fn().mockRejectedValue(cause)} as unknown as AudioContext)).rejects.toMatchObject({kind:'AUDIO_CONTEXT',code:'RESUME_FAILED',cause});
  await expect(resumePracticeAudioContext({state:'closed',resume:vi.fn().mockRejectedValue(cause)} as unknown as AudioContext)).rejects.toMatchObject({kind:'AUDIO_CONTEXT',code:'CLOSED',cause});
});
it('recording preparation keeps a typed fact intact across media operations', () => {
  const cause=new DOMException('private','NotAllowedError'); expect(recordingBrowserFailure(cause)).toMatchObject({kind:'RECORDING',code:'RECORDING_PERMISSION_DENIED',cause});
  const failure=new RecordingFailure('RECORDER_INIT_FAILED'); expect(recordingBrowserFailure(failure)).toBe(failure);
});
it('FIR asset transport and qualified source rate fail with acoustic facts', async () => {
  await expect(browserMicrophoneCapture.coefficients(32000)).rejects.toMatchObject({kind:'ACOUSTIC',code:'SOURCE_RATE_UNSUPPORTED'});
  const cause=new Error('private asset path'); vi.stubGlobal('fetch',vi.fn().mockRejectedValue(cause));
  await expect(browserMicrophoneCapture.coefficients(48000)).rejects.toMatchObject({kind:'ACOUSTIC',code:'MODEL_ASSET_UNAVAILABLE',cause});
});
