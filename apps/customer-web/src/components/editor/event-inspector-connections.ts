import { findEntityById, findEntityBySourceIds } from '@/lib/editor/score-lookup';
import type { NoteAtom, PitchedEvent, ScoreDocument } from '@/lib/editor-domain';
import type { EntityInfo, ScoreData } from '@/types/score-types';

export type ConnectionDirection = 'auto' | 'above' | 'below';

export type ConnectionDetail = {
  id: string;
  type: 'tie' | 'slur';
  currentId: string;
  current: EntityInfo | null;
  partner: EntityInfo | null;
  partnerId: string;
  sourceId?: string;
  partnerSourceId?: string;
  direction: ConnectionDirection;
};

export function getEntitySourcePitch(
  scoreData: ScoreData | null,
  entityId: string,
  sourceId: string | undefined,
  info: EntityInfo | null,
  fallback: string
) {
  const found = findEntityById(scoreData, entityId);
  const entity = found?.entity;
  if (entity?.type === 'chord' && sourceId) {
    const index = entity.meta?.sourceIds?.indexOf(sourceId) ?? -1;
    if (index >= 0 && entity.pitches[index]) return entity.pitches[index];
  }
  if (entity?.type === 'note') return entity.pitch;
  if (entity?.type === 'rest') return fallback;
  if (entity?.type === 'chord') return entity.pitches.length > 0 ? entity.pitches.join('+') : fallback;
  if (!info) return fallback;
  return info.pitch;
}

export function buildDomainTieDetails(params: {
  document: ScoreDocument | null;
  event: PitchedEvent | null;
  scoreData: ScoreData | null;
}): ConnectionDetail[] {
  const { document, event } = params;
  if (!document || !event) return [];

  const notesById = getDocumentNoteAtomMap(document);
  const currentNoteIds = new Set(event.notes.map((note) => note.id));

  return document.tieRelationships
    .filter((relationship) => (
      currentNoteIds.has(relationship.startNoteAtomId) || currentNoteIds.has(relationship.stopNoteAtomId)
    ))
    .map((relationship, index) => {
      const currentNoteId = currentNoteIds.has(relationship.startNoteAtomId)
        ? relationship.startNoteAtomId
        : relationship.stopNoteAtomId;
      const partnerNoteId = currentNoteId === relationship.startNoteAtomId
        ? relationship.stopNoteAtomId
        : relationship.startNoteAtomId;
      const currentNote = notesById.get(currentNoteId);
      const partnerNote = notesById.get(partnerNoteId);
      const currentSourceId = currentNote?.source?.musicXmlElementId;
      const partnerSourceId = partnerNote?.source?.musicXmlElementId;
      const currentEntity = findEntityForSource(params.scoreData, currentSourceId);
      const partnerEntity = findEntityForSource(params.scoreData, partnerSourceId);

      return {
        id: `domain-tie-${relationship.id}-${index}`,
        type: 'tie' as const,
        currentId: currentEntity?.meta.id ?? currentSourceId ?? String(currentNoteId),
        current: null,
        partner: null,
        partnerId: partnerEntity?.meta.id ?? partnerSourceId ?? String(partnerNoteId),
        sourceId: currentSourceId,
        partnerSourceId,
        direction: getTieDirection(document, relationship.id),
      };
    });
}

export function buildDomainSlurDetails(params: {
  document: ScoreDocument | null;
  event: PitchedEvent | null;
  scoreData: ScoreData | null;
}): ConnectionDetail[] {
  const { document, event } = params;
  if (!document || !event) return [];

  const notesById = getDocumentNoteAtomMap(document);
  const currentNoteIds = new Set(event.notes.map((note) => note.id));

  return document.slurRelationships
    .filter((relationship) => (
      currentNoteIds.has(relationship.startNoteAtomId) || currentNoteIds.has(relationship.stopNoteAtomId)
    ))
    .map((relationship, index) => {
      const currentNoteId = currentNoteIds.has(relationship.startNoteAtomId)
        ? relationship.startNoteAtomId
        : relationship.stopNoteAtomId;
      const partnerNoteId = currentNoteId === relationship.startNoteAtomId
        ? relationship.stopNoteAtomId
        : relationship.startNoteAtomId;
      const currentNote = notesById.get(currentNoteId);
      const partnerNote = notesById.get(partnerNoteId);
      const currentSourceId = currentNote?.source?.musicXmlElementId;
      const partnerSourceId = partnerNote?.source?.musicXmlElementId;
      const currentEntity = findEntityForSource(params.scoreData, currentSourceId);
      const partnerEntity = findEntityForSource(params.scoreData, partnerSourceId);

      return {
        id: `domain-slur-${relationship.id}-${index}`,
        type: 'slur' as const,
        currentId: currentEntity?.meta.id ?? currentSourceId ?? String(currentNoteId),
        current: null,
        partner: null,
        partnerId: partnerEntity?.meta.id ?? partnerSourceId ?? String(partnerNoteId),
        sourceId: currentSourceId,
        partnerSourceId,
        direction: getSlurDirection(document, relationship.id),
      };
    });
}

function findEntityForSource(scoreData: ScoreData | null, sourceId: string | undefined) {
  return sourceId ? findEntityBySourceIds(scoreData, [sourceId]) : null;
}

function getDocumentNoteAtomMap(document: ScoreDocument): Map<NoteAtom['id'], NoteAtom> {
  const notes = new Map<NoteAtom['id'], NoteAtom>();
  document.events.forEach((event) => {
    if (event.kind !== 'pitched') return;
    event.notes.forEach((note) => notes.set(note.id, note));
  });
  return notes;
}

function getTieDirection(document: ScoreDocument, tieId: ScoreDocument['tieRelationships'][number]['id']): ConnectionDirection {
  return document.notationControls.find((control): control is Extract<ScoreDocument['notationControls'][number], { kind: 'tieNotation' }> => (
    control.kind === 'tieNotation' && control.tieId === tieId
  ))?.placement ?? 'auto';
}

function getSlurDirection(document: ScoreDocument, notationId: ScoreDocument['slurRelationships'][number]['id']): ConnectionDirection {
  return document.notationControls.find((control): control is Extract<ScoreDocument['notationControls'][number], { kind: 'slurNotation' }> => (
    control.kind === 'slurNotation' && control.notationId === notationId
  ))?.placement ?? 'auto';
}
