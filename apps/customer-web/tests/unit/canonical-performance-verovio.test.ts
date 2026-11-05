// @vitest-environment jsdom
import { Midi } from '@tonejs/midi';
import { parseMidi, writeMidi } from 'midi-file';
import { describe, expect, it, vi } from 'vitest';
import { VerovioScoreAdapter } from '@/lib/score/verovio';
import { createVerovioToolkit } from '@/lib/score/verovio/toolkit';
import { decodePerformancePlan } from '@/lib/score/performance/plan';
import { createScorePerformanceTimeline } from '@/lib/score/performance/timeline';
import { readWrittenRealization } from '@/lib/score/performance/written-realization';
import { Rational } from '@/lib/score/performance/rational';
import fixtures from '../fixtures/performance/canonical-plans.json';

describe('real Verovio written realization × canonical Browser plan', () => {
  it.each(fixtures)(
    '$name plays canonical pitches, cursor IDs and end through real WASM',
    async ({ plan: dto, path }) => {
      const toolkit = await createVerovioToolkit();
      const options = vi.spyOn(toolkit, 'setOptions');
      const adapter = new VerovioScoreAdapter(async () => toolkit);
      try {
        await adapter.loadMusicXml(dto.musicxml, {
          toolkitOptions: { expandNever: true },
        });
        expect(options).toHaveBeenCalledWith(
          expect.objectContaining({ expandNever: true })
        );
        const timemap = adapter.renderTimemap();
        const base64 = adapter.renderMidi();
        const written = readWrittenRealization(base64, timemap);
        const writtenCount = new DOMParser()
          .parseFromString(dto.musicxml, 'application/xml')
          .querySelectorAll('note').length;
        expect(written.notes.map((n) => n.writtenStart)).toEqual(
          Array.from(
            { length: writtenCount },
            (_, i) => new Rational(BigInt(i))
          )
        );
        expect(written.visualOnsets.map((e) => e.position)).toEqual(
          written.notes.map((n) => n.writtenStart)
        );
        const timeline = createScorePerformanceTimeline(
          decodePerformancePlan(dto),
          base64,
          timemap
        );
        expect(timeline.notes.map((n) => n.midi)).toEqual(
          path.map((q) => 48 + Math.floor(q / 4) * 5 + (q % 4))
        );
        expect(timeline.notes.map((n) => n.time)).toEqual(
          path.map((_, i) => i * 0.75)
        );
        expect(timeline.visualEvents.map((e) => e.time)).toEqual(
          path.map((_, i) => i * 0.75)
        );
        expect(timeline.visualEvents.map((e) => e.noteIds)).toEqual(
          path.map((q) => [`n${Math.floor(q / 4)}_${q % 4}`])
        );
        expect(timeline.duration).toBe(path.length * 0.75);
        const svg = adapter
          .renderAllPages()
          .map((p) => p.svg)
          .join('');
        for (const id of new Set(
          timeline.visualEvents.flatMap((e) => e.noteIds)
        )) {
          expect(adapter.getPageWithElement(id)).toBeGreaterThan(0);
          expect(svg).toContain(`id="${id}"`);
        }
      } finally {
        adapter.dispose();
      }
    }
  );

  it('retains exact triplet MIDI ticks and written Timemap identity', async () => {
    const notes = Array.from(
      { length: 6 },
      (_, i) =>
        `<note id="third-${i}"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>${i % 3 === 0 ? '<notations><tuplet type="start"/></notations>' : i % 3 === 2 ? '<notations><tuplet type="stop"/></notations>' : ''}</note>`
    ).join('');
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>3</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(xml, {
        toolkitOptions: { expandNever: true },
      });
      const written = readWrittenRealization(
        adapter.renderMidi(),
        adapter.renderTimemap()
      );
      expect(written.notes.map((n) => n.writtenStart)).toEqual(
        Array.from({ length: 6 }, (_, i) => new Rational(BigInt(i), 3n))
      );
      expect(written.visualOnsets.map((e) => e.position)).toEqual(
        written.notes.map((n) => n.writtenStart)
      );
    } finally {
      adapter.dispose();
    }
  });

  it('preserves independent instrument realization when parts share renderer channels', async () => {
    const parts = [0, 1]
      .map(
        (i) =>
          `<score-part id="P${i}"><part-name>Part ${i}</part-name><score-instrument id="I${i}"><instrument-name>Instrument ${i}</instrument-name></score-instrument><midi-instrument id="I${i}"><midi-program>${i ? 41 : 1}</midi-program></midi-instrument></score-part>`
      )
      .join('');
    const body = [0, 1]
      .map(
        (i) =>
          `<part id="P${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${[0, 1].map((j) => `<note id="p${i}-${j}"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>`).join('')}</measure></part>`
      )
      .join('');
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(
        `<score-partwise><part-list>${parts}</part-list>${body}</score-partwise>`,
        { toolkitOptions: { expandNever: true } }
      );
      const bytes = adapter.renderMidi();
      const raw = parseMidi(
        Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))
      );
      for (const track of raw.tracks) {
        let ticks = 0;
        for (const event of track) {
          ticks += event.deltaTime;
          if (event.type === 'programChange') expect(ticks).toBe(0);
        }
      }
      const midi = new Midi(
        Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))
      );
      expect(midi.tracks.map((t) => [t.channel, t.instrument.number])).toEqual([
        [0, 0],
        [0, 40],
      ]);
      const written = readWrittenRealization(bytes, adapter.renderTimemap());
      expect(
        written.notes.map((n) => [
          n.sourceTrackIdentity,
          n.writtenStart,
          n.instrument,
        ])
      ).toEqual([
        [0, new Rational(0n), 'acoustic_grand_piano'],
        [0, new Rational(2n), 'acoustic_grand_piano'],
        [1, new Rational(0n), 'violin'],
        [1, new Rational(2n), 'violin'],
      ]);
    } finally {
      adapter.dispose();
    }
  });

  it('rejects a timed program change before the note decoder can lose instrument state', () => {
    const bytes = writeMidi({
      header: { format: 0, numTracks: 1, ticksPerBeat: 120 },
      tracks: [
        [
          { deltaTime: 0, channel: 0, type: 'programChange', programNumber: 0 },
          {
            deltaTime: 0,
            channel: 0,
            type: 'noteOn',
            noteNumber: 60,
            velocity: 90,
          },
          {
            deltaTime: 120,
            channel: 0,
            type: 'noteOff',
            noteNumber: 60,
            velocity: 0,
          },
          {
            deltaTime: 0,
            channel: 0,
            type: 'programChange',
            programNumber: 40,
          },
          {
            deltaTime: 0,
            channel: 0,
            type: 'noteOn',
            noteNumber: 64,
            velocity: 90,
          },
          {
            deltaTime: 120,
            channel: 0,
            type: 'noteOff',
            noteNumber: 64,
            velocity: 0,
          },
          { deltaTime: 0, meta: true, type: 'endOfTrack' },
        ],
      ],
    });
    expect(() =>
      readWrittenRealization(btoa(String.fromCharCode(...bytes)), [])
    ).toThrow('unsupported_score_preview_instrument_change');
  });
});
