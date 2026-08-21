import {
  getVoiceEventMusicXmlElementIds,
  isSameDomainAnchor,
  type DomainAnchor,
  type RenderAnchor,
  type ScoreDocument,
} from '@/lib/editor-domain';

export type ConnectionTarget = {
  sourceIds: string[];
};

export function getConnectionTargetSourceId(
  anchor: DomainAnchor,
  domainAnchors: RenderAnchor[] = []
): string | undefined {
  if (anchor.kind === 'noteAtom') {
    const sourceId = domainAnchors.find((renderAnchor) => (
      renderAnchor.sourceId && isSameDomainAnchor(renderAnchor.domain, anchor)
    ))?.sourceId;
    if (sourceId) return sourceId;
  }
  return undefined;
}

export function getConnectionTarget(
  document: ScoreDocument | null,
  anchor: DomainAnchor | null,
  domainAnchors: RenderAnchor[] = []
): ConnectionTarget | null {
  if (!document || !anchor) return null;

  const selectedSourceId = getConnectionTargetSourceId(anchor, domainAnchors);
  if (selectedSourceId) return { sourceIds: [selectedSourceId] };

  if (anchor.kind !== 'event') return null;
  const event = document.events.find((candidate) => candidate.id === anchor.eventId);
  if (!event || event.kind !== 'pitched') return null;
  const sourceIds = getVoiceEventMusicXmlElementIds(event);
  return sourceIds.length > 0 ? { sourceIds } : null;
}
