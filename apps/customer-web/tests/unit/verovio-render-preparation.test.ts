// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { prepareMusicXmlForVerovioRendering } from '@/lib/score/verovio';

describe('renderer engraving preparation', () => {
  it.each([false, true])(
    'preserves tempo, applicability, navigation and offsets with namespace=%s',
    (namespace) => {
      const xml = `<score-partwise${namespace ? ' xmlns="http://www.musicxml.org/ns/musicxml"' : ''}><part><measure><direction id="notation"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><offset sound="yes">1</offset><sound tempo="100" dalsegno="S1" time-only="2"><play><mute>on</mute></play><offset>2</offset></sound></direction><sound tempo="90" dacapo="yes"><offset>-1</offset></sound></measure></part></score-partwise>`;
      const prepared = new DOMParser().parseFromString(
        prepareMusicXmlForVerovioRendering(xml),
        'application/xml'
      );
      const raw = new DOMParser().parseFromString(xml, 'application/xml');
      const structure = (doc: Document) =>
        new XMLSerializer().serializeToString(doc).replace(/>\s+</g, '><');
      expect(structure(prepared)).toBe(structure(raw));
    }
  );
});
