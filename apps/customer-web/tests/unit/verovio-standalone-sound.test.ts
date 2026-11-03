// @vitest-environment jsdom
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { VerovioScoreAdapter, sanitizeMusicXmlForVerovio } from '@/lib/score/verovio';
import { createVerovioToolkit } from '@/lib/score/verovio/toolkit';
import { createVerovioPlaybackTimeline } from '@/lib/score/verovio/playback';

const note = (id: string, step: string) => `<note id="${id}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`;
// A D.C. section, optionally ending at Fine on its second pass.
function navigationScore(fine = false, tempo = '') {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note('a', 'C')}${fine ? '<sound fine="yes"/>' : ''}</measure><measure number="2"><sound dacapo="yes"${tempo ? ` tempo="${tempo}"` : ''}/>${note('b', 'D')}</measure></part></score-partwise>`;
}
async function rawRender(xml: string) {
  const toolkit = await createVerovioToolkit();
  toolkit.setOptions({ inputFrom: 'xml' });
  expect(toolkit.loadData(xml)).toBeTruthy();
  const midi = new Midi(Uint8Array.from(atob(toolkit.renderToMIDI()), character => character.charCodeAt(0)));
  return {
    onsets: toolkit.renderToTimemap({ includeMeasures: true }).filter(event => Array.isArray(event.on)).map(event => ({ quarter: event.qstamp, ids: event.on })),
    expansion: toolkit.renderToExpansionMap(),
    noteCount: midi.tracks.reduce((count, track) => count + track.notes.length, 0),
  };
}

describe('standalone sound renderer adaptation', () => {
  it.each([false, true])('preserves real Verovio D.C. expansion with Fine=%s', async fine => {
    const xml = navigationScore(fine);
    const raw = await rawRender(xml);
    const adapted = await rawRender(sanitizeMusicXmlForVerovio(xml));
    const expected = ['a', 'b', 'a-rend2', ...(fine ? [] : ['b-rend2'])];
    expect(raw.onsets).toEqual(expected.map((id, index) => ({ quarter: index * 4, ids: [id] })));
    expect(raw.expansion.a).toEqual(['a', 'a-rend2']);
    expect(raw.noteCount).toBe(expected.length);
    expect(adapted.onsets).toEqual(raw.onsets);
    expect(adapted.expansion.a).toEqual(raw.expansion.a);
    expect(adapted.noteCount).toBe(raw.noteCount);
  });

  it.each(['dacapo="yes"', 'dalsegno="segno-1"', 'tocoda="coda-1"', 'fine="yes"', 'segno="segno-1"', 'coda="coda-1"', 'forward-repeat="yes"'])('preserves a non-tempo standalone sound at its original location: %s', attributes => {
    const sound = `<sound ${attributes}/>`;
    const xml = `<score-partwise><part><measure>${sound}</measure></part></score-partwise>`;
    const document = new DOMParser().parseFromString(sanitizeMusicXmlForVerovio(xml), 'application/xml');
    const original = document.querySelector('measure > sound');
    expect(original).not.toBeNull();
    expect(new XMLSerializer().serializeToString(original!)).toBe(sound);
    expect(document.querySelector('direction')).toBeNull();
  });

  it('keeps the original tempo/navigation/tuning element and projects only the literal tempo attribute', () => {
    const source = '<sound id="original" tempo="90.0" dacapo="yes" dynamics="70" time-only="1"><play><other-play type="tuning-mei">equal</other-play></play></sound>';
    const xml = `<score-partwise><part><measure><note/>${source}<note/></measure></part></score-partwise>`;
    const document = new DOMParser().parseFromString(sanitizeMusicXmlForVerovio(xml), 'application/xml');
    const original = document.querySelector('measure > sound')!;
    expect(original).not.toBeNull();
    expect(Object.fromEntries(Array.from(original.attributes).map(attribute => [attribute.name, attribute.value]))).toEqual({ id: 'original', tempo: '90.0', dacapo: 'yes', dynamics: '70', 'time-only': '1' });
    expect(original.querySelector('other-play')?.textContent).toBe('equal');
    const aid = original.nextElementSibling!;
    expect(aid.localName).toBe('direction');
    expect(aid.children).toHaveLength(1);
    expect(aid.firstElementChild?.localName).toBe('sound');
    expect(aid.firstElementChild?.outerHTML).toBe('<sound tempo="90.0"/>');
    expect(aid.nextElementSibling?.localName).toBe('note');
  });

  it('preserves real combined tempo + D.C. performance expansion and positioned tempo occurrences', async () => {
    const xml = navigationScore(false, '90');
    const raw = await rawRender(xml);
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(xml);
      const midi = adapter.renderMidi();
      const renderer = adapter.renderPerformanceTiming();
      expect(renderer.timemap.filter(event => Array.isArray(event.on)).map(event => ({ quarter: event.qstamp, ids: event.on }))).toEqual(raw.onsets);
      expect(renderer.expansionMap.a).toEqual(raw.expansion.a);
      const timeline = createVerovioPlaybackTimeline(midi, renderer);
      expect(timeline.notes).toHaveLength(4);
      expect(timeline.tempoEvents).toEqual([{ quarter: 0, bpm: 80 }, { quarter: 4, bpm: 90 }, { quarter: 12, bpm: 90 }]);
      const onsets = [0, 3, 3 + 8 / 3, 3 + 16 / 3];
      timeline.notes.forEach((note, index) => expect(note.time).toBeCloseTo(onsets[index], 6));
      timeline.visualEvents.forEach((event, index) => expect(event.time).toBeCloseTo(onsets[index], 6));
      expect(timeline.duration).toBeCloseTo(11, 6);
    } finally {
      adapter.dispose();
    }
  });

  it('keeps the complete original sound and copies only tempo positioning into its renderer aid', () => {
    const source = '<sound id="original" tempo="90" dacapo="yes" dynamics="70"><offset>2</offset><play><other-play type="tuning-mei">equal</other-play></play></sound>';
    const xml = `<score-partwise><part><measure>${source}</measure></part></score-partwise>`;
    const document = new DOMParser().parseFromString(sanitizeMusicXmlForVerovio(xml), 'application/xml');
    const original = document.querySelector('measure > sound')!;
    expect(new XMLSerializer().serializeToString(original).replace(/>\s+</g, '><')).toBe(source);
    const aid = original.nextElementSibling!;
    expect(aid.outerHTML.replace(/>\s+</g, '><')).toBe('<direction><offset sound="yes">2</offset><sound tempo="90"><offset>2</offset></sound></direction>');
  });

  it.each(['', ' sound="no"', ' sound="yes"'])('projects a direction sound position without interpreting its tempo number: %s', flag => {
    const xml = `<score-partwise><part><measure><direction><offset${flag}>2</offset><sound tempo="90.0"/></direction></measure></part></score-partwise>`;
    const document = new DOMParser().parseFromString(sanitizeMusicXmlForVerovio(xml), 'application/xml');
    expect(document.querySelector('direction > sound')?.getAttribute('tempo')).toBe('90.0');
    expect(document.querySelector('direction > offset')?.textContent ?? null).toBe(flag.includes('yes') ? '2' : null);
  });

  it('rejects ambiguous or invalid renderer positioning structure', () => {
    for (const content of [
      '<offset sound="maybe">2</offset><sound tempo="90"/>',
      '<offset>2</offset><offset>3</offset><sound tempo="90"/>',
      '<sound tempo="90"><offset>2</offset><offset>3</offset></sound>',
    ]) {
      expect(() => sanitizeMusicXmlForVerovio(`<score-partwise><part><measure><direction>${content}</direction></measure></part></score-partwise>`)).toThrow();
    }
  });
});
