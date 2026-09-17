// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { VerovioScoreAdapter } from '@/lib/score/verovio';

const PRACTICE_READY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note id="nv-p1-m1-note1"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note id="nv-p1-m1-note2"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note id="nv-p1-m1-note3"><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe('practice render identity contract', () => {
  it('preserves backend-prepared note ids as Verovio data-id values', async () => {
    const adapter = new VerovioScoreAdapter();

    await adapter.loadMusicXml(PRACTICE_READY_XML, { prepareGenericRenderIds: false });
    const svg = adapter.renderAllPages().map((page) => page.svg).join('\n');

    expect(svg).toContain('data-id="nv-p1-m1-note1"');
    expect(svg).toContain('data-id="nv-p1-m1-note2"');
    expect(svg).toContain('data-id="nv-p1-m1-note3"');
  });
});
