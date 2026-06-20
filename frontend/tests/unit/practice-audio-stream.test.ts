import { describe, expect, it } from 'vitest';
import {
  convertFloat32ToPcm16,
  downsampleTo16k,
  normalizeWorkletSamples,
} from '@/lib/practice/audio-stream';

describe('practice audio stream helpers', () => {
  it('clamps and encodes float samples as little-endian PCM16', () => {
    const view = new DataView(convertFloat32ToPcm16(new Float32Array([-2, -1, 0, 1, 2])));
    expect(Array.from({ length: 5 }, (_, index) => view.getInt16(index * 2, true))).toEqual([
      -32768, -32768, 0, 32767, 32767,
    ]);
  });

  it('downsamples by selecting stable source positions', () => {
    expect(Array.from(downsampleTo16k(new Float32Array([0, 1, 2, 3, 4, 5]), 48000))).toEqual([
      0, 3,
    ]);
  });

  it('normalizes worklet payloads without exposing unrelated bytes', () => {
    const source = new Float32Array([1, 2, 3]);
    expect(Array.from(normalizeWorkletSamples(source.subarray(1)) ?? [])).toEqual([2, 3]);
    expect(normalizeWorkletSamples('invalid')).toBeNull();
  });
});
