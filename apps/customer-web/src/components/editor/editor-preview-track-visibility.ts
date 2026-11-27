import {
  getVoiceEventMusicXmlElementIds,
  type ScoreDocument,
  type NoteAtom,
} from '@/lib/editor-domain';
export type ConnectionEndpointPair = { startId: string; endId: string };
export function getHiddenSourceIds(document: ScoreDocument | null, visibleTrackIds: Set<string>) {
  return new Set(
    document?.events
      .filter((event) => !visibleTrackIds.has(event.voiceId))
      .flatMap(getVoiceEventMusicXmlElementIds) ?? [],
  );
}
export function getHiddenConnectionPairs(
  hiddenSourceIds: Set<string>,
  domainDocument: ScoreDocument | null,
): ConnectionEndpointPair[] {
  const pairs: ConnectionEndpointPair[] = [];
  if (hiddenSourceIds.size === 0) return pairs;
  if (!domainDocument) return pairs;

  return getHiddenDomainConnectionPairs(domainDocument, hiddenSourceIds);
}

function getHiddenDomainConnectionPairs(
  document: ScoreDocument,
  hiddenSourceIds: Set<string>,
): ConnectionEndpointPair[] {
  const pairs: ConnectionEndpointPair[] = [];
  const notesById = getDocumentNoteAtomMap(document);

  document.tieRelationships.forEach((relationship) => {
    const startId = notesById.get(relationship.startNoteAtomId)?.source?.musicXmlElementId;
    const endId = notesById.get(relationship.stopNoteAtomId)?.source?.musicXmlElementId;
    if (!startId || !endId) return;
    if (hiddenSourceIds.has(startId) || hiddenSourceIds.has(endId)) {
      pairs.push({ startId, endId });
    }
  });

  document.slurRelationships.forEach((relationship) => {
    const startId = notesById.get(relationship.startNoteAtomId)?.source?.musicXmlElementId;
    const endId = notesById.get(relationship.stopNoteAtomId)?.source?.musicXmlElementId;
    if (!startId || !endId) return;
    if (hiddenSourceIds.has(startId) || hiddenSourceIds.has(endId)) {
      pairs.push({ startId, endId });
    }
  });

  return pairs;
}

function getDocumentNoteAtomMap(document: ScoreDocument): Map<NoteAtom['id'], NoteAtom> {
  const notes = new Map<NoteAtom['id'], NoteAtom>();
  document.events.forEach((event) => {
    if (event.kind !== 'pitched') return;
    event.notes.forEach((note) => notes.set(note.id, note));
  });
  return notes;
}

export function getHiddenStaffKeys(document: ScoreDocument | null, visibleTrackIds: Set<string>) {
  const keys = new Set<string>();
  if (!document) return keys;
  document.measures.forEach((measure) =>
    document.staves
      .filter((staff) => staff.partId === measure.partId)
      .forEach((staff) => {
        const index = document.measures
          .filter((item) => item.partId === measure.partId)
          .findIndex((item) => item.id === measure.id);
        const staffIndex = document.staves.findIndex((item) => item.id === staff.id);
        const events = document.events.filter(
          (event) => event.position.measureId === measure.id && event.staffId === staff.id,
        );
        if (events.length && events.every((event) => !visibleTrackIds.has(event.voiceId)))
          keys.add(`${index}:${staffIndex}`);
      }),
  );
  return keys;
}
