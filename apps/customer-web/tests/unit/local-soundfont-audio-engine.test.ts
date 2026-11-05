import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as Soundfont from 'soundfont-player';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocalSoundfontAudioEngine } from '@/lib/score-preview/local-soundfont-audio-engine';
import { requireLocalSoundfont } from '@/lib/score-preview/local-soundfont-manifest';
import { Rational } from '@/lib/score/performance/rational';
import type { ScorePlaybackNote } from '@/lib/score/performance/timeline';

vi.mock('soundfont-player', () => ({ instrument: vi.fn() }));

const note = (instrument = 'acoustic_grand_piano'): ScorePlaybackNote => ({
  identity: 'written@0',
  occurrenceOrdinal: 0,
  sourceTrackIdentity: 0,
  performanceStart: new Rational(0n),
  performanceEnd: new Rational(1n),
  midi: 60,
  time: 0,
  duration: 0.75,
  velocity: 0.01,
  instrument,
});
const context = () => ({
  currentTime: 12,
  state: 'suspended',
  resume: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
});
let player: { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetAllMocks();
  player = { play: vi.fn(), stop: vi.fn() };
  vi.mocked(Soundfont.instrument).mockResolvedValue(
    player as unknown as Soundfont.Player
  );
});

it('describes exactly the shipped local soundfont asset', () => {
  const asset = requireLocalSoundfont('acoustic_grand_piano');
  expect(Object.isFrozen(asset)).toBe(true);
  expect(asset).toEqual({
    instrument: 'acoustic_grand_piano',
    soundfont: 'MusyngKite',
    format: 'mp3',
    url: '/soundfonts/MusyngKite/acoustic_grand_piano-mp3.js',
  });
  expect(existsSync(path.resolve('public', asset.url.slice(1)))).toBe(true);
  expect(
    readdirSync(path.resolve('public/soundfonts'), { recursive: true }).filter(
      (file) => String(file).endsWith('.js')
    )
  ).toEqual([path.join('MusyngKite', 'acoustic_grand_piano-mp3.js')]);
});

it('prepares and schedules the exact local piano, retaining note velocity', async () => {
  const audio = context();
  const engine = new LocalSoundfontAudioEngine(
    audio as unknown as AudioContext
  );
  await engine.prepare(['acoustic_grand_piano', 'acoustic_grand_piano']);
  await engine.prepare(['acoustic_grand_piano']);
  expect(Soundfont.instrument).toHaveBeenCalledTimes(1);
  const [actualContext, name, options] = vi.mocked(Soundfont.instrument).mock
    .calls[0];
  expect(actualContext).toBe(audio);
  expect(name).toBe('acoustic_grand_piano');
  expect(
    options?.nameToUrl?.('acoustic_grand_piano', 'MusyngKite', 'mp3')
  ).toBe(requireLocalSoundfont(name).url);
  await engine.resume();
  expect(audio.resume).toHaveBeenCalledOnce();
  engine.schedule(note(), 13, 0.75);
  expect(player.play).toHaveBeenCalledWith('60', 13, {
    duration: 0.75,
    gain: 0.01,
  });
  engine.stopAll();
  await engine.close();
  await engine.close();
  expect(audio.close).toHaveBeenCalledOnce();
  expect(() => engine.schedule(note(), 0, 1)).toThrow('closed');
});

it.each(['violin', 'flute', 'standard_kit', 'percussion', '', '__proto__'])(
  'rejects unsupported %s before any asset load',
  async (instrument) => {
    const engine = new LocalSoundfontAudioEngine(
      context() as unknown as AudioContext
    );
    await expect(
      engine.prepare(['acoustic_grand_piano', instrument])
    ).rejects.toThrow('unsupported_score_preview_instrument');
    expect(Soundfont.instrument).not.toHaveBeenCalled();
    await engine.close();
  }
);

it('checks scheduling against the same capability authority even with piano already prepared', async () => {
  const engine = new LocalSoundfontAudioEngine(
    context() as unknown as AudioContext
  );
  await engine.prepare(['acoustic_grand_piano']);
  expect(() => engine.schedule(note('violin'), 0, 1)).toThrow(
    'unsupported_score_preview_instrument: violin'
  );
  expect(player.play).not.toHaveBeenCalled();
  await engine.close();
});

it('propagates asset decode failure and installs no playable instrument', async () => {
  const failure = new Error('local asset decode failed');
  vi.mocked(Soundfont.instrument).mockRejectedValueOnce(failure);
  const engine = new LocalSoundfontAudioEngine(
    context() as unknown as AudioContext
  );
  await expect(engine.prepare(['acoustic_grand_piano'])).rejects.toBe(failure);
  expect(() => engine.schedule(note(), 0, 1)).toThrow('not prepared');
  expect(Soundfont.instrument).toHaveBeenCalledOnce();
  await engine.close();
});

it('releases a late asset result if the engine closed during preparation', async () => {
  let resolve!: (player: Soundfont.Player) => void;
  vi.mocked(Soundfont.instrument).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const engine = new LocalSoundfontAudioEngine(
    context() as unknown as AudioContext
  );
  const loading = engine.prepare(['acoustic_grand_piano']);
  await engine.close();
  resolve(player as unknown as Soundfont.Player);
  await expect(loading).rejects.toThrow('closed');
  expect(player.stop).toHaveBeenCalledOnce();
});

it('shares an in-flight asset load across superseding score preparations', async () => {
  let resolve!: (player: Soundfont.Player) => void;
  vi.mocked(Soundfont.instrument).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const engine = new LocalSoundfontAudioEngine(
    context() as unknown as AudioContext
  );
  const first = engine.prepare(['acoustic_grand_piano']);
  const second = engine.prepare(['acoustic_grand_piano']);
  expect(Soundfont.instrument).toHaveBeenCalledOnce();
  resolve(player as unknown as Soundfont.Player);
  await Promise.all([first, second]);
  engine.schedule(note(), 0, 1);
  engine.stopAll();
  expect(player.play).toHaveBeenCalledOnce();
  expect(player.stop).toHaveBeenCalledOnce();
  await engine.close();
});
