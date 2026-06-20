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
      { pageNumber: 1, svg: '<svg><g id="note-1"><path /></g></svg>' },
      { pageNumber: 2, svg: '<svg><g id="note-2"><path /></g></svg>' },
    ];
  }

  override relayout() {
    return this.renderAllPages();
  }

  override dispose() {
    this.disposed = true;
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
  it('renders pages, synchronizes the SVG cursor, resizes, and cleans up resources', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
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
    expect(container.querySelector('#note-2')).toHaveClass('score-playback-active');
    expect(container.querySelector('#note-1')).not.toHaveClass('score-playback-active');

    await controller.fitToContainer();
    expect(container.querySelectorAll('[data-score-page]')).toHaveLength(2);
    expect(container.querySelector('#note-1')).toHaveClass('score-playback-active');

    controller.dispose();
    expect(container).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(audio.closed).toBe(true));
    expect(adapter.disposed).toBe(true);
  });
});
