import * as Soundfont from 'soundfont-player';

import type { ScorePlaybackNote } from '@/lib/score/performance/timeline';
import type { ScorePreviewAudioEngine } from './playback-controller';

import { requireLocalSoundfont } from './local-soundfont-manifest';

export class LocalSoundfontAudioEngine implements ScorePreviewAudioEngine {
  private readonly context: AudioContext;
  private readonly players = new Map<string, Soundfont.Player>();
  private readonly loading = new Map<string, Promise<void>>();
  private closed = false;

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context;
  }

  get currentTime() {
    return this.context.currentTime;
  }

  async prepare(instruments: readonly string[]) {
    this.assertOpen();
    const requested = [...new Set(instruments)].map(requireLocalSoundfont);
    await Promise.all(
      requested.map((asset) => {
        const instrument = asset.instrument;
        if (this.players.has(instrument)) {
          return;
        }
        const pending = this.loading.get(instrument);
        if (pending) return pending;
        const loading = Soundfont.instrument(this.context, instrument, {
          soundfont: asset.soundfont,
          format: asset.format,
          nameToUrl: () => asset.url,
        })
          .then((player) => {
            if (this.closed) {
              player.stop();
              throw new Error('Local soundfont audio engine is closed.');
            }
            this.players.set(instrument, player);
          })
          .finally(() => this.loading.delete(instrument));
        this.loading.set(instrument, loading);
        return loading;
      })
    );
  }

  async resume() {
    this.assertOpen();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  schedule(note: ScorePlaybackNote, startTime: number, duration: number) {
    this.assertOpen();
    const { instrument } = requireLocalSoundfont(note.instrument);
    const player = this.players.get(instrument);
    if (!player) {
      throw new Error(`Soundfont instrument is not prepared: ${instrument}`);
    }
    player.play(String(note.midi), startTime, {
      duration,
      gain: note.velocity,
    });
  }

  stopAll() {
    for (const player of this.players.values()) {
      player.stop();
    }
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopAll();
    this.players.clear();
    this.loading.clear();
    if (this.context.state !== 'closed') {
      await this.context.close();
    }
  }

  private assertOpen() {
    if (this.closed) {
      throw new Error('Local soundfont audio engine is closed.');
    }
  }
}
