import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserMetronomeAudio } from './browser-metronome-audio';
function context() {
  const frequency=vi.fn(), level=vi.fn(), decay=vi.fn(), start=vi.fn(), stop=vi.fn();
  const oscillator={type:'',frequency:{setValueAtTime:frequency},connect:vi.fn(),start,stop};
  const gain={gain:{setValueAtTime:level,exponentialRampToValueAtTime:decay},connect:vi.fn()};
  const ctx={currentTime:2,state:'running',destination:{},createOscillator:vi.fn(()=>oscillator),createGain:vi.fn(()=>gain),
    resume:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
  return {ctx,frequency,level,decay,start,stop,oscillator,gain};
}
afterEach(()=>vi.unstubAllGlobals());
it('borrowed context supplies the audio clock and is never closed by adapter disposal',async()=>{
  const r=context(),port=createBrowserMetronomeAudio({kind:'BORROWED',context:r.ctx as unknown as AudioContext});
  port.activate();expect(port.nowMs()).toBe(2000);port.scheduleClick({atMs:2500,accent:true});
  await port.dispose();await port.dispose();expect(r.ctx.close).not.toHaveBeenCalled();
  port.activate();port.scheduleClick({atMs:3000,accent:true});expect(r.ctx.createOscillator).toHaveBeenCalledOnce();
});
it.each(['AudioContext','webkitAudioContext'])('owned %s is created lazily, reused and closed exactly once',name=>{
  const r=context(),Constructor=vi.fn(function(){return r.ctx;});vi.stubGlobal('window',{[name]:Constructor});
  const port=createBrowserMetronomeAudio({kind:'OWNED'});expect(Constructor).not.toHaveBeenCalled();
  port.activate();port.activate();expect(Constructor).toHaveBeenCalledOnce();
  port.dispose();port.dispose();port.activate();expect(r.ctx.close).toHaveBeenCalledOnce();expect(Constructor).toHaveBeenCalledOnce();
});
it('accent and regular oscillator, gain and decay values use the exact audio envelope',()=>{
  const r=context(),port=createBrowserMetronomeAudio({kind:'BORROWED',context:r.ctx as unknown as AudioContext});
  port.scheduleClick({atMs:2500,accent:true});port.scheduleClick({atMs:3000,accent:false});
  expect(r.frequency.mock.calls).toEqual([[1200,2.5],[800,3]]);expect(r.level.mock.calls).toEqual([[1,2.5],[0.5,3]]);
  expect(r.decay.mock.calls).toEqual([[0.001,2.53],[0.001,3.02]]);expect(r.start.mock.calls).toEqual([[2.5],[3]]);
  expect(r.stop.mock.calls[0][0]).toBeCloseTo(2.54,12);expect(r.stop.mock.calls[1][0]).toBeCloseTo(3.03,12);
  expect(r.oscillator.type).toBe('sine');expect(r.oscillator.connect).toHaveBeenCalledWith(r.gain);
  expect(r.gain.connect).toHaveBeenCalledWith(r.ctx.destination);port.dispose();
});
it.each(['missing','construct'])('unavailable audio (%s) remains silent and nonfatal',kind=>{
  vi.stubGlobal('window',kind==='missing'?{}:{AudioContext:class{constructor(){throw new Error('native');}}});
  const port=createBrowserMetronomeAudio({kind:'OWNED'});
  expect(()=>{port.activate();port.scheduleClick({atMs:0,accent:true});port.dispose();}).not.toThrow();expect(port.nowMs()).toBe(0);
});
it('failed context resume is nonfatal and silences the port without closing a borrowed context',async()=>{
  const r=context();r.ctx.state='suspended';r.ctx.resume.mockRejectedValue(new DOMException('private','NotAllowedError'));
  const port=createBrowserMetronomeAudio({kind:'BORROWED',context:r.ctx as unknown as AudioContext});
  port.activate();await Promise.resolve();await Promise.resolve();r.ctx.state='running';
  port.scheduleClick({atMs:2500,accent:true});expect(r.ctx.createOscillator).not.toHaveBeenCalled();
  port.dispose();expect(r.ctx.close).not.toHaveBeenCalled();
});
it.each(['oscillator','gain'])('%s failure only drops its click; subsequent clicks can schedule',kind=>{
  const r=context(),port=createBrowserMetronomeAudio({kind:'BORROWED',context:r.ctx as unknown as AudioContext});
  if(kind==='oscillator')r.ctx.createOscillator.mockImplementationOnce(()=>{throw new Error('audio');});
  else r.ctx.createGain.mockImplementationOnce(()=>{throw new Error('audio');});
  expect(()=>port.scheduleClick({atMs:2500,accent:true})).not.toThrow();port.scheduleClick({atMs:3000,accent:false});
  expect(r.start).toHaveBeenCalledOnce();port.dispose();
});
it.each(['throw','reject'])('owned cleanup %s is nonfatal and is attempted at most once',async kind=>{
  const r=context();vi.stubGlobal('window',{AudioContext:class{constructor(){return r.ctx;}}});
  if(kind==='throw')r.ctx.close.mockImplementation(()=>{throw new Error('close');});else r.ctx.close.mockRejectedValue(new Error('close'));
  const port=createBrowserMetronomeAudio({kind:'OWNED'});port.activate();await expect(Promise.resolve(port.dispose())).resolves.toBeUndefined();
  port.dispose();expect(r.ctx.close).toHaveBeenCalledOnce();
});
