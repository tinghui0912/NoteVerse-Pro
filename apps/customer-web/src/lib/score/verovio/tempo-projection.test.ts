// @vitest-environment jsdom
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { createVerovioPlaybackTimeline } from './playback-timeline';
import { projectPerformanceTempos, type VerovioPerformanceTiming } from './tempo-projection';

function timing(tempos: string): VerovioPerformanceTiming {
  return {
    mei: `<mei xmlns="http://www.music-encoding.org/ns/mei"><staffDef n="1"><meterSig unit="8"/></staffDef><measure xml:id="m1">${tempos}</measure></mei>`,
    timemap: [{ measureOn: 'm1', qstamp: 0 }],
    expansionMap: {},
  };
}
const tempo = (bpm: string, timestamp = '5') => `<tempo staff="1" tstamp="${timestamp}" midi.bpm="${bpm}"/>`;

describe('renderer performance tempo projection', () => {
  it('uses positioned facts while the renderer scoreDef scalar cannot establish an origin tempo', () => {
    const input = timing(tempo('90'));
    input.mei = input.mei.replace('<staffDef', '<scoreDef midi.bpm="90"/><staffDef');
    expect(projectPerformanceTempos(input)).toEqual([
      { quarter: 0, bpm: 80 }, { quarter: 2, bpm: 90 },
    ]);
  });

  it('uses renderer meter units, timestamps and expanded measure starts', () => {
    const input = timing(tempo('90'));
    input.timemap.push({ measureOn: 'm1-rend2', qstamp: 4 });
    input.expansionMap.m1 = ['m1', 'm1-rend2'];
    expect(projectPerformanceTempos(input)).toEqual([
      { quarter: 0, bpm: 80 }, { quarter: 2, bpm: 90 }, { quarter: 6, bpm: 90 },
    ]);
  });

  it('accepts matching facts at one performance position', () => {
    expect(projectPerformanceTempos(timing(tempo('90') + tempo('90')))).toEqual([
      { quarter: 0, bpm: 80 }, { quarter: 2, bpm: 90 },
    ]);
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '90bpm', ''])('rejects invalid renderer quarter BPM %j', bpm => {
    expect(() => projectPerformanceTempos(timing(tempo(bpm)))).toThrow();
  });

  it('rejects conflicting performance facts', () => {
    expect(() => projectPerformanceTempos(timing(tempo('90') + tempo('100')))).toThrow('Conflicting');
  });

  it('rejects unpositioned or pre-origin facts', () => {
    const missing = timing(tempo('90'));
    missing.timemap = [];
    expect(() => projectPerformanceTempos(missing)).toThrow('measure position');
    expect(() => projectPerformanceTempos(timing(tempo('90', '0')))).toThrow();
  });

  it('requires canonical quarter BPM instead of interpreting MEI metronome notation', () => {
    expect(() => projectPerformanceTempos(timing('<tempo tstamp="1" mm="60" mm.unit="2"/>'))).toThrow('canonical quarter BPM');
  });

  it.each([120, 173])('rebuilds engine %i MIDI tempo before deriving notes, and uses qstamp for cursor time', engineBpm => {
    const midi = new Midi();
    midi.header.setTempo(engineBpm);
    midi.addTrack().addNote({ midi: 60, ticks: 480, durationTicks: 960 });
    const input = timing(tempo('90'));
    input.expansionMap['renderer-occurrence'] = ['note', 'renderer-occurrence'];
    input.timemap.push({ on: ['renderer-occurrence'], qstamp: 1, tstamp: 999999 });
    input.timemap.push({ off: ['note'], qstamp: 3, tstamp: 999999 });
    const timeline = createVerovioPlaybackTimeline(btoa(String.fromCharCode(...midi.toArray())), input);
    expect(timeline.notes[0].time).toBeCloseTo(.75, 6);
    expect(timeline.notes[0].duration).toBeCloseTo(.75 + 2 / 3, 6);
    expect(timeline.visualEvents[0].time).toBeCloseTo(.75, 6);
    expect(timeline.visualEvents[0].noteIds).toEqual(['note']);
    expect(timeline.duration).toBeCloseTo(1.5 + 2 / 3, 6);
  });
});
