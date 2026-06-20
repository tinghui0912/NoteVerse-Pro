import * as Soundfont from 'soundfont-player';

import type { VerovioPlaybackNote } from './playback-timeline';
import type { VerovioAudioEngine } from './playback-prototype';

const LOCAL_INSTRUMENTS = new Set(['acoustic_grand_piano']);
type SoundfontInstrumentName = Parameters<typeof Soundfont.instrument>[1];

export class SoundfontAudioEngine implements VerovioAudioEngine {
  private readonly context: AudioContext;
  private readonly players = new Map<string, Soundfont.Player>();
  private closed = false;

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context;
  }

  get currentTime() {
    return this.context.currentTime;
  }

  async prepare(instruments: string[]) {
    this.assertOpen();
    const resolvedInstruments = Array.from(
      new Set(instruments.map((instrument) => this.resolveInstrument(instrument)))
    );
    await Promise.all(
      resolvedInstruments.map(async (instrument) => {
        if (this.players.has(instrument)) {
          return;
        }
        const player = await Soundfont.instrument(this.context, instrument, {
          soundfont: 'MusyngKite',
          format: 'mp3',
          nameToUrl: (name: string) => `/soundfonts/MusyngKite/${name}-mp3.js`,
        });
        this.players.set(instrument, player);
      })
    );
  }

  async resume() {
    this.assertOpen();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  schedule(note: VerovioPlaybackNote, startTime: number, duration: number) {
    this.assertOpen();
    const instrument = this.resolveInstrument(note.instrument);
    const player = this.players.get(instrument);
    if (!player) {
      throw new Error(`Soundfont instrument is not prepared: ${instrument}`);
    }
    player.play(String(note.midi), startTime, {
      duration,
      gain: Math.max(0.05, note.velocity),
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
    if (this.context.state !== 'closed') {
      await this.context.close();
    }
  }

  private resolveInstrument(instrument: string) {
    return (
      LOCAL_INSTRUMENTS.has(instrument) ? instrument : 'acoustic_grand_piano'
    ) as SoundfontInstrumentName;
  }

  private assertOpen() {
    if (this.closed) {
      throw new Error('Soundfont audio engine is closed.');
    }
  }
}
