import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSavedPerformanceReplayUpload,
  readSavedPerformanceReplay,
} from './saved-performance-replay';
import type { PlayablePerformanceReplay } from './performance-replay';

describe('buildSavedPerformanceReplayUpload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes MIDI replay as a versioned NoteVerse replay object', async () => {
    const upload = buildSavedPerformanceReplayUpload({
      kind: 'MIDI_EVENTS',
      durationMs: 360,
      timebase: { version: 1, speedRatio: 0.8 },
      events: [
        { event_type: 'note_on', note_number: 60, velocity: 96, timestamp_ms: 120 },
        { event_type: 'note_off', note_number: 60, velocity: 0, timestamp_ms: 360 },
      ],
    });

    expect(upload).toMatchObject({
      kind: 'MIDI_EVENTS',
      filename: 'performance-replay.nvr.json',
      contentType: 'application/vnd.noteverse.replay+json',
      durationMs: 360,
      timebaseVersion: 1,
      formatVersion: 1,
    });
    await expect(upload.file.text()).resolves.toBe(
      JSON.stringify({
        formatVersion: 1,
        timebaseVersion: 1,
        durationMs: 360,
        speedRatio: 0.8,
        events: [
          { event_type: 'note_on', note_number: 60, velocity: 96, timestamp_ms: 120 },
          { event_type: 'note_off', note_number: 60, velocity: 0, timestamp_ms: 360 },
        ],
      })
    );
  });

  it('passes audio replay through as an immutable recording object', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const upload = buildSavedPerformanceReplayUpload({
      kind: 'AUDIO_RECORDING',
      blob,
      contentType: 'audio/webm',
      byteSize: blob.size,
      durationMs: 1200,
      timebase: { version: 1, speedRatio: 1 },
    } satisfies PlayablePerformanceReplay);

    expect(upload).toEqual({
      kind: 'AUDIO_RECORDING',
      file: blob,
      filename: 'performance-recording.webm',
      contentType: 'audio/webm',
      durationMs: 1200,
      timebaseVersion: 1,
      formatVersion: 1,
    });
  });

  it('normalizes browser recorder codec parameters for audio replay uploads', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm;codecs=opus' });
    const upload = buildSavedPerformanceReplayUpload({
      kind: 'AUDIO_RECORDING',
      blob,
      contentType: 'audio/webm;codecs=opus',
      byteSize: blob.size,
      durationMs: 1200,
      timebase: { version: 1, speedRatio: 1 },
    } satisfies PlayablePerformanceReplay);

    expect(upload).toMatchObject({
      kind: 'AUDIO_RECORDING',
      filename: 'performance-recording.webm',
      contentType: 'audio/webm',
    });
  });

  it('rejects unsupported audio replay upload content types', () => {
    const blob = new Blob(['audio'], { type: 'audio/mp4' });

    expect(() =>
      buildSavedPerformanceReplayUpload({
        kind: 'AUDIO_RECORDING',
        blob,
        contentType: 'audio/mp4',
        byteSize: blob.size,
        durationMs: 1200,
        timebase: { version: 1, speedRatio: 1 },
      } satisfies PlayablePerformanceReplay)
    ).toThrow('unsupported audio replay content type: audio/mp4');
  });

  it('loads a saved MIDI replay envelope from a playback URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        formatVersion: 1,
        timebaseVersion: 1,
        durationMs: 360,
        speedRatio: 0.75,
        events: [
          { event_type: 'note_on', note_number: 60, velocity: 96, timestamp_ms: 120 },
        ],
      }),
    } as Response);

    await expect(
      readSavedPerformanceReplay(
        {
          artifact_id: 'artifact-1',
          session_id: 'session-1',
          kind: 'MIDI_EVENTS',
          input_source: 'MIDI',
          content_type: 'application/vnd.noteverse.replay+json',
          byte_size: 128,
          checksum_sha256: 'checksum',
          duration_ms: 360,
          timebase_version: 1,
          format_version: 1,
          created_at: '2026-09-01T00:00:00Z',
        },
        'https://storage.example/replay.json'
      )
    ).resolves.toEqual({
      kind: 'MIDI_EVENTS',
      durationMs: 360,
      timebase: { version: 1, speedRatio: 0.75 },
      events: [
        { event_type: 'note_on', note_number: 60, velocity: 96, timestamp_ms: 120 },
      ],
    });
  });
});
