// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePracticeScoreArtifact } from '@/lib/practice/contracts/generated/score-artifact';
import {  } from '@/lib/practice/score/artifact';
import repeatArtifact from '../../../../tests/fixtures/musicxml/practice-simple-repeat.artifact.json';

import { artifactWithKeys } from '../__fixtures__/piano-key-artifact';
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
    const adapter = new PracticeVerovioAdapter(artifactWithKeys([[60],[62]]), async () => toolkit);

    await adapter.loadMusicXml('<score-partwise><part><measure><note /></measure></part></score-partwise>');

    const loadData = toolkit.loadData as Mock<(data: string) => boolean>;
    expect(loadData).toHaveBeenCalledOnce();
    expect(toolkit.setOptions).toHaveBeenCalledWith(expect.objectContaining({ expandNever: true }));
    expect(loadData.mock.calls[0]?.[0]).not.toContain('nv-p1-m1-note1');
  });

  it('uses the latest onset at or before the tick as the performance cursor', async () => {
    const toolkit = mockToolkit([
      { qstamp: 1, on: ['render-0-0'] },
      { qstamp: 2, off: ['n1'] },
      { qstamp: 3, on: ['n2'] },
      { qstamp: 4, off: ['n2'] },
      { qstamp: 5, off: ['held'] },
    ]);
    const adapter = new PracticeVerovioAdapter(artifactWithKeys([[60],[62]]), async () => toolkit);

    await adapter.loadMusicXml('<score-partwise><part><measure><note /></measure></part></score-partwise>');

    expect(adapter.getCursorTimelineEntryForTickRange(0, 0, 2)?.noteIds).toEqual(['render-0-0']);
    expect(adapter.getCursorTimelineEntryForTickRange(0, 0, 2)?.noteIds).toEqual(['render-0-0']);
    expect(adapter.getCursorTimelineEntryForTickRange(1, 0, 2)?.noteIds).toEqual(['render-1-0']);
  });

});


it('real Practice simple-repeat visual chronology aligns with the notation-order artifact', async () => {
  const artifact = decodePracticeScoreArtifact(repeatArtifact);
  const xml = readFileSync(resolve(process.cwd(), '../../backend/tests/fixtures/musicxml/practice-simple-repeat.musicxml'), 'utf8');
  const adapter = new PracticeVerovioAdapter(artifact);
  try {
    await adapter.loadMusicXml(xml);
    const written = artifact.events.map(event => event.onsetTick);
    expect(written).toEqual([0, 4, 8, 12]);
    const entries = written.map(tick => adapter.getTimelineEntryForTick(tick)!);
    expect(entries.map(entry => entry.tick)).toEqual(written);
    expect(entries.map(entry => entry.noteIds)).toEqual(artifact.notes.map(note => [note.renderNoteId]));
    const m4 = artifact.notes.find(note => note.measureNumber === '4')!;
    const m4Event = artifact.events.find(event => event.eventId === m4.eventId)!;
    expect(adapter.getTimelineEntryForTick(m4Event.onsetTick)?.noteIds).toContain(m4.renderNoteId);
    expect(adapter.getNextTimelineEntryAfterTick(12)?.tick).toBe(12);
    expect(adapter.renderTimemap().flatMap(entry => entry.on ?? [])).toEqual(artifact.notes.map(note => note.renderNoteId));
  } finally {
    adapter.dispose();
  }
});
