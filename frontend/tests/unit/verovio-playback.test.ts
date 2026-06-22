// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Midi } from '@tonejs/midi';
import { describe, expect, it, vi } from 'vitest';

import { VerovioScoreAdapter } from '@/lib/score/verovio';
import { VerovioScorePreviewController } from '@/lib/score/verovio-score-preview-controller';
import {
  createVerovioPlaybackTimeline,
  VerovioPlaybackPrototype,
  type VerovioAudioEngine,
  type VerovioPlaybackNote,
} from '@/lib/score/verovio/playback';

function encodeMidi() {
  const midi = new Midi();
  midi.header.setTempo(120);
  const track = midi.addTrack();
  track.instrument.number = 0;
  track.addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.8 });
  track.addNote({ midi: 64, time: 1, duration: 0.5, velocity: 0.7 });
  return btoa(String.fromCharCode(...midi.toArray()));
}

class StubAdapter extends VerovioScoreAdapter {
  disposed = false;

  override async loadMusicXml() {}

  override renderMidi() {
    return encodeMidi();
  }

  override renderTimemap() {
    return [
      { on: ['note-1'], tstamp: 0, tempo: 120 },
      { off: ['note-1'], tstamp: 500 },
      { on: ['note-2'], tstamp: 1000 },
      { off: ['note-2'], tstamp: 1500 },
    ];
  }

  override getPageWithElement(xmlId: string) {
    return xmlId === 'note-2' ? 2 : 1;
  }

  override renderAllPages() {
    return [
      {
        pageNumber: 1,
        svg: '<svg><g class="system"><g id="note-1"><path /></g></g></svg>',
      },
      {
        pageNumber: 2,
        svg: '<svg><g class="system"><g id="note-2"><path /></g></g></svg>',
      },
    ];
  }

  override relayout() {
    return this.renderAllPages();
  }

  override dispose() {
    this.disposed = true;
  }
}

class OpeningRestAdapter extends StubAdapter {
  override renderTimemap() {
    return [
      { on: ['note-1'], tstamp: 1000, tempo: 120 },
      { off: ['note-1'], tstamp: 1500 },
    ];
  }

  override renderAllPages() {
    return [
      {
        pageNumber: 1,
        svg: [
          '<svg>',
          '<g class="system">',
          '<g class="measure">',
          '<g class="meterSig" />',
          '<g id="note-1"><path /></g>',
          '</g>',
          '</g>',
          '</svg>',
        ].join(''),
      },
    ];
  }
}

class StubAudioEngine implements VerovioAudioEngine {
  currentTime = 0;
  prepared: string[] = [];
  scheduled: Array<{ note: VerovioPlaybackNote; startTime: number; duration: number }> = [];
  stopCount = 0;
  resumeCount = 0;
  closed = false;

  async prepare(instruments: string[]) {
    this.prepared = instruments;
  }

  async resume() {
    this.resumeCount += 1;
  }

  schedule(note: VerovioPlaybackNote, startTime: number, duration: number) {
    this.scheduled.push({ note, startTime, duration });
  }

  stopAll() {
    this.stopCount += 1;
  }

  async close() {
    this.closed = true;
  }
}

describe('Verovio playback timeline', () => {
  it(
    'extracts MIDI notes and visual events from a real MusicXML fixture through Verovio WASM',
    async () => {
      const xml = readFileSync(
        resolve(process.cwd(), 'tests/fixtures/musicxml/chords-voices.musicxml'),
        'utf8'
      );
      const adapter = new VerovioScoreAdapter();

      await adapter.loadMusicXml(xml);
      const timeline = createVerovioPlaybackTimeline(
        adapter.renderMidi(),
        adapter.renderTimemap()
      );

      expect(timeline.notes).toHaveLength(3);
      expect(timeline.visualEvents).toHaveLength(1);
      expect(timeline.visualEvents[0]?.noteIds).toHaveLength(3);
      expect(timeline.sourceTempo).toBe(120);
      expect(timeline.duration).toBeCloseTo(0.5, 2);
      expect(adapter.getPageWithElement(timeline.visualEvents[0]?.noteIds[0] ?? '')).toBe(1);
      adapter.dispose();
    },
    30_000
  );
});

describe('VerovioPlaybackPrototype', () => {
  it('supports playback, pause, seek, tempo, multi-page cursor lookup, and disposal', async () => {
    const adapter = new StubAdapter();
    const audio = new StubAudioEngine();
    const controller = new VerovioPlaybackPrototype(adapter, audio);

    await controller.loadScore('<score-partwise />');
    expect(audio.prepared).toEqual(['acoustic_grand_piano']);
    expect(controller.getPlaybackSnapshot()).toMatchObject({
      state: 'STOPPED',
      currentStep: 0,
      totalSteps: 2,
      duration: 1.5,
    });

    await controller.play();
    expect(audio.resumeCount).toBe(1);
    expect(audio.scheduled).toHaveLength(2);

    audio.currentTime = 1.1;
    expect(controller.getCursorSnapshot()).toEqual({
      time: 1.1,
      eventIndex: 1,
      noteIds: ['note-2'],
      pageNumbers: [2],
    });

    await controller.pause();
    expect(controller.getPlaybackSnapshot()).toMatchObject({
      state: 'PAUSED',
      currentTime: 1.1,
    });

    await controller.seek(0.25);
    await controller.setTempo(240);
    expect(controller.getPlaybackSnapshot()).toMatchObject({
      currentTime: 0.125,
      duration: 0.75,
    });

    await controller.play();
    expect(audio.scheduled.at(-1)?.duration).toBeCloseTo(0.25, 2);
    await controller.stop();
    expect(controller.getPlaybackSnapshot()).toMatchObject({ state: 'STOPPED', currentTime: 0 });

    await controller.dispose();
    expect(audio.closed).toBe(true);
    expect(adapter.disposed).toBe(true);
    await expect(controller.play()).rejects.toThrow('disposed');
  });

  it('emits iteration and natural completion events without leaking timers', async () => {
    vi.useFakeTimers();
    try {
      const controller = new VerovioPlaybackPrototype(new StubAdapter(), new StubAudioEngine());
      const states: string[] = [];
      const iterations: unknown[][] = [];
      controller.onPlaybackStateChange((state) => states.push(state));
      controller.onPlaybackIteration((notes) => iterations.push(notes));

      await controller.loadScore('<score-partwise />');
      await controller.playFromStep(1);
      await vi.advanceTimersByTimeAsync(600);

      expect(states).toEqual(['PLAYING', 'STOPPED']);
      expect(iterations).toContainEqual(['note-2']);
      expect(iterations.at(-1)).toEqual([]);
      expect(controller.getPlaybackSnapshot().state).toBe('STOPPED');
      await controller.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('VerovioScorePreviewController', () => {
  it('keeps the cursor at the measure start until an opening rest has elapsed', async () => {
    const container = document.createElement('div');
    const audio = new StubAudioEngine();
    const controller = new VerovioScorePreviewController({
      container,
      adapter: new OpeningRestAdapter(),
      audioEngine: audio,
    });

    await controller.loadScore('<score-partwise />');
    const page = container.querySelector<HTMLElement>('[data-score-page="1"]')!;
    const system = container.querySelector<HTMLElement>('.system')!;
    const meterSignature = container.querySelector<HTMLElement>('.meterSig')!;
    const note = container.querySelector<HTMLElement>('#note-1')!;
    page.getBoundingClientRect = () => DOMRect.fromRect({ x: 20, y: 0, width: 500, height: 300 });
    system.getBoundingClientRect = () => DOMRect.fromRect({ x: 40, y: 50, width: 440, height: 120 });
    meterSignature.getBoundingClientRect = () => DOMRect.fromRect({ x: 70, y: 60, width: 30, height: 70 });
    note.getBoundingClientRect = () => DOMRect.fromRect({ x: 180, y: 70, width: 20, height: 30 });

    controller.resetCursor();
    const cursor = container.querySelector<HTMLElement>('.score-playback-cursor')!;
    expect(cursor.style.left).toBe('88px');

    await controller.play();
    controller.syncCursorToStep(0);
    expect(cursor.style.left).toBe('88px');

    audio.currentTime = 1.1;
    controller.syncCursorToStep(0);
    expect(cursor.style.left).toBe('170px');
    expect(cursor.style.width).toBe('20px');

    controller.dispose();
  });

  it('renders pages, synchronizes the SVG cursor, resizes, and cleans up resources', async () => {
    const viewport = document.createElement('div');
    const container = document.createElement('div');
    viewport.style.overflowY = 'auto';
    viewport.append(container);
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { value: 300 });
    Object.defineProperty(viewport, 'scrollHeight', { value: 1200 });
    Object.defineProperty(viewport, 'scrollTop', { value: 0, writable: true });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const adapter = new StubAdapter();
    const audio = new StubAudioEngine();
    const controller = new VerovioScorePreviewController({
      container,
      adapter,
      audioEngine: audio,
      bpm: 120,
    });

    await controller.loadScore('<score-partwise />');
    expect(container.querySelectorAll('[data-score-page]')).toHaveLength(2);

    controller.syncCursorToStep(1);
    expect(container.querySelectorAll('.score-playback-cursor')).toHaveLength(1);
    expect(
      container.querySelector('[data-score-page="2"] .score-playback-cursor')
    ).not.toBeNull();
    expect(container.querySelector('#note-2')).not.toHaveClass('score-playback-active');
    const activeSystem = container.querySelector<HTMLElement>('[data-score-page="2"] .system');
    expect(activeSystem).not.toBeNull();
    activeSystem!.getBoundingClientRect = () => ({
      bottom: 760,
      height: 120,
      left: 0,
      right: 400,
      top: 640,
      width: 400,
      x: 0,
      y: 640,
      toJSON: () => ({}),
    });
    viewport.getBoundingClientRect = () => ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    controller.ensureCursorVisible();
    expect(scrollTo).toHaveBeenCalledWith({ top: 550, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();

    const windowScrollTo = vi.fn();
    window.scrollTo = windowScrollTo;
    controller.ensureCursorVisible({ scrollTarget: 'window', force: true });
    expect(windowScrollTo).toHaveBeenCalledWith(expect.objectContaining({
      behavior: 'smooth',
      top: expect.any(Number),
    }));
    expect(windowScrollTo.mock.calls[0][0].top).toBeGreaterThan(0);

    await controller.fitToContainer();
    expect(container.querySelectorAll('[data-score-page]')).toHaveLength(2);
    expect(
      container.querySelector('[data-score-page="1"] .score-playback-cursor')
    ).not.toBeNull();

    controller.dispose();
    expect(container).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(audio.closed).toBe(true));
    expect(adapter.disposed).toBe(true);
  });
});
