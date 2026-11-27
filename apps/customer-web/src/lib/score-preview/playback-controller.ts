import { compilePerformancePlan } from '@/lib/api/performance-plan';
import type {
  ScorePlaybackController,
  ScorePlaybackSnapshot,
  ScorePlaybackState,
} from '@/lib/score-preview/contracts';
import { VerovioScoreAdapter } from '@/lib/score/verovio/adapter';
import {
  createScorePerformanceTimeline,
  findVisualEventAtTime,
  type ScorePlaybackNote,
  type ScorePerformanceTimeline,
} from '@/lib/score/performance/timeline';

export interface ScorePreviewAudioEngine {
  readonly currentTime: number;
  prepare(instruments: readonly string[]): Promise<void>;
  resume(): Promise<void>;
  schedule(note: ScorePlaybackNote, startTime: number, duration: number): void;
  stopAll(): void;
  close(): Promise<void>;
}

export type ScorePreviewPlaybackCursorSnapshot = {
  time: number;
  eventIndex: number | null;
  noteIds: readonly string[];
  pageNumbers: number[];
};

export class ScorePreviewPlaybackController implements ScorePlaybackController {
  private timeline: ScorePerformanceTimeline | null = null;
  private state: ScorePlaybackState = 'IDLE';
  private position = 0;
  private anchorTime = 0;
  private tempo = 0;
  private loadAbort: AbortController | null = null;
  private disposed = false;
  private eventTimers: Array<ReturnType<typeof setTimeout>> = [];
  private iterationListeners = new Set<(notes: unknown[]) => void>();
  private stateListeners = new Set<(state: ScorePlaybackState) => void>();

  constructor(
    private readonly adapter: VerovioScoreAdapter,
    private readonly audioEngine: ScorePreviewAudioEngine
  ) {}

  async loadScore(xml: string) {
    this.assertActive();
    this.clearScore();
    const request = new AbortController();
    this.loadAbort = request;
    try {
      const plan = await compilePerformancePlan(xml, request.signal);
      request.signal.throwIfAborted();
      await this.adapter.loadMusicXml(plan.musicxml, {
        toolkitOptions: { expandNever: true },
      });
      request.signal.throwIfAborted();
      const timeline = createScorePerformanceTimeline(
        plan,
        this.adapter.renderMidi(),
        this.adapter.renderTimemap()
      );
      if (timeline.notes.length && !timeline.visualEvents.length) {
        throw new Error('Missing written visual realization.');
      }
      for (const id of new Set(
        timeline.visualEvents.flatMap((event) => event.noteIds)
      )) {
        const page = this.adapter.getPageWithElement(id);
        if (!Number.isSafeInteger(page) || page <= 0) {
          throw new Error('Written visual note has no score page.');
        }
      }
      await this.audioEngine.prepare(timeline.instruments);
      request.signal.throwIfAborted();
      this.timeline = timeline;
      this.tempo = timeline.referenceTempoBpm;
      this.position = 0;
      this.state = 'STOPPED';
    } catch (error) {
      if (this.loadAbort === request) this.clearScore();
      throw error;
    }
  }

  clearScore() {
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.audioEngine.stopAll();
    this.clearEventTimers();
    this.timeline = null;
    this.state = 'IDLE';
    this.position = 0;
    this.tempo = 0;
    this.adapter.dispose();
    this.emitState();
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
    const rate = this.tempo / timeline.referenceTempoBpm;
    await this.seek((event?.time ?? 0) / rate);
    await this.play();
  }

  async seek(time: number) {
    const timeline = this.ensureReady();
    const wasPlaying = this.state === 'PLAYING';
    this.audioEngine.stopAll();
    this.clearEventTimers();
    const rate = this.tempo / timeline.referenceTempoBpm;
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
    const sourcePosition = timeline
      ? Math.min(this.getCurrentPosition(), timeline.duration)
      : 0;
    const rate = timeline ? this.tempo / timeline.referenceTempoBpm : 1;
    const eventIndex = timeline
      ? (findVisualEventAtTime(timeline, sourcePosition)?.index ?? 0)
      : 0;
    return {
      state: this.state,
      currentStep: eventIndex,
      totalSteps: timeline?.visualEvents.length ?? 0,
      currentTime: sourcePosition / rate,
      duration: timeline
        ? timeline.duration * (timeline.referenceTempoBpm / this.tempo)
        : 0,
    };
  }

  getCursorSnapshot(): ScorePreviewPlaybackCursorSnapshot {
    const timeline = this.ensureReady();
    const time = Math.min(this.getCurrentPosition(), timeline.duration);
    const event = findVisualEventAtTime(timeline, time);
    return this.createCursorSnapshot(event, time);
  }

  getCursorSnapshotForStep(step: number): ScorePreviewPlaybackCursorSnapshot {
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
    event: ScorePerformanceTimeline['visualEvents'][number] | null,
    time: number
  ): ScorePreviewPlaybackCursorSnapshot {
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
      time: time / (this.tempo / this.ensureReady().referenceTempoBpm),
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
    this.loadAbort?.abort();
    this.audioEngine.stopAll();
    this.clearEventTimers();
    await this.audioEngine.close();
    this.adapter.dispose();
    this.timeline = null;
    this.state = 'IDLE';
    this.iterationListeners.clear();
    this.stateListeners.clear();
  }

  private scheduleFromPosition(
    timeline: ScorePerformanceTimeline,
    position: number
  ) {
    const rate = this.tempo / timeline.referenceTempoBpm;
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

  private scheduleEventNotifications(
    timeline: ScorePerformanceTimeline,
    position: number
  ) {
    this.clearEventTimers();
    const rate = this.tempo / timeline.referenceTempoBpm;
    for (const event of timeline.visualEvents) {
      if (event.time < position) {
        continue;
      }
      const delay = ((event.time - position) / rate) * 1000;
      this.eventTimers.push(
        setTimeout(() => {
          if (this.state === 'PLAYING' && !this.disposed) {
            for (const listener of this.iterationListeners) {
              listener([...event.noteIds]);
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
    const rate = this.tempo / this.timeline.referenceTempoBpm;
    return (
      this.position + (this.audioEngine.currentTime - this.anchorTime) * rate
    );
  }

  private ensureReady() {
    this.assertActive();
    if (!this.timeline) {
      throw new Error('Score Preview playback is not ready.');
    }
    return this.timeline;
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('Score Preview playback has been disposed.');
    }
  }
}
