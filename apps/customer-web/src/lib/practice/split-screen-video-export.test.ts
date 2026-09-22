// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeSplitScreenOutputStream,
  getSplitScreenExportReadiness,
  resolveSplitScreenScoreFrame,
  selectSupportedSplitScreenMimeType,
} from './split-screen-video-export';
import type { PerformanceReviewDraft } from './performance-review-draft';

function createDraft(
  overrides: Partial<PerformanceReviewDraft> = {}
): PerformanceReviewDraft {
  return {
    localSessionId: 'session-1',
    scoreId: 'score-1',
    revisionId: 'rev-1',
    artifactId: 'artifact-1',
    scope: { startIndex: 4, endIndex: 12, startBeat: 4, terminalBeat: 16 },
    tempoPlan: {
      selection: { mode: 'SCORE' },
      segments: [
        { startBeat: 0, bpm: 120, source: 'MUSICXML' },
        { startBeat: 8, bpm: 60, source: 'MUSICXML' },
      ],
    },
    performanceSnapshot: {} as PerformanceReviewDraft['performanceSnapshot'],
    audio: { status: 'UNAVAILABLE', reason: 'VIDEO_RECORDING_LOCAL_ONLY' },
    video: {
      status: 'READY',
      blob: new Blob(['video'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 6000,
    },
    recordingTimebase: {
      recordingStartPerfTimeMs: 0,
      recordingEndPerfTimeMs: 8000,
      nominalMediaDurationMs: 6000,
      activeSegments: [
        { perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 },
        { perfStartMs: 5000, perfEndMs: 8000, mediaStartMs: 3000, mediaEndMs: 6000 },
      ],
    },
    replayTiming: { scopeStartBeat: 4, scopeStartMs: 2000, nominalDurationMs: 6000 },
    completedAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

function createAdapter() {
  return {
    getCursorTimelineEntryForBeatRange: vi.fn(
      (beat: number, startBeat: number, terminalBeat: number) => {
        if (beat < startBeat || beat > terminalBeat) return null;
        const noteId = beat >= 8 ? 'note-page-2' : 'note-page-1';
        return {
          index: 0,
          beat,
          endBeat: beat + 1,
          noteIds: [noteId],
        };
      }
    ),
    getPageWithElement: vi.fn((noteId: string) => (noteId === 'note-page-2' ? 2 : 1)),
  };
}

describe('split-screen video export helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('selects a supported WebM MediaRecorder mime type', () => {
    const FakeMediaRecorder = {
      isTypeSupported: vi.fn((mime: string) => mime === 'video/webm;codecs=vp8,opus'),
    };
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    expect(selectSupportedSplitScreenMimeType()).toBe('video/webm;codecs=vp8,opus');
  });

  it('reports unsupported encoding when MediaRecorder cannot encode WebM', () => {
    const FakeMediaRecorder = {
      isTypeSupported: vi.fn(() => false),
    };
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    expect(selectSupportedSplitScreenMimeType()).toBeNull();
  });

  it('blocks export when video, score identity, score DOM, timebase, or encoder are unavailable', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'captureStream', {
      configurable: true,
      value: vi.fn(() => new MediaStream()),
    });
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: vi.fn(() => true),
    });

    expect(
      getSplitScreenExportReadiness({
        draft: createDraft({ video: { status: 'UNAVAILABLE', reason: 'none' } }),
        isScoreIdentityConfirmed: true,
        xmlContent: '<score/>',
        scoreContainer: document.createElement('div'),
      })
    ).toEqual({ ok: false, reason: 'video_not_ready' });

    expect(
      getSplitScreenExportReadiness({
        draft: createDraft(),
        isScoreIdentityConfirmed: false,
        xmlContent: '<score/>',
        scoreContainer: document.createElement('div'),
      })
    ).toEqual({ ok: false, reason: 'score_identity_mismatch' });

    expect(
      getSplitScreenExportReadiness({
        draft: createDraft(),
        isScoreIdentityConfirmed: true,
        xmlContent: null,
        scoreContainer: document.createElement('div'),
      })
    ).toEqual({ ok: false, reason: 'score_not_ready' });

    expect(
      getSplitScreenExportReadiness({
        draft: createDraft({
          recordingTimebase: {
            recordingStartPerfTimeMs: 0,
            recordingEndPerfTimeMs: 0,
            nominalMediaDurationMs: 0,
            activeSegments: [],
          },
        }),
        isScoreIdentityConfirmed: true,
        xmlContent: '<score/>',
        scoreContainer: document.createElement('div'),
      })
    ).toEqual({ ok: false, reason: 'timebase_unavailable' });
  });

  it('resolves selected-scope timing through pause/resume and variable tempo into score pages', () => {
    const draft = createDraft();
    const adapter = createAdapter();

    const firstSegment = resolveSplitScreenScoreFrame({
      draft,
      adapter,
      mediaTimeMs: 1000,
      scoreEndBeat: 24,
    });
    expect(firstSegment?.perfTimeMs).toBe(1000);
    expect(firstSegment?.musicalBeat).toBe(6);
    expect(firstSegment?.pageNumber).toBe(1);
    expect(firstSegment?.noteIds).toEqual(['note-page-1']);

    const afterPause = resolveSplitScreenScoreFrame({
      draft,
      adapter,
      mediaTimeMs: 4000,
      scoreEndBeat: 24,
    });
    expect(afterPause?.perfTimeMs).toBe(6000);
    expect(afterPause?.musicalBeat).toBe(12);
    expect(afterPause?.pageNumber).toBe(2);
    expect(afterPause?.noteIds).toEqual(['note-page-2']);
  });

  it('scales media time when decoded media duration differs from nominal duration', () => {
    const draft = createDraft();
    const adapter = createAdapter();

    const frame = resolveSplitScreenScoreFrame({
      draft,
      adapter,
      mediaTimeMs: 5000,
      actualMediaDurationMs: 10000,
      scoreEndBeat: 24,
    });

    expect(frame?.perfTimeMs).toBe(3000);
    expect(frame?.pageNumber).toBe(2);
  });

  it('combines the canvas video track with original recording audio tracks', () => {
    const canvasVideoTrack = { kind: 'video' } as MediaStreamTrack;
    const audioTrack = { kind: 'audio' } as MediaStreamTrack;
    const canvasStream = {
      getVideoTracks: () => [canvasVideoTrack],
    } as MediaStream;
    const audioStream = {
      getAudioTracks: () => [audioTrack],
    } as MediaStream;
    const mediaStreamSpy = vi.fn(function FakeMediaStream(
      this: { tracks?: MediaStreamTrack[] },
      tracks?: MediaStreamTrack[]
    ) {
      this.tracks = tracks;
    });
    vi.stubGlobal('MediaStream', mediaStreamSpy);

    const result = composeSplitScreenOutputStream(canvasStream, audioStream) as unknown as {
      tracks: MediaStreamTrack[];
    };

    expect(mediaStreamSpy).toHaveBeenCalledWith([canvasVideoTrack, audioTrack]);
    expect(result.tracks).toEqual([canvasVideoTrack, audioTrack]);
  });
});
