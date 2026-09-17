import type { ScoreData } from '@/types/score-types';
import { getEditorTrackId, parseVoiceNumber } from '@/lib/editor/tracks';
import type { NoteAtom, ScoreDocument } from '@/lib/editor-domain';

export type ConnectionEndpointPair = {
  startId: string;
  endId: string;
};

export function getHiddenSourceIds(
  scoreData: ScoreData | null,
  visibleTrackIdSet: Set<string>
): Set<string> {
  const ids = new Set<string>();
  if (!scoreData) return ids;

  scoreData.measures.forEach((measure) => {
    measure.staves.forEach((stave, staveIndex) => {
      stave.voices.forEach((voice) => {
        const xmlVoice = parseVoiceNumber(voice.name);
        const trackId = getEditorTrackId(staveIndex, xmlVoice);
        if (visibleTrackIdSet.has(trackId)) return;

        voice.events.forEach((entity) => {
          const sourceIds = entity.meta?.sourceIds || (entity.meta?.id ? [entity.meta.id] : []);
          sourceIds.forEach((id) => ids.add(id));
        });
      });
    });
  });

  return ids;
}

export function getHiddenConnectionPairs(
  hiddenSourceIds: Set<string>,
  domainDocument: ScoreDocument | null
): ConnectionEndpointPair[] {
  const pairs: ConnectionEndpointPair[] = [];
  if (hiddenSourceIds.size === 0) return pairs;
  if (!domainDocument) return pairs;

  return getHiddenDomainConnectionPairs(domainDocument, hiddenSourceIds);
}

function getHiddenDomainConnectionPairs(
  document: ScoreDocument,
  hiddenSourceIds: Set<string>
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

export function getHiddenStaffKeys(
  scoreData: ScoreData | null,
  visibleTrackIdSet: Set<string>
): Set<string> {
  const keys = new Set<string>();
  if (!scoreData) return keys;

  scoreData.measures.forEach((measure, measureIndex) => {
    measure.staves.forEach((stave, staveIndex) => {
      const voicesWithEntities = stave.voices.filter((voice) => voice.events.length > 0);
      if (voicesWithEntities.length === 0) return;

      const allEntityVoicesHidden = voicesWithEntities.every((voice) => {
        const xmlVoice = parseVoiceNumber(voice.name);
        const trackId = getEditorTrackId(staveIndex, xmlVoice);
        return !visibleTrackIdSet.has(trackId);
      });

      if (allEntityVoicesHidden) {
        keys.add(`${measureIndex}:${staveIndex}`);
      }
    });
  });

  return keys;
}
