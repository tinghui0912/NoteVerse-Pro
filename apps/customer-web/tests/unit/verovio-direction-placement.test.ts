// @vitest-environment jsdom
import { artifactWithKeys } from '@/lib/practice/__fixtures__/piano-key-artifact';
import { describe, expect, it, vi } from 'vitest';
import { createVerovioToolkit } from '@/lib/score/verovio/toolkit';
import { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';

const notes = ['C', 'D', 'E', 'F']
  .map(
    (step, index) =>
      `<note id="n${index}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`
  )
  .join('');
function score() {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction id="tempo-mark" placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type><offset>2</offset><sound tempo="90"/></direction>${notes}</measure></part></score-partwise>`;
}

describe('Practice renderer written-axis contract', () => {
  it('Practice keeps the visual offset and the notation-order repeat axis in one toolkit', async () => {
    const toolkit = await createVerovioToolkit();
    const options = vi.spyOn(toolkit, 'setOptions');
    const artifact = artifactWithKeys([[60],[62],[64],[65]]);
    artifact.notes.forEach((n,i)=>n.renderNoteId=`n${i}`);
    const adapter = new PracticeVerovioAdapter(artifact, async () => toolkit);
    const xml = score().replace(
      '</measure>',
      '<barline location="right"><repeat direction="backward"/></barline></measure>'
    );
    try {
      await adapter.loadMusicXml(xml);
      expect(options).toHaveBeenCalledWith(
        expect.objectContaining({ expandNever: true })
      );
      const page = new DOMParser().parseFromString(
        adapter.renderAllPages()[0].svg,
        'image/svg+xml'
      );
      expect(page.querySelector('.tempo text')?.textContent).toContain('90');
      expect(
        adapter.renderTimemap().flatMap((event) => event.on ?? [])
      ).toEqual(['n0', 'n1', 'n2', 'n3']);
      expect(
        [0, 1, 2, 3].map((beat) => adapter.getTimelineEntryForTick(beat)?.tick)
      ).toEqual([0, 1, 2, 3]);
    } finally {
      adapter.dispose();
    }
  });
});
