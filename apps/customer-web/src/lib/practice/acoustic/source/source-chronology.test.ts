import { expect, it } from 'vitest';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES } from './capture-transport-contract';
import type { CaptureChunk } from './capture-types';
import { SourceChronology } from './source-chronology';

const chunk = (size: number, sequence = 0, start = 0): CaptureChunk => ({ type: 'pcm-chunk', sequence,
  sourceSampleRateHz: 48000, sourceStartSampleIndex: start, sourceEndSampleIndex: start + size,
  audioContextStartFrame: 7000 + start, captureTimeSeconds: (7000 + start) / 48000,
  inputChannelCount: 1, samples: new Float32Array(size) });

it('accepts the authoritative producer maximum and smaller chronological chunks without changing origin', () => {
  const chronology = new SourceChronology(48000);
  chronology.accept(chunk(CAPTURE_TRANSPORT_BLOCK_SAMPLES));
  chronology.accept(chunk(128, 1, CAPTURE_TRANSPORT_BLOCK_SAMPLES));
  expect(chronology.snapshot()).toEqual({ nextSequence: 2, audioContextOriginFrame: 7000, blocks: 2,
    chunkSizes: { [CAPTURE_TRANSPORT_BLOCK_SAMPLES]: 1, 128: 1 } });
  expect(() => chronology.accept(chunk(128, 2, CAPTURE_TRANSPORT_BLOCK_SAMPLES + 129)))
    .toThrow('CAPTURE_CHRONOLOGY_VIOLATION');
  expect(chronology.snapshot().nextSequence).toBe(2);
});

it.each([0, CAPTURE_TRANSPORT_BLOCK_SAMPLES + 1])('rejects invalid size %i before accepting chronology truth', size => {
  const chronology = new SourceChronology(48000), before = chronology.snapshot();
  expect(() => chronology.accept(chunk(size))).toThrow('CAPTURE_CHRONOLOGY_VIOLATION');
  expect(chronology.snapshot()).toEqual(before);
  chronology.accept(chunk(CAPTURE_TRANSPORT_BLOCK_SAMPLES));
  expect(chronology.snapshot()).toMatchObject({ nextSequence: 1, blocks: 1, audioContextOriginFrame: 7000 });
});
