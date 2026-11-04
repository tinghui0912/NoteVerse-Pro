// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePracticeScoreArtifact } from '../kernel/artifact';
import repeatArtifact from '../../../../tests/fixtures/musicxml/practice-simple-repeat.artifact.json';

import { PracticeVerovioAdapter } from './verovio-adapter';
import type { Mock } from 'vitest';
import type { VerovioToolkitLike } from '@/lib/score/verovio';

function mockToolkit(timemap: Array<Record<string, unknown>> = []) {
  return {
    setOptions: vi.fn(() => true),
    loadData: vi.fn(() => true),
    renderToSVG: vi.fn(() => '<svg />'),
    renderToMIDI: vi.fn(() => ''),
    renderToTimemap: vi.fn(() => timemap),
    getPageCount: vi.fn(() => 1),
    getPageWithElement: vi.fn(() => 1),
    redoLayout: vi.fn(),
  } satisfies VerovioToolkitLike;
}

describe('PracticeVerovioAdapter', () => {
  it('does not generate frontend ids for backend-prepared practice MusicXML', async () => {
    const toolkit = mockToolkit();
    const adapter = new PracticeVerovioAdapter(async () => toolkit);

    await adapter.loadMusicXml('<score-partwise><part><measure><note /></measure></part></score-partwise>');

    const loadData = toolkit.loadData as Mock<(data: string) => boolean>;
    expect(loadData).toHaveBeenCalledOnce();
    expect(toolkit.setOptions).toHaveBeenCalledWith(expect.objectContaining({ expandNever: true }));
    expect(loadData.mock.calls[0]?.[0]).not.toContain('nv-p1-m1-note1');
  });

  it('uses the latest onset at or before the beat as the performance cursor', async () => {
    const toolkit = mockToolkit([
      { qstamp: 1, on: ['n1', 'held'] },
      { qstamp: 2, off: ['n1'] },
      { qstamp: 3, on: ['n2'] },
      { qstamp: 4, off: ['n2'] },
      { qstamp: 5, off: ['held'] },
    ]);
    const adapter = new PracticeVerovioAdapter(async () => toolkit);

    await adapter.loadMusicXml('<score-partwise><part><measure><note /></measure></part></score-partwise>');

    expect(adapter.getCursorTimelineEntryForBeatRange(1.5, 1, 4)?.noteIds).toEqual(['n1', 'held']);
    expect(adapter.getCursorTimelineEntryForBeatRange(2.5, 1, 4)?.noteIds).toEqual(['n1', 'held']);
    expect(adapter.getCursorTimelineEntryForBeatRange(3.5, 1, 4)?.noteIds).toEqual(['n2']);
  });

});


it('real Practice simple-repeat visual chronology aligns with the notation-order artifact', async () => {
  const artifact = parsePracticeScoreArtifact(repeatArtifact);
  const xml = readFileSync(resolve(process.cwd(), '../../backend/tests/fixtures/musicxml/practice-simple-repeat.musicxml'), 'utf8');
  const adapter = new PracticeVerovioAdapter();
  try {
    await adapter.loadMusicXml(xml);
    const written = artifact.events.map(event => event.onsetBeat);
    expect(written).toEqual([0, 4, 8, 12]);
    const entries = written.map(beat => adapter.getTimelineEntryForBeat(beat)!);
    expect(entries.map(entry => entry.beat)).toEqual(written);
    expect(entries.map(entry => entry.noteIds)).toEqual(artifact.notes.map(note => [note.renderNoteId]));
    const m4 = artifact.notes.find(note => note.measureNumber === '4')!;
    const m4Event = artifact.events.find(event => event.eventId === m4.eventId)!;
    expect(adapter.getTimelineEntryForBeat(m4Event.onsetBeat)?.noteIds).toContain(m4.renderNoteId);
    expect(adapter.getNextTimelineEntryAfterBeat(12)?.beat).toBe(12);
    expect(adapter.renderTimemap().flatMap(entry => entry.on ?? [])).toEqual(artifact.notes.map(note => note.renderNoteId));
  } finally {
    adapter.dispose();
  }
});
