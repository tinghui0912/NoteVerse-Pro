// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { sanitizeMusicXmlForVerovio } from '@/lib/score/verovio';
import { createVerovioToolkit } from '@/lib/score/verovio/toolkit';
import { projectPerformanceTempos } from '@/lib/score/verovio/tempo-projection';
import { createVerovioPlaybackTimeline } from '@/lib/score/verovio/playback';
import { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';

const notes = ['C', 'D', 'E', 'F'].map((step, index) => `<note id="n${index}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('');
function score(flag = '', visualOffset = 2, soundOffset?: number) {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction id="tempo-mark" placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type><offset${flag}>${visualOffset}</offset><sound tempo="90">${soundOffset === undefined ? '' : `<offset>${soundOffset}</offset>`}</sound></direction>${notes}</measure></part></score-partwise>`;
}

async function render(xml: string) {
  const toolkit = await createVerovioToolkit();
  toolkit.setOptions({ inputFrom: 'xml' });
  expect(toolkit.loadData(xml)).toBeTruthy();
  const mei = new DOMParser().parseFromString(toolkit.getMEI(), 'application/xml');
  const svg = new DOMParser().parseFromString(toolkit.renderToSVG(1), 'image/svg+xml');
  const presentation = mei.querySelector('tempo[mm]')!;
  const id = presentation.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
  const marking = svg.getElementById(id!)!;
  expect(marking.querySelector('text')?.hasAttribute('x')).toBe(true);
  const timing = {
    mei: toolkit.getMEI(),
    timemap: toolkit.renderToTimemap({ includeMeasures: true }),
    expansionMap: toolkit.renderToExpansionMap(),
  };
  return {
    presentation,
    marking,
    x: Number(marking.querySelector('text')!.getAttribute('x')),
    visibleMarks: Array.from(svg.querySelectorAll('.tempo text')).map(text => text.textContent?.trim()).filter(Boolean),
    playback: Array.from(mei.querySelectorAll('measure > tempo')).filter(tempo => tempo.hasAttribute('midi.bpm')),
    timing,
    midi: toolkit.renderToMIDI(),
  };
}

describe('real Verovio direction presentation placement', () => {
  it.each([
    ['', 2, undefined, 0],
    [' sound="no"', 2, undefined, 0],
    [' sound="yes"', 2, undefined, 2],
    [' sound="yes"', 1, 2, 2],
  ] as const)('keeps visual placement and playback distinct: %s visual=%s sound=%s', async (flag, visualOffset, soundOffset, playbackQuarter) => {
    const xml = score(flag, visualOffset, soundOffset);
    const raw = await render(xml);
    const adapted = await render(sanitizeMusicXmlForVerovio(xml));
    expect(raw.presentation.getAttribute('tstamp')).toBe(String(visualOffset + 1));
    expect(adapted.presentation.getAttribute('tstamp')).toBe(String(visualOffset + 1));
    expect(adapted.presentation.hasAttribute('midi.bpm')).toBe(false);
    expect(raw.x).toBeGreaterThan(0);
    expect(adapted.x).toBe(raw.x);
    expect(adapted.visibleMarks).toEqual([raw.marking.querySelector('text')!.textContent!.trim()]);
    expect(adapted.marking.textContent).toBe(raw.marking.textContent);
    expect(adapted.playback).toHaveLength(1);
    expect(adapted.playback[0].hasAttribute('mm')).toBe(false);
    expect(adapted.playback[0].getAttribute('tstamp')).toBe(String(playbackQuarter + 1));
    const expected = playbackQuarter ? [{ quarter: 0, bpm: 80 }, { quarter: 2, bpm: 90 }] : [{ quarter: 0, bpm: 90 }];
    expect(projectPerformanceTempos(adapted.timing)).toEqual(expected);
    const timeline = createVerovioPlaybackTimeline(adapted.midi, adapted.timing);
    expect(timeline.tempoEvents).toEqual(expected);
    const times = playbackQuarter ? [0, .75, 1.5, 1.5 + 2 / 3] : [0, 2 / 3, 4 / 3, 2];
    timeline.notes.forEach((event, index) => expect(event.time).toBeCloseTo(times[index], 6));
    timeline.visualEvents.forEach((event, index) => expect(event.time).toBeCloseTo(times[index], 6));
    expect(timeline.duration).toBeCloseTo(playbackQuarter ? 1.5 + 4 / 3 : 8 / 3, 6);
  });

  it('Practice keeps the visual offset and the notation-order repeat axis in one toolkit', async () => {
    const toolkit = await createVerovioToolkit();
    const options = vi.spyOn(toolkit, 'setOptions');
    const adapter = new PracticeVerovioAdapter(async () => toolkit);
    const xml = score().replace('</measure>', '<barline location="right"><repeat direction="backward"/></barline></measure>');
    try {
      await adapter.loadMusicXml(xml);
      expect(options).toHaveBeenCalledWith(expect.objectContaining({ expandNever: true }));
      const mei = new DOMParser().parseFromString(adapter.renderPerformanceTiming().mei, 'application/xml');
      expect(mei.querySelector('tempo[mm]')?.getAttribute('tstamp')).toBe('3');
      const page = new DOMParser().parseFromString(adapter.renderAllPages()[0].svg, 'image/svg+xml');
      expect(page.querySelector('.tempo text')?.textContent).toContain('90');
      expect(adapter.renderTimemap().flatMap(event => event.on ?? [])).toEqual(['n0', 'n1', 'n2', 'n3']);
      expect([0, 1, 2, 3].map(beat => adapter.getTimelineEntryForBeat(beat)?.beat)).toEqual([0, 1, 2, 3]);
    } finally {
      adapter.dispose();
    }
  });
});
