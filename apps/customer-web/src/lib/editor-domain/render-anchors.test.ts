import { describe, expect, it } from 'vitest';

import type { EventId, NoteAtomId } from './model';
import {
  createRenderAnchorIndex,
  getRenderIdsForDomainAnchor,
  resolveDomainAnchorByRenderId,
  resolveDomainAnchorsBySourceId,
  type DomainAnchor,
  type RenderAnchor,
} from './render-anchors';

const eventAnchor: DomainAnchor = {
  kind: 'event',
  eventId: 'event-1' as EventId,
};

const noteAtomAnchor: DomainAnchor = {
  kind: 'noteAtom',
  eventId: 'event-1' as EventId,
  noteAtomId: 'note-atom-2' as NoteAtomId,
};

describe('render anchors', () => {
  it('resolves Verovio render ids to domain anchors without using source ids as domain identity', () => {
    const index = createRenderAnchorIndex([
      {
        renderId: 'verovio-note-1',
        sourceId: 'musicxml-note-1',
        domain: eventAnchor,
      },
    ]);

    expect(resolveDomainAnchorByRenderId(index, 'verovio-note-1')).toBe(eventAnchor);
    expect(resolveDomainAnchorByRenderId(index, 'musicxml-note-1')).toBeNull();
  });

  it('allows one MusicXML source id to point at multiple render/domain anchors', () => {
    const index = createRenderAnchorIndex([
      {
        renderId: 'verovio-note-root',
        sourceId: 'musicxml-note-1',
        domain: eventAnchor,
      },
      {
        renderId: 'verovio-notehead-member',
        sourceId: 'musicxml-note-1',
        domain: noteAtomAnchor,
      },
    ]);

    expect(resolveDomainAnchorsBySourceId(index, 'musicxml-note-1')).toEqual([
      eventAnchor,
      noteAtomAnchor,
    ]);
  });

  it('finds all render ids for the same domain anchor', () => {
    const anchors: RenderAnchor[] = [
      {
        renderId: 'verovio-note-1',
        sourceId: 'musicxml-note-1',
        domain: eventAnchor,
      },
      {
        renderId: 'verovio-notehead-1',
        sourceId: 'musicxml-note-1',
        domain: eventAnchor,
      },
      {
        renderId: 'verovio-notehead-2',
        sourceId: 'musicxml-note-2',
        domain: noteAtomAnchor,
      },
    ];

    expect(getRenderIdsForDomainAnchor(anchors, eventAnchor)).toEqual([
      'verovio-note-1',
      'verovio-notehead-1',
    ]);
  });
});
