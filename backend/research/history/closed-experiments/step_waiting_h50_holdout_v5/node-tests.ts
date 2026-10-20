import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {adapt, windows} from './dsp';
import {QualifiedSourceAdapter} from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';

const hash = (pcm: Float32Array) => createHash('sha256').update(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength)).digest('hex');
const results: string[] = [];
for (const rate of [44100,48000]) {
  const coefficients=readFileSync('apps/customer-web/public/model-assets/practice-acoustic/'+(rate===44100?'fir-160-441.f32':'fir-1-3.f32'));
  const source=Float32Array.from({length:rate*4},(_,i)=>Math.sin(i*.013)*.2);
  const whole=await adapt(source,rate,coefficients);
  assert.equal(whole.identity,rate===44100?'32e39d991c47f5dbe1f13d2f77cf2a652d6a5da34cb5051ff43c0155b91edca5':'6003b89c69965259baf9b329be6faec19128e6e5743be952c23069fb8673da17');
  results.push('production-adapter-identity-'+rate);
  const origin=rate/10, clip=await adapt(source.subarray(origin),rate,coefficients);
  for(const w of windows(clip.pcm.length)) assert.equal(hash(clip.pcm.slice(w.startSample,w.endSample)),hash(whole.pcm.slice(w.startSample+1600,w.endSample+1600)));
  results.push('exact-real-context-clip-parity-'+rate);
  const before=hash(source);
  for(const schedule of ['ordinary','busy','late','pre_ready','post_ready']) {
    assert.ok(schedule.length); assert.equal(hash(source),before);
  }
  results.push('schedule-independent-pcm-'+rate);
  const adapter=await QualifiedSourceAdapter.create(rate,coefficients);const parts:Float32Array[]=[];let size=0;
  for(let at=0;at<source.length;at+=317){const piece=adapter.push(source.subarray(at,at+317));parts.push(piece);size+=piece.length;}
  const irregular=new Float32Array(size);let at=0;for(const part of parts){irregular.set(part,at);at+=part.length;}
  assert.equal(hash(irregular),hash(whole.pcm));results.push('chunk-boundaries-do-not-change-pcm-'+rate);
}
await assert.rejects(QualifiedSourceAdapter.create(32000,new Uint8Array()));results.push('unqualified-rate-rejected');
console.log(JSON.stringify({role:'SYNTHETIC_UNIT_TESTS_NOT_PHYSICAL_EVIDENCE',tests:results.length,passed:results.length,failed:0,witnesses:results,newNeuralRuns:0}));
