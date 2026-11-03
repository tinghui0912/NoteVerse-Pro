// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { VerovioScoreAdapter } from '@/lib/score/verovio';
import { createVerovioPlaybackTimeline } from '@/lib/score/verovio/playback';

const note = (id: string, duration = 1) => `<note id="${id}"><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><type>${duration === 4 ? 'whole' : 'quarter'}</type></note>`;
const direction = (bpm: number, notation = '') => `<direction>${notation}<sound tempo="${bpm}"/></direction>`;
const score = (body: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${body}</measure></part></score-partwise>`;
const metronome = (unit: string, rate: number, dotted = false) => `<direction-type><metronome><beat-unit>${unit}</beat-unit>${dotted ? '<beat-unit-dot/>' : ''}<per-minute>${rate}</per-minute></metronome></direction-type>`;

async function render(xml: string) {
  const adapter = new VerovioScoreAdapter();
  try {
    await adapter.loadMusicXml(xml);
    return createVerovioPlaybackTimeline(adapter.renderMidi(), adapter.renderPerformanceTiming());
  } finally {
    adapter.dispose();
  }
}

describe('real Verovio Score Preview performance chronology', () => {
  it.each([
    ['<direction><offset>2</offset><sound tempo="90"/></direction>', 0],
    ['<direction><offset sound="no">2</offset><sound tempo="90"/></direction>', 0],
    ['<direction><offset sound="yes">2</offset><sound tempo="90"/></direction>', 2],
    ['<sound tempo="90"><offset>2</offset></sound>', 2],
    ['<direction><offset sound="yes">1</offset><sound tempo="90"><offset>2</offset></sound></direction>', 2],
  ] as const)('positions effective sound playback in real renderer MEI, audio and cursor: %s', async (notation, quarter) => {
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(score(notation + note('one') + note('two') + note('three') + note('four')));
      const renderer = adapter.renderPerformanceTiming();
      const mei = new DOMParser().parseFromString(renderer.mei, 'application/xml');
      expect(mei.querySelector('tempo[midi\\.bpm]')?.getAttribute('tstamp')).toBe(String(quarter + 1));
      const timeline = createVerovioPlaybackTimeline(adapter.renderMidi(), renderer);
      expect(timeline.tempoEvents).toEqual(quarter ? [{ quarter: 0, bpm: 80 }, { quarter, bpm: 90 }] : [{ quarter: 0, bpm: 90 }]);
      const onsets = quarter ? [0, .75, 1.5, 1.5 + 2 / 3] : [0, 2 / 3, 4 / 3, 2];
      timeline.notes.forEach((event, index) => expect(event.time).toBeCloseTo(onsets[index], 6));
      timeline.visualEvents.forEach((event, index) => expect(event.time).toBeCloseTo(onsets[index], 6));
      expect(timeline.duration).toBeCloseTo(quarter ? 1.5 + 4 / 3 : 8 / 3, 6);
    } finally {
      adapter.dispose();
    }
  });
  it.each([
    ['', 80],
    [direction(90), 90],
    [direction(120, metronome('half', 60)), 120],
    [direction(90, metronome('quarter', 60, true)), 90],
    [direction(60, metronome('eighth', 120)), 60],
  ])('uses canonical renderer quarter BPM for %s', async (notation, bpm) => {
    const timeline = await render(score(notation + note('one', 4)));
    expect(timeline.tempoEvents).toEqual([{ quarter: 0, bpm }]);
    expect(timeline.duration).toBeCloseTo(4 * 60 / bpm, 6);
    expect(timeline.notes[0].time).toBe(0);
  });

  it.each([direction(90, metronome('quarter', 90)), '<sound tempo="90"/>'])('real first-measure late tempo starts audio and cursor at the product default: %s', async notation => {
    const timeline = await render(score(note('early1') + note('early2') + notation + note('late1') + note('late2')));
    expect(timeline.tempoEvents).toEqual([{ quarter: 0, bpm: 80 }, { quarter: 2, bpm: 90 }]);
    expect(timeline.sourceTempo).toBe(80);
    const onsets = [0, .75, 1.5, 1.5 + 2 / 3];
    timeline.notes.forEach((note, index) => expect(note.time).toBeCloseTo(onsets[index], 6));
    timeline.visualEvents.forEach((event, index) => expect(event.time).toBeCloseTo(onsets[index], 6));
    expect(timeline.visualEvents[2].noteIds).toContain('late1');
    expect(timeline.duration).toBeCloseTo(1.5 + 4 / 3, 6);
    // Actual MIDI articulation is retained while note durations use the projected tempo.
    expect(timeline.notes[2].duration).toBeGreaterThan(.6);
    expect(timeline.notes[2].duration).toBeLessThanOrEqual(2 / 3);
  });

  it('preserves multiple first-measure changes for both notes and cursor', async () => {
    const timeline = await render(score(note('one') + direction(90) + note('two') + direction(100) + note('three') + note('four')));
    expect(timeline.tempoEvents).toEqual([{ quarter: 0, bpm: 80 }, { quarter: 1, bpm: 90 }, { quarter: 2, bpm: 100 }]);
    const times = [0, .75, .75 + 2 / 3, .75 + 2 / 3 + .6];
    timeline.notes.forEach((note, index) => expect(note.time).toBeCloseTo(times[index], 6));
    timeline.visualEvents.forEach((event, index) => expect(event.time).toBeCloseTo(times[index], 6));
  });

  it('consumes the renderer simple-repeat performance expansion and its tempo occurrences', async () => {
    const xml = score(direction(90) + note('m1', 4) + '<barline location="left"><repeat direction="forward"/></barline>')
      .replace('</part>', `<measure number="2">${direction(100)}${note('m2', 4)}<barline location="right"><repeat direction="backward"/></barline></measure></part>`);
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(xml);
      const midi = adapter.renderMidi();
      const renderer = adapter.renderPerformanceTiming();
      const timeline = createVerovioPlaybackTimeline(midi, renderer);
      expect(renderer.timemap.flatMap(event => event.on ?? [])).toEqual(['m1', 'm2', 'm1-rend2', 'm2-rend2']);
      expect(timeline.tempoEvents).toEqual([0, 4, 8, 12].map((quarter, index) => ({ quarter, bpm: index % 2 ? 100 : 90 })));
      expect(timeline.notes).toHaveLength(4);
      expect(timeline.visualEvents.map(event => event.noteIds[0])).toEqual(['m1', 'm2', 'm1', 'm2']);
      const times = [0, 8 / 3, 8 / 3 + 2.4, 16 / 3 + 2.4];
      timeline.notes.forEach((note, index) => expect(note.time).toBeCloseTo(times[index], 6));
      timeline.visualEvents.forEach((event, index) => expect(event.time).toBeCloseTo(times[index], 6));
      const pages = adapter.renderAllPages();
      for (const event of timeline.visualEvents) {
        const identity = event.noteIds[0];
        const pageNumber = adapter.getPageWithElement(identity);
        expect(pageNumber).toBeGreaterThan(0);
        const document = new DOMParser().parseFromString(pages[pageNumber - 1].svg, 'image/svg+xml');
        expect(document.querySelector(`[id="${identity}"], [data-id="${identity}"]`)).not.toBeNull();
      }
      expect(timeline.duration).toBeCloseTo(16 / 3 + 4.8, 6);
    } finally {
      adapter.dispose();
    }
  });
});
