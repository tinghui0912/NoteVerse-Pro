// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { VerovioScoreAdapter } from '@/lib/score/verovio';
import { readWrittenRealization } from '@/lib/score/performance/written-realization';
import sources from '../../../../backend/tests/fixtures/verovio-playback-profile.json';

it.each(Object.entries(sources))(
  'WASM written realization agrees with Python evidence: %s',
  async (name, source) => {
    const adapter = new VerovioScoreAdapter();
    try {
      await adapter.loadMusicXml(source.musicxml, {
        toolkitOptions: { expandNever: true },
      });
      const midi = adapter.renderMidi();
      const timemap = adapter.renderTimemap();
      const raw = parseMidi(
        Uint8Array.from(atob(midi), (c) => c.charCodeAt(0))
      );
      const events = raw.tracks.flatMap((track, i) => {
        let tick = 0;
        return track.flatMap((e) => {
          tick += e.deltaTime;
          if (!('channel' in e) || 'meta' in e) return [];
          let status: number;
          let data: number[];
          switch (e.type) {
            case 'programChange':
              status = 0xc0;
              data = [e.programNumber];
              break;
            case 'noteOn':
              status = 0x90;
              data = [e.noteNumber, e.velocity];
              break;
            case 'noteOff':
              status = e.byte9 ? 0x90 : 0x80;
              data = [e.noteNumber, e.velocity];
              break;
            case 'controller':
              status = 0xb0;
              data = [e.controllerType, e.value];
              break;
            case 'pitchBend': {
              const bend = e.value + 8192;
              status = 0xe0;
              data = [bend & 127, bend >> 7];
              break;
            }
            case 'channelAftertouch':
              status = 0xd0;
              data = [e.amount];
              break;
            case 'noteAftertouch':
              status = 0xa0;
              data = [e.noteNumber, e.amount];
              break;
            default:
              throw new Error('Unclassified renderer channel observation.');
          }
          return [[i, tick, status | e.channel, data]];
        });
      });
      expect({
        ppq: raw.header.ticksPerBeat,
        trackCount: raw.tracks.length,
        channelEvents: events,
        routingMeta: raw.tracks
          .flat()
          .filter(
            (e) =>
              e.type === 'channelPrefix' ||
              e.type === 'portPrefix' ||
              (e.type === 'unknownMeta' && e.metatypeByte === 9)
          ),
      }).toEqual(source.expected);
      expect(
        timemap
          .filter((e) => Array.isArray(e.on) && e.on.length)
          .map((e) => [e.qstamp, e.on])
      ).toEqual(source.visualOnsets);
      if (name === 'graceSlashed') {
        expect(() => readWrittenRealization(midi, timemap)).toThrow(
          'not uniquely representable on the MIDI grid'
        );
      }
      if (!source.reason) {
        expect(
          readWrittenRealization(midi, timemap).notes.map((n) => n.midi)
        ).toEqual(
          source.expected.channelEvents
            .filter((e) => e[2] === 0x90 && Array.isArray(e[3]) && e[3][1])
            .map((e) => (e[3] as number[])[0])
        );
      }
    } finally {
      adapter.dispose();
    }
  }
);
