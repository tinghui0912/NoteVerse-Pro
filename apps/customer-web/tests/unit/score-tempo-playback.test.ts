// @vitest-environment jsdom

import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { VerovioScoreAdapter } from '@/lib/score/verovio';
import { createVerovioPlaybackTimeline } from '@/lib/score/verovio/playback';

describe('Score tempo playback chronology', () => {
  it.each([{ tempos: [] }, { tempos: [{ ticks: 960, bpm: 90 }] }])('uses the product default only before the first MIDI directive: %j', ({ tempos }) => {
    const midi = new Midi();
    midi.header.tempos = tempos;
    midi.header.update();
    midi.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 1920 });
    const timeline = createVerovioPlaybackTimeline(btoa(String.fromCharCode(...midi.toArray())), []);
    expect(timeline.sourceTempo).toBe(120);
    expect(timeline.duration).toBeCloseTo(tempos.length ? 1 + 2 * 60 / 90 : 2, 5);
  });

  it.each([
    ['', 120],
    ['<sound tempo="132"/>', 132],
    ['<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>', 120],
    ['<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type><sound tempo="90"/></direction>', 90],
    ['<direction><direction-type><metronome><beat-unit>eighth</beat-unit><per-minute>120</per-minute></metronome></direction-type></direction>', 60],
  ])('uses rendered MIDI natural tempo for %s', async (notation, bpm) => {
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notation}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);
      const timeline = createVerovioPlaybackTimeline(adapter.renderMidi(), adapter.renderTimemap());
      expect(timeline.sourceTempo).toBeCloseTo(bpm, 3);
      expect(timeline.notes[0].time).toBe(0);
      expect(timeline.notes[0].duration).toBeGreaterThan(0);
    } finally {
      adapter.dispose();
    }
  });
});
