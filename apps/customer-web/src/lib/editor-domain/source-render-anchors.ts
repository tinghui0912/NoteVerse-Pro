import type { NoteAtom, ScoreDocument, VoiceEvent } from './model';
import {
  createRenderAnchorIndex,
  resolveDomainAnchorByRenderId,
  resolveDomainAnchorsBySourceId,
  type DomainAnchor,
  type RenderAnchor,
} from './render-anchors';

export function createSourceRenderAnchorsFromDocument(document: ScoreDocument): RenderAnchor[] {
  return document.events.flatMap(createSourceRenderAnchorsForEvent);
}

export function resolveDomainAnchorFromRenderOrSourceId(
  anchors: RenderAnchor[],
  renderOrSourceId: string | null | undefined,
): DomainAnchor | null {
  if (!renderOrSourceId) return null;

  const index = createRenderAnchorIndex(anchors);
  const renderAnchor = resolveDomainAnchorByRenderId(index, renderOrSourceId);
  if (renderAnchor) return renderAnchor;

  return resolveDomainAnchorsBySourceId(index, renderOrSourceId)[0] ?? null;
}

function createSourceRenderAnchorsForEvent(event: VoiceEvent): RenderAnchor[] {
  if (event.kind === 'explicitRest') {
    return event.source?.musicXmlElementId
      ? [{
          renderId: event.source.musicXmlElementId,
          sourceId: event.source.musicXmlElementId,
          domain: {
            kind: 'event',
            eventId: event.id,
          },
        }]
      : [];
  }

  return [
    ...event.notes.flatMap((note) => createSourceRenderAnchorsForNoteAtom(event, note)),
    ...createEventFallbackAnchors(event),
  ];
}

function createSourceRenderAnchorsForNoteAtom(event: Extract<VoiceEvent, { kind: 'pitched' }>, note: NoteAtom): RenderAnchor[] {
  const sourceId = note.source?.musicXmlElementId;
  if (!sourceId) return [];

  return [
    {
      renderId: sourceId,
      sourceId,
      domain: {
        kind: 'noteAtom',
        eventId: event.id,
        noteAtomId: note.id,
      },
    },
    {
      renderId: `${sourceId}:event`,
      sourceId,
      domain: {
        kind: 'event',
        eventId: event.id,
      },
    },
  ];
}

function createEventFallbackAnchors(event: Extract<VoiceEvent, { kind: 'pitched' }>): RenderAnchor[] {
  const noteSourceIds = new Set(
    event.notes
      .map((note) => note.source?.musicXmlElementId)
      .filter((sourceId): sourceId is string => Boolean(sourceId)),
  );

  return (event.source?.musicXmlElementIds ?? [])
    .filter((sourceId) => !noteSourceIds.has(sourceId))
    .map((sourceId) => ({
    renderId: `${sourceId}:event-fallback`,
    sourceId,
    domain: {
      kind: 'event' as const,
      eventId: event.id,
    },
  }));
}
