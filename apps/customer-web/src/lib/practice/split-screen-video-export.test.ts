// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeSplitScreenOutputStream,
  drawExportFrame,
  getSplitScreenExportReadiness,
  prepareScorePageCache,
  resolveSplitScreenScoreFrame,
  selectSupportedSplitScreenMimeType,
} from './split-screen-video-export';
import { renderSplitScreenFrameAtTime } from './split-screen-frame-renderer';
import { applyExportPlayheadCursor, getPlayheadCursorGeometry } from './playhead-cursor';
import { getEventScoreImage } from './split-screen-score-model';
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
        <g class="system" data-testid="system-1">
          <g data-id="note-a"></g>
          <g data-id="note-b"></g>
          <g data-id="chord-1"></g>
          <g class="practice-note-active" data-id="stale-highlight"></g>
        </g>
      </svg>
    </div>
    <div data-practice-review-page="2">
      <svg viewBox="0 0 1200 1600" width="1200" height="1600">
        <g class="system" data-testid="system-2">
          <g data-id="note-page-2"></g>
        </g>
      </svg>
    </div>
  `;
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
    'system-1': { x: 60, y: 120, width: 1080, height: 260 },
    'system-2': { x: 60, y: 430, width: 1080, height: 260 },
    'note-a': { x: 100, y: 200, width: 30, height: 40 },
    'note-b': { x: 180, y: 200, width: 30, height: 40 },
    'chord-1': { x: 260, y: 360, width: 80, height: 50 },
    'note-page-2': { x: 400, y: 500, width: 35, height: 45 },
  };
  container.querySelectorAll<SVGGraphicsElement>('[data-id], [data-testid]').forEach((element) => {
    const id = element.getAttribute('data-id') ?? element.getAttribute('data-testid') ?? '';
    element.getBBox = vi.fn(() => boxes[id] as DOMRect);
  });
  installIdentitySvgGeometry(container);
  document.body.appendChild(container);
  return container;
}

function installIdentitySvgGeometry(container: HTMLElement) {
  const matrix = {
    inverse: vi.fn(() => matrix),
    multiply: vi.fn(() => ({
      transformPoint: (point: { x: number; y: number }) => ({ x: point.x, y: point.y }),
    })),
  };
  container.querySelectorAll<SVGGraphicsElement>('svg, g').forEach((element) => {
    element.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
  });
  container.querySelectorAll<SVGSVGElement>('svg').forEach((svg) => {
    svg.createSVGPoint = vi.fn(() => ({
      x: 0,
      y: 0,
      matrixTransform(matrixLike: { transformPoint: (point: { x: number; y: number }) => { x: number; y: number } }) {
        return matrixLike.transformPoint(this);
      },
    } as SVGPoint));
  });
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

  it('renders the event cursor inside the frozen SVG image instead of on Canvas', async () => {
    const container = createScoreContainer();
    const serialized: string[] = [];
    const eventImageLoader = vi.fn(async (svgText: string) => {
      serialized.push(svgText);
      return makeImage();
    });
    const matrix = {
      inverse: vi.fn(() => matrix),
      multiply: vi.fn(() => matrix),
    };
    const cache = await prepareScorePageCache(
      container,
      async (svgText) => {
        serialized.push(svgText);
        return makeImage();
      },
      {
        eventImageLoader,
        eventSvgDecorator: (svg) => {
          svg.createSVGPoint = vi.fn(() => ({
            x: 0,
            y: 0,
            matrixTransform(pointMatrix: { transformPoint?: (point: unknown) => unknown }) {
              return pointMatrix.transformPoint?.(this) ?? this;
            },
          } as SVGPoint));
          svg.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
          svg.querySelectorAll<SVGGraphicsElement>('g').forEach((element) => {
            const id = element.getAttribute('data-id');
            if (id === 'note-a') {
              element.getBBox = vi.fn(() => ({
                x: 100,
                y: 200,
                width: 30,
                height: 40,
              } as DOMRect));
              element.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
            }
          });
        },
      }
    );

    const image = await getEventScoreImage(cache.get(1)!, ['note-a']);
    const cachedImage = await getEventScoreImage(cache.get(1)!, ['note-a']);

    expect(image).toBeTruthy();
    expect(cachedImage).toBe(image);
    expect(eventImageLoader).toHaveBeenCalledTimes(1);
    expect(serialized.filter((text) => text.includes('data-practice-playhead-cursor'))).toHaveLength(1);
    expect(serialized.at(-1)).toContain('data-practice-playhead-cursor');
  });

  it('renders one colored cursor per active staff without spanning the grand staff', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <svg viewBox="0 0 800 900" width="800" height="900">
        <g class="system">
          <g class="staff" data-id="staff-top">
            <g data-id="top-a"></g>
            <g data-id="top-b"></g>
          </g>
          <g class="staff" data-id="staff-bottom">
            <g data-id="bottom-a"></g>
          </g>
        </g>
      </svg>
    `;
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      'staff-top': { x: 80, y: 120, width: 640, height: 100 },
      'staff-bottom': { x: 80, y: 520, width: 640, height: 100 },
      'top-a': { x: 240, y: 150, width: 24, height: 32 },
      'top-b': { x: 246, y: 150, width: 28, height: 32 },
      'bottom-a': { x: 240, y: 550, width: 24, height: 32 },
    };
    const svg = container.querySelector<SVGSVGElement>('svg')!;
    const system = container.querySelector<SVGGraphicsElement>('.system')!;
    const identity = {
      inverse: vi.fn(() => identity),
      multiply: vi.fn(() => identity),
    };
    container.querySelectorAll<SVGGraphicsElement>('[data-id]').forEach((element) => {
      element.getBBox = vi.fn(() => boxes[element.getAttribute('data-id')!] as DOMRect);
      element.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
    });
    system.getBBox = vi.fn(() => ({ x: 80, y: 120, width: 640, height: 500 } as DOMRect));
    system.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
    svg.createSVGPoint = vi.fn(() => ({
      x: 0,
      y: 0,
      matrixTransform: (point: { x: number; y: number }) => point,
    } as SVGPoint));
    document.body.appendChild(container);

    const result = applyExportPlayheadCursor(container, ['top-a', 'top-b', 'bottom-a'], 'top-a');
    const cursor = container.querySelector<SVGRectElement>('[data-practice-playhead-cursor]');

    expect(result.geometry).not.toBeNull();
    expect(cursor).not.toBeNull();
    const cursors = container.querySelectorAll<SVGRectElement>('[data-practice-playhead-cursor]');
    expect(cursors).toHaveLength(2);
    expect(
      Array.from(cursors).map((cursor) => cursor.getAttribute('data-playhead-staff'))
    ).toEqual(expect.arrayContaining(['treble', 'bass']));
    const trebleCursor = container.querySelector<SVGRectElement>(
      '[data-practice-playhead-cursor][data-playhead-staff="treble"]'
    );
    const bassCursor = container.querySelector<SVGRectElement>(
      '[data-practice-playhead-cursor][data-playhead-staff="bass"]'
    );
    expect(trebleCursor?.getAttribute('fill')).toEqual(
      expect.stringContaining('125, 211, 252')
    );
    expect(bassCursor?.getAttribute('fill')).toEqual(
      expect.stringContaining('251, 191, 36')
    );
    expect(Number(trebleCursor?.getAttribute('y'))).toBeLessThan(120);
    expect(Number(trebleCursor?.getAttribute('y')) + Number(trebleCursor?.getAttribute('height'))).toBeLessThan(300);
  });

  it('keeps staff colors stable when a system contains repeated measure staff pairs', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <svg viewBox="0 0 800 900" width="800" height="900">
        <g class="system" data-id="system-1">
          <g class="measure" data-id="measure-1">
            <g class="staff" data-id="measure-1-top"><g data-id="measure-1-top-note"></g></g>
            <g class="staff" data-id="measure-1-bottom"><g data-id="measure-1-bottom-note"></g></g>
          </g>
          <g class="measure" data-id="measure-2">
            <g class="staff" data-id="measure-2-top"><g data-id="measure-2-top-note"></g></g>
            <g class="staff" data-id="measure-2-bottom"><g data-id="measure-2-bottom-note"></g></g>
          </g>
        </g>
      </svg>
    `;
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      'measure-1-top': { x: 80, y: 100, width: 300, height: 100 },
      'measure-1-bottom': { x: 80, y: 300, width: 300, height: 100 },
      'measure-2-top': { x: 420, y: 100, width: 300, height: 100 },
      'measure-2-bottom': { x: 420, y: 300, width: 300, height: 100 },
      'measure-2-top-note': { x: 520, y: 120, width: 24, height: 32 },
      'measure-2-bottom-note': { x: 520, y: 320, width: 24, height: 32 },
    };
    const containerSvg = container.querySelector<SVGSVGElement>('svg')!;
    const system = container.querySelector<SVGGraphicsElement>('.system')!;
    const identity = {
      inverse: vi.fn(() => identity),
      multiply: vi.fn(() => identity),
    };
    container.querySelectorAll<SVGGraphicsElement>('[data-id]').forEach((element) => {
      element.getBBox = vi.fn(() => (boxes[element.getAttribute('data-id')!] ?? {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }) as DOMRect);
      element.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
    });
    system.getBBox = vi.fn(() => ({ x: 80, y: 100, width: 640, height: 300 } as DOMRect));
    system.getCTM = vi.fn(() => identity as unknown as DOMMatrix);
    containerSvg.createSVGPoint = vi.fn(() => ({
      x: 0,
      y: 0,
      matrixTransform: (point: { x: number; y: number }) => point,
    } as SVGPoint));
    document.body.appendChild(container);

    applyExportPlayheadCursor(
      container,
      ['measure-2-top-note', 'measure-2-bottom-note'],
      'measure-2-top-note'
    );

    expect(
      container.querySelector(
        '[data-practice-playhead-cursor][data-playhead-staff="treble"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-practice-playhead-cursor][data-playhead-staff="bass"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-playhead-staff="other"]')
    ).toHaveLength(0);
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
      await drawExportFrame({
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

    await drawExportFrame({
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
    expect(stagingCallNames.filter((name) => name === 'drawImage')).toHaveLength(2);
    expect(finalCtx.calls).toEqual([{ name: 'drawImage', args: [stagingCanvas, 0, 0] }]);
  });

  it('keeps drawing from one frozen score snapshot after Review replaces the mounted SVG', async () => {
    const container = createScoreContainer();
    const loadImage = vi.fn(async () => makeImage());
    const cache = await prepareScorePageCache(container, loadImage);
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement('canvas');
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 1 });
    const adapter = {
      getCursorTimelineEntryForBeatRange: vi.fn(() => ({
        index: 0,
        beat: 4,
        endBeat: 5,
        noteIds: ['note-a'],
      })),
      getPageWithElement: vi.fn(() => 1),
    };
    const frameState = { scorePages: cache, stagingCanvas, stagingCtx };

    await drawExportFrame({
      ctx: finalCtx,
      video,
      draft: createDraft(),
      adapter: adapter as never,
      scoreEndBeat: 24,
      frameState,
    });

    const replacement = createScoreContainer();
    container.replaceWith(replacement);

    await expect(drawExportFrame({
        ctx: finalCtx,
        video,
        draft: createDraft(),
        adapter: adapter as never,
        scoreEndBeat: 24,
        frameState,
      })).resolves.toBeUndefined();
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(finalCtx.calls.filter((call) => call.name === 'drawImage')).toHaveLength(2);
    expect(cache.get(1)?.geometryByNoteId.has('note-a')).toBe(true);
    expect(adapter.getPageWithElement).not.toHaveBeenCalled();
  });

  it('uses real note geometry for one background playhead cursor', () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>('svg')!;

    const geometry = getPlayheadCursorGeometry(svg, ['note-a', 'chord-1']);

    expect(geometry?.noteBox).toEqual({ x: 100, y: 200, width: 240, height: 210 });
    expect(geometry?.systemBox).toEqual({ x: 60, y: 120, width: 1080, height: 260 });
    expect(geometry?.box.height).toBeGreaterThan(260);
    expect(geometry?.box.x).toBeLessThan(geometry!.noteBox.x);
    expect(geometry?.box.width).toBeGreaterThan(geometry!.noteBox.width);
  });

  it('renders a deterministic static frame from the frozen score model', async () => {
    const container = createScoreContainer();
    const cache = await prepareScorePageCache(container, async () => makeImage());
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = 1280;
    outputCanvas.height = 720;
    const ctx = createFakeContext();
    Object.defineProperty(outputCanvas, 'getContext', {
      configurable: true,
      value: () => ctx,
    });
    const diagnostics = await renderSplitScreenFrameAtTime({
      mediaTimeMs: 1000,
      scoreModel: cache,
      playbackTimeline: {
        resolve: () => ({
          perfTimeMs: 1000,
          musicalBeat: 4,
          pageNumber: 1,
          noteIds: ['note-a'],
        }),
      },
      sourceVideoFrame: {
        width: 640,
        height: 480,
      } as unknown as CanvasImageSource,
      outputCanvas,
      layout: {
        scoreRect: { x: 24, y: 24, width: 704, height: 672 },
        videoRect: { x: 752, y: 24, width: 504, height: 672 },
        background: '#0f172a',
      },
    });

    expect(diagnostics.anchorNoteId).toBe('note-a');
    expect(diagnostics.systemId).toBeTruthy();
    expect(diagnostics.cursorBox.height).toBeGreaterThan(0);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('keeps transformed system-local and root SVG cursor rectangles in separate coordinate spaces', () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>('svg')!;
    const system = container.querySelector<SVGGraphicsElement>('[data-testid="system-1"]')!;
    const systemMatrix = {};
    const rootMatrix = {
      inverse: vi.fn(() => rootInverse),
    };
    const rootInverse = {
      multiply: vi.fn(() => ({
        transformPoint: (point: { x: number; y: number }) => ({
          x: point.x + 500,
          y: point.y + 900,
        }),
      })),
    };
    const point = {
      x: 0,
      y: 0,
      matrixTransform(matrix: { transformPoint: (point: { x: number; y: number }) => { x: number; y: number } }) {
        return matrix.transformPoint(this);
      },
    };
    svg.createSVGPoint = vi.fn(() => ({ ...point } as SVGPoint));
    svg.getCTM = vi.fn(() => rootMatrix as unknown as DOMMatrix);
    system.getCTM = vi.fn(() => systemMatrix as unknown as DOMMatrix);

    const geometry = getPlayheadCursorGeometry(svg, ['note-a']);

    expect(geometry?.box.x).toBeLessThan(200);
    expect(geometry?.rootBox?.x).toBeGreaterThan(500);
    expect(geometry?.rootSystemBox?.y).toBeGreaterThan(900);
  });

  it('fails coordinate conversion instead of exporting with system-local rectangles as root coordinates', async () => {
    const container = createScoreContainer();
    container.querySelectorAll<SVGGraphicsElement>('svg, g').forEach((element) => {
      element.getCTM = undefined as unknown as SVGGraphicsElement['getCTM'];
    });
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

    await expect(drawExportFrame({
        ctx: finalCtx,
        video,
        draft: createDraft(),
        adapter: adapter as never,
        scoreEndBeat: 24,
        frameState: { scorePages: cache, stagingCanvas, stagingCtx },
      })).rejects.toThrow('split_screen_export_failed:playback_event_geometry_unavailable');
  });

  it('uses rendered SVG rectangles to keep visibly present transformed notes inside the export viewport', async () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>('svg')!;
    const system = container.querySelector<SVGGraphicsElement>('[data-testid="system-1"]')!;
    const note = container.querySelector<SVGGraphicsElement>('[data-id="note-a"]')!;
    svg.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 600,
      height: 800,
      right: 600,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect));
    system.getBoundingClientRect = vi.fn(() => ({
      left: 30,
      top: 80,
      width: 540,
      height: 150,
      right: 570,
      bottom: 230,
      x: 30,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect));
    note.getBoundingClientRect = vi.fn(() => ({
      left: 75,
      top: 120,
      width: 28,
      height: 32,
      right: 103,
      bottom: 152,
      x: 75,
      y: 120,
      toJSON: () => ({}),
    } as DOMRect));
    svg.getCTM = vi.fn(() => null);
    system.getCTM = vi.fn(() => null);
    note.getCTM = vi.fn(() => null);

    const cache = await prepareScorePageCache(container, async () => makeImage());
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement('canvas');
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 1 });

    await expect(drawExportFrame({
        ctx: finalCtx,
        video,
        draft: createDraft(),
        adapter: {
          getCursorTimelineEntryForBeatRange: vi.fn((beat: number) => ({
            index: 0,
            beat,
            endBeat: beat + 1,
            noteIds: ['note-a'],
          })),
          getPageWithElement: vi.fn(() => 1),
        } as never,
        scoreEndBeat: 24,
        frameState: { scorePages: cache, stagingCanvas, stagingCtx },
      })).resolves.toBeUndefined();
  });

  it('maps Verovio internal coordinates through CTM viewport pixels before comparing with the root viewBox', async () => {
    const container = createScoreContainer();
    const svg = container.querySelector<SVGSVGElement>('svg')!;
    const system = container.querySelector<SVGGraphicsElement>('[data-testid="system-1"]')!;
    const note = container.querySelector<SVGGraphicsElement>('[data-id="note-a"]')!;
    svg.setAttribute('viewBox', '0 0 840 931');
    svg.setAttribute('width', '840px');
    svg.setAttribute('height', '931px');
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            left: 0,
            top: 0,
            width: 840 * 0.053047619047619045,
            height: 931 * 0.053047619047619045,
          }) as DOMRect
      ),
    });
    note.getBBox = vi.fn(() => ({
      x: 5039,
      y: 1536.239990234375,
      width: 226.080078125,
      height: 842.760009765625,
    } as DOMRect));
    system.getBBox = vi.fn(() => ({
      x: 182.479736328125,
      y: 1266.239990234375,
      width: 19819.51953125,
      height: 3425.760009765625,
    } as DOMRect));
    note.getBoundingClientRect = vi.fn(
      () => ({ left: 272, top: 157, width: 12, height: 45 }) as DOMRect
    );
    system.getBoundingClientRect = vi.fn(
      () => ({ left: 10, top: 140, width: 820, height: 185 }) as DOMRect
    );
    const matrix = {
      a: 0.053047619047619045,
      b: 0,
      c: 0,
      d: 0.053047619047619045,
      e: 26.523809523809522,
      f: 74.66141915457588,
      inverse: vi.fn(() => matrix),
      multiply: vi.fn(() => matrix),
      transformPoint: (point: { x: number; y: number }) => ({
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      }),
    };
    note.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);
    system.getCTM = vi.fn(() => matrix as unknown as DOMMatrix);

    const geometry = getPlayheadCursorGeometry(svg, ['note-a']);

    expect(geometry?.rootCoordinateSource).toBe('ctm_svg_viewport');
    expect(geometry?.rootNoteBox?.x).toBeGreaterThan(250);
    expect(geometry?.rootNoteBox?.x).toBeLessThan(360);
    expect(geometry?.rootNoteBox?.y).toBeGreaterThan(140);
    expect(geometry?.rootNoteBox?.y).toBeLessThan(230);

    const cache = await prepareScorePageCache(container, async () => makeImage(840, 931));
    const finalCtx = createFakeContext();
    const stagingCtx = createFakeContext();
    const stagingCanvas = document.createElement('canvas');
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 1 });

    await expect(drawExportFrame({
        ctx: finalCtx,
        video,
        draft: createDraft(),
        adapter: {
          getCursorTimelineEntryForBeatRange: vi.fn((beat: number) => ({
            index: 0,
            beat,
            endBeat: beat + 1,
            noteIds: ['note-a'],
          })),
          getPageWithElement: vi.fn(() => 1),
        } as never,
        scoreEndBeat: 24,
        frameState: { scorePages: cache, stagingCanvas, stagingCtx },
      })).resolves.toBeUndefined();
  });
});
