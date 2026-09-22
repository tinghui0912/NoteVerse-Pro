// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeSplitScreenOutputStream,
  drawExportFrame,
  getNoteHighlightBoxes,
  getSplitScreenExportReadiness,
  prepareScorePageCache,
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

function makeImage(width = 1200, height = 1600) {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
  return image;
}

type FakeContextCall = { name: string; args: unknown[] };

function createFakeContext() {
  const calls: FakeContextCall[] = [];
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    beginPath: vi.fn(() => calls.push({ name: 'beginPath', args: [] })),
    moveTo: vi.fn((...args: unknown[]) => calls.push({ name: 'moveTo', args })),
    lineTo: vi.fn((...args: unknown[]) => calls.push({ name: 'lineTo', args })),
    quadraticCurveTo: vi.fn((...args: unknown[]) => calls.push({ name: 'quadraticCurveTo', args })),
    closePath: vi.fn(() => calls.push({ name: 'closePath', args: [] })),
    fill: vi.fn(() => calls.push({ name: 'fill', args: [] })),
    stroke: vi.fn(() => calls.push({ name: 'stroke', args: [] })),
    save: vi.fn(() => calls.push({ name: 'save', args: [] })),
    restore: vi.fn(() => calls.push({ name: 'restore', args: [] })),
    fillRect: vi.fn((...args: unknown[]) => calls.push({ name: 'fillRect', args })),
    drawImage: vi.fn((...args: unknown[]) => calls.push({ name: 'drawImage', args })),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: FakeContextCall[] };
}

function createScoreContainer() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div data-practice-review-page="1">
      <svg viewBox="0 0 1200 1600" width="1200" height="1600">
        <g data-id="note-a"></g>
        <g data-id="note-b"></g>
        <g data-id="chord-1"></g>
        <g class="practice-note-active" data-id="stale-highlight"></g>
      </svg>
    </div>
    <div data-practice-review-page="2">
      <svg viewBox="0 0 1200 1600" width="1200" height="1600">
        <g data-id="note-page-2"></g>
      </svg>
    </div>
  `;
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
    'note-a': { x: 100, y: 200, width: 30, height: 40 },
    'note-b': { x: 180, y: 200, width: 30, height: 40 },
    'chord-1': { x: 260, y: 360, width: 80, height: 50 },
    'note-page-2': { x: 400, y: 500, width: 35, height: 45 },
  };
  container.querySelectorAll<SVGGraphicsElement>('[data-id]').forEach((element) => {
    const id = element.getAttribute('data-id') ?? '';
    element.getBBox = vi.fn(() => boxes[id] as DOMRect);
  });
  return container;
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

  it('prepares score page images once per page without including stale runtime highlights', async () => {
    const container = createScoreContainer();
    const loadImage = vi.fn(async (svgText: string) => {
      expect(svgText).not.toContain('practice-note-active');
      return makeImage();
    });

    const cache = await prepareScorePageCache(container, loadImage);

    expect(cache.size).toBe(2);
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it('advances five notes on the same page without decoding page images again', async () => {
    const container = createScoreContainer();
    const loadImage = vi.fn(async () => makeImage());
    const cache = await prepareScorePageCache(container, loadImage);
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement('canvas');
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });

    const adapter = {
      getCursorTimelineEntryForBeatRange: vi.fn((beat: number) => ({
        index: 0,
        beat,
        endBeat: beat + 1,
        noteIds: [beat % 2 === 0 ? 'note-a' : 'note-b'],
      })),
      getPageWithElement: vi.fn(() => 1),
    };
    const draft = createDraft({
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 5000,
        nominalMediaDurationMs: 5000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 5000, mediaStartMs: 0, mediaEndMs: 5000 }],
      },
      replayTiming: { scopeStartBeat: 0, scopeStartMs: 0, nominalDurationMs: 5000 },
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
        segments: [{ startBeat: 0, bpm: 60, source: 'CUSTOM' }],
      },
      scope: { startIndex: 0, endIndex: 8, startBeat: 0, terminalBeat: 8 },
    });

    for (let i = 0; i < 5; i += 1) {
      Object.defineProperty(video, 'currentTime', { configurable: true, value: i });
      drawExportFrame({
        ctx: finalCtx,
        video,
        draft,
        adapter: adapter as never,
        scoreEndBeat: 8,
        frameState: { scorePages: cache, stagingCanvas, stagingCtx },
      });
    }

    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(finalCtx.drawImage).toHaveBeenCalledTimes(5);
  });

  it('commits only complete staged frames to the captured canvas', async () => {
    const container = createScoreContainer();
    const cache = await prepareScorePageCache(container, async () => makeImage());
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement('canvas');
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 1 });
    const adapter = {
      getCursorTimelineEntryForBeatRange: vi.fn((beat: number) => ({
        index: 0,
        beat,
        endBeat: beat + 1,
        noteIds: ['note-a'],
      })),
      getPageWithElement: vi.fn(() => 1),
    };

    drawExportFrame({
      ctx: finalCtx,
      video,
      draft: createDraft(),
      adapter: adapter as never,
      scoreEndBeat: 24,
      frameState: { scorePages: cache, stagingCanvas, stagingCtx },
    });

    const stagingCallNames = stagingCtx.calls.map((call) => call.name);
    expect(stagingCallNames).toContain('fillRect');
    expect(stagingCallNames).toContain('drawImage');
    expect(stagingCallNames).toContain('stroke');
    expect(finalCtx.calls).toEqual([{ name: 'drawImage', args: [stagingCanvas, 0, 0] }]);
  });

  it('uses real note geometry for note and chord highlight boxes', () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>('svg')!;

    expect(
      getNoteHighlightBoxes(
        { svg, viewBox: { x: 0, y: 0, width: 1200, height: 1600 } },
        ['note-a', 'chord-1']
      )
    ).toEqual([
      { x: 100, y: 200, width: 30, height: 40 },
      { x: 260, y: 360, width: 80, height: 50 },
    ]);
  });
});
