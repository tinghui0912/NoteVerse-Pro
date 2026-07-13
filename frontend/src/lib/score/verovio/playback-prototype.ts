import type {
  ScorePlaybackController,
  ScorePlaybackSnapshot,
  ScorePlaybackState,
} from '@/lib/score-preview/contracts';
import { VerovioScoreAdapter } from './adapter';
import {
  createVerovioPlaybackTimeline,
  findVisualEventAtTime,
  type VerovioPlaybackNote,
  type VerovioPlaybackTimeline,
} from './playback-timeline';

export interface VerovioAudioEngine {
  readonly currentTime: number;
  prepare(instruments: string[]): Promise<void>;
  resume(): Promise<void>;
  schedule(note: VerovioPlaybackNote, startTime: number, duration: number): void;
  stopAll(): void;
  close(): Promise<void>;
}

export type VerovioPlaybackCursorSnapshot = {
  time: number;
  eventIndex: number | null;
  noteIds: string[];
  pageNumbers: number[];
};

export class VerovioPlaybackPrototype implements ScorePlaybackController {
  private timeline: VerovioPlaybackTimeline | null = null;
  private state: ScorePlaybackState = 'IDLE';
  private position = 0;
  private anchorTime = 0;
  private tempo = 120;
  private disposed = false;
  private eventTimers: Array<ReturnType<typeof setTimeout>> = [];
  private iterationListeners = new Set<(notes: unknown[]) => void>();
  private stateListeners = new Set<(state: ScorePlaybackState) => void>();

  constructor(
    private readonly adapter: VerovioScoreAdapter,
    private readonly audioEngine: VerovioAudioEngine
  ) {}

  async loadScore(xml: string) {
    this.assertActive();
    await this.adapter.loadMusicXml(xml);
    const timeline = createVerovioPlaybackTimeline(
      this.adapter.renderMidi(),
      this.adapter.renderTimemap()
    );
    await this.audioEngine.prepare(timeline.instruments);
    this.timeline = timeline;
    this.tempo = timeline.sourceTempo;
    this.position = 0;
    this.state = 'STOPPED';
  }

  async play() {
    const timeline = this.ensureReady();
    if (this.state === 'PLAYING') {
      return;
    }
    if (this.position >= timeline.duration) {
      this.position = 0;
    }

    await this.audioEngine.resume();
    this.anchorTime = this.audioEngine.currentTime;
    this.scheduleFromPosition(timeline, this.position);
    this.state = 'PLAYING';
    this.scheduleEventNotifications(timeline, this.position);
    this.emitState();
  }

  async pause() {
    if (this.state !== 'PLAYING') {
      return;
    }
    this.position = this.getCurrentPosition();
    this.audioEngine.stopAll();
    this.clearEventTimers();
    this.state = 'PAUSED';
    this.emitState();
  }

  async stop() {
    this.audioEngine.stopAll();
    this.clearEventTimers();
    this.position = 0;
    this.state = this.timeline ? 'STOPPED' : 'IDLE';
    this.emitState();
  }

  async playFromStep(step: number) {
    const timeline = this.ensureReady();
    const event =
      timeline.visualEvents[
        Math.min(
          Math.max(Math.floor(step), 0),
          Math.max(0, timeline.visualEvents.length - 1)
        )
      ];
    const rate = this.tempo / timeline.sourceTempo;
    await this.seek((event?.time ?? 0) / rate);
    await this.play();
  }

  async seek(time: number) {
    const timeline = this.ensureReady();
    const wasPlaying = this.state === 'PLAYING';
    this.audioEngine.stopAll();
    this.clearEventTimers();
    const rate = this.tempo / timeline.sourceTempo;
    this.position = Math.min(Math.max(time * rate, 0), timeline.duration);
    if (wasPlaying) {
      this.anchorTime = this.audioEngine.currentTime;
      this.scheduleFromPosition(timeline, this.position);
      this.scheduleEventNotifications(timeline, this.position);
    }
  }

  setTempo(bpm: number) {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error('Playback tempo must be a positive number.');
    }
    const timeline = this.ensureReady();
    const wasPlaying = this.state === 'PLAYING';
    if (wasPlaying) {
      this.position = this.getCurrentPosition();
      this.audioEngine.stopAll();
      this.clearEventTimers();
    }
    this.tempo = bpm;
    if (wasPlaying) {
      this.anchorTime = this.audioEngine.currentTime;
      this.scheduleFromPosition(timeline, this.position);
      this.scheduleEventNotifications(timeline, this.position);
    }
  }

  onPlaybackIteration(listener: (notes: unknown[]) => void) {
    this.iterationListeners.add(listener);
  }

  onPlaybackStateChange(listener: (state: ScorePlaybackState) => void) {
    this.stateListeners.add(listener);
  }

  getPlaybackSnapshot(): ScorePlaybackSnapshot {
    const timeline = this.timeline;
    const sourcePosition = timeline ? Math.min(this.getCurrentPosition(), timeline.duration) : 0;
    const rate = timeline ? this.tempo / timeline.sourceTempo : 1;
    const eventIndex = timeline
      ? findVisualEventAtTime(timeline, sourcePosition)?.index ?? 0
      : 0;
    return {
      state: this.state,
      currentStep: eventIndex,
      totalSteps: timeline?.visualEvents.length ?? 0,
      currentTime: sourcePosition / rate,
      duration: timeline ? timeline.duration * (timeline.sourceTempo / this.tempo) : 0,
    };
  }

  getCursorSnapshot(): VerovioPlaybackCursorSnapshot {
    const timeline = this.ensureReady();
    const time = Math.min(this.getCurrentPosition(), timeline.duration);
    const event = findVisualEventAtTime(timeline, time);
    return this.createCursorSnapshot(event, time);
  }

  getCursorSnapshotForStep(step: number): VerovioPlaybackCursorSnapshot {
    const timeline = this.ensureReady();
    const event =
      timeline.visualEvents[
        Math.min(
          Math.max(Math.floor(step), 0),
          Math.max(0, timeline.visualEvents.length - 1)
        )
      ] ?? null;
    return this.createCursorSnapshot(event, event?.time ?? 0);
  }

  private createCursorSnapshot(
    event: VerovioPlaybackTimeline['visualEvents'][number] | null,
    time: number
  ): VerovioPlaybackCursorSnapshot {
    const pageNumbers = event
      ? Array.from(
          new Set(
            event.noteIds
              .map((noteId) => this.adapter.getPageWithElement(noteId))
              .filter((pageNumber) => pageNumber > 0)
          )
        )
      : [];
    return {
      time,
      eventIndex: event?.index ?? null,
      noteIds: event?.noteIds ?? [],
      pageNumbers,
    };
  }

  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.audioEngine.stopAll();
    this.clearEventTimers();
    await this.audioEngine.close();
    this.adapter.dispose();
    this.timeline = null;
    this.state = 'IDLE';
    this.iterationListeners.clear();
    this.stateListeners.clear();
  }

  private scheduleFromPosition(timeline: VerovioPlaybackTimeline, position: number) {
    const rate = this.tempo / timeline.sourceTempo;
    for (const note of timeline.notes) {
      const noteEnd = note.time + note.duration;
      if (noteEnd <= position) {
        continue;
      }
      const remainingSourceDuration = noteEnd - Math.max(note.time, position);
      const delay = Math.max(0, note.time - position) / rate;
      this.audioEngine.schedule(
        note,
        this.audioEngine.currentTime + delay,
        remainingSourceDuration / rate
      );
    }
  }

  private scheduleEventNotifications(timeline: VerovioPlaybackTimeline, position: number) {
    this.clearEventTimers();
    const rate = this.tempo / timeline.sourceTempo;
    for (const event of timeline.visualEvents) {
      if (event.time < position) {
        continue;
      }
      const delay = ((event.time - position) / rate) * 1000;
      this.eventTimers.push(
        setTimeout(() => {
          if (this.state === 'PLAYING' && !this.disposed) {
            for (const listener of this.iterationListeners) {
              listener(event.noteIds);
            }
          }
        }, delay)
      );
    }

    const remainingDuration = Math.max(0, timeline.duration - position) / rate;
    this.eventTimers.push(
      setTimeout(() => {
        if (this.state !== 'PLAYING' || this.disposed) {
          return;
        }
        this.audioEngine.stopAll();
        this.position = 0;
        this.state = 'STOPPED';
        for (const listener of this.iterationListeners) {
          listener([]);
        }
        this.emitState();
        this.clearEventTimers();
      }, remainingDuration * 1000)
    );
  }

  private clearEventTimers() {
    for (const timer of this.eventTimers) {
      clearTimeout(timer);
    }
    this.eventTimers = [];
  }

  private emitState() {
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }

  private getCurrentPosition() {
    if (this.state !== 'PLAYING' || !this.timeline) {
      return this.position;
    }
    const rate = this.tempo / this.timeline.sourceTempo;
    return this.position + (this.audioEngine.currentTime - this.anchorTime) * rate;
  }

  private ensureReady() {
    this.assertActive();
    if (!this.timeline) {
      throw new Error('Verovio playback is not ready.');
    }
    return this.timeline;
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('Verovio playback has been disposed.');
    }
  }
}
