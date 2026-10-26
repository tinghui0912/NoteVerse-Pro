import type { PracticeDeviceRoots } from '../device/device-contract';

export function midiDeviceFixture(connected = true) {
  const input = Object.assign(new EventTarget(), { id: 'keyboard', state: connected ? 'connected' : 'disconnected' });
  const access = Object.assign(new EventTarget(), { inputs: new Map([['keyboard', input]]) });
  return { input, access: access as unknown as MIDIAccess,
    connect(value: boolean) { input.state = value ? 'connected' : 'disconnected'; access.dispatchEvent(new Event('statechange')); },
    send(data: number[], timeStamp: number) { const event = new Event('midimessage');
      Object.defineProperties(event, { data: { value: new Uint8Array(data) }, timeStamp: { value: timeStamp } }); input.dispatchEvent(event); },
  };
}
export function borrowedDevices(inputMicrophone: MediaStream | null = null, recordingMicrophone: MediaStream | null = null, camera: MediaStream | null = null): PracticeDeviceRoots {
  return { inputMicrophone, recordingMicrophone, camera, midi: midiDeviceFixture().access };
}
