import {
  findVoiceEventByMusicXmlElementIds,
  findNoteAtomByMusicXmlElementId,
  type NoteAtom,
  type PitchedEvent,
  type ScoreDocument,
} from '@/lib/editor-domain';
import { formatPitch } from '@/lib/editor/staff-pitch-resolver';
export type ConnectionDirection = 'auto' | 'above' | 'below';
type ConnectionEndpoint = {
  pitch: NoteAtom['pitch'];
  measureNumber: number;
  voiceNumber: number;
  staffIndex: number;
};
export type ConnectionDetail = {
  id: string;
  type: 'tie' | 'slur';
  currentId: string;
  current: ConnectionEndpoint | null;
  partner: ConnectionEndpoint | null;
  partnerId: string;
  sourceId?: string;
  partnerSourceId?: string;
  direction: ConnectionDirection;
};
export function getEntitySourcePitch(
  document: ScoreDocument | null,
  _id: string,
  sourceId: string | undefined,
  _info: ConnectionEndpoint | null,
  fallback: string,
) {
  const match = document && sourceId ? findNoteAtomByMusicXmlElementId(document, sourceId) : null;
  return match ? formatPitch(match.note.pitch) : fallback;
}
export function buildDomainTieDetails(params: {
  document: ScoreDocument | null;
  event: PitchedEvent | null;
}): ConnectionDetail[] {
  const { document, event } = params;
  if (!document || !event) return [];

  const notesById = getDocumentNoteAtomMap(document);
  const currentNoteIds = new Set(event.notes.map((note) => note.id));

  return document.tieRelationships
    .filter(
      (relationship) =>
        currentNoteIds.has(relationship.startNoteAtomId) ||
        currentNoteIds.has(relationship.stopNoteAtomId),
    )
    .map((relationship, index) => {
      const currentNoteId = currentNoteIds.has(relationship.startNoteAtomId)
        ? relationship.startNoteAtomId
        : relationship.stopNoteAtomId;
      const partnerNoteId =
        currentNoteId === relationship.startNoteAtomId
          ? relationship.stopNoteAtomId
          : relationship.startNoteAtomId;
      const currentNote = notesById.get(currentNoteId);
      const partnerNote = notesById.get(partnerNoteId);
      const currentSourceId = currentNote?.source?.musicXmlElementId;
      const partnerSourceId = partnerNote?.source?.musicXmlElementId;
      const currentEntity = findVoiceEventByMusicXmlElementIds(
        document,
        currentSourceId ? [currentSourceId] : [],
      );
      const partnerEntity = findVoiceEventByMusicXmlElementIds(
        document,
        partnerSourceId ? [partnerSourceId] : [],
      );

      return {
        id: `domain-tie-${relationship.id}-${index}`,
        type: 'tie' as const,
        currentId: currentEntity?.id ?? currentSourceId ?? String(currentNoteId),
        current: describeEndpoint(document, currentNoteId),
        partner: describeEndpoint(document, partnerNoteId),
        partnerId: partnerEntity?.id ?? partnerSourceId ?? String(partnerNoteId),
        sourceId: currentSourceId,
        partnerSourceId,
        direction: getTieDirection(document, relationship.id),
      };
    });
}

export function buildDomainSlurDetails(params: {
  document: ScoreDocument | null;
  event: PitchedEvent | null;
}): ConnectionDetail[] {
  const { document, event } = params;
  if (!document || !event) return [];

  const notesById = getDocumentNoteAtomMap(document);
  const currentNoteIds = new Set(event.notes.map((note) => note.id));

  return document.slurRelationships
    .filter(
      (relationship) =>
        currentNoteIds.has(relationship.startNoteAtomId) ||
        currentNoteIds.has(relationship.stopNoteAtomId),
    )
    .map((relationship, index) => {
      const currentNoteId = currentNoteIds.has(relationship.startNoteAtomId)
        ? relationship.startNoteAtomId
        : relationship.stopNoteAtomId;
      const partnerNoteId =
        currentNoteId === relationship.startNoteAtomId
          ? relationship.stopNoteAtomId
          : relationship.startNoteAtomId;
      const currentNote = notesById.get(currentNoteId);
      const partnerNote = notesById.get(partnerNoteId);
      const currentSourceId = currentNote?.source?.musicXmlElementId;
      const partnerSourceId = partnerNote?.source?.musicXmlElementId;
      const currentEntity = findVoiceEventByMusicXmlElementIds(
        document,
        currentSourceId ? [currentSourceId] : [],
      );
      const partnerEntity = findVoiceEventByMusicXmlElementIds(
        document,
        partnerSourceId ? [partnerSourceId] : [],
      );

      return {
        id: `domain-slur-${relationship.id}-${index}`,
        type: 'slur' as const,
        currentId: currentEntity?.id ?? currentSourceId ?? String(currentNoteId),
        current: describeEndpoint(document, currentNoteId),
        partner: describeEndpoint(document, partnerNoteId),
        partnerId: partnerEntity?.id ?? partnerSourceId ?? String(partnerNoteId),
        sourceId: currentSourceId,
        partnerSourceId,
        direction: getSlurDirection(document, relationship.id),
      };
    });
}

function getDocumentNoteAtomMap(document: ScoreDocument): Map<NoteAtom['id'], NoteAtom> {
  const notes = new Map<NoteAtom['id'], NoteAtom>();
  document.events.forEach((event) => {
    if (event.kind !== 'pitched') return;
    event.notes.forEach((note) => notes.set(note.id, note));
  });
  return notes;
}

function getTieDirection(
  document: ScoreDocument,
  tieId: ScoreDocument['tieRelationships'][number]['id'],
): ConnectionDirection {
  return (
    document.notationControls.find(
      (
        control,
      ): control is Extract<ScoreDocument['notationControls'][number], { kind: 'tieNotation' }> =>
        control.kind === 'tieNotation' && control.tieId === tieId,
    )?.placement ?? 'auto'
  );
}

function getSlurDirection(
  document: ScoreDocument,
  notationId: ScoreDocument['slurRelationships'][number]['id'],
): ConnectionDirection {
  return (
    document.notationControls.find(
      (
        control,
      ): control is Extract<ScoreDocument['notationControls'][number], { kind: 'slurNotation' }> =>
        control.kind === 'slurNotation' && control.notationId === notationId,
    )?.placement ?? 'auto'
  );
}

function describeEndpoint(
  document: ScoreDocument,
  noteId: NoteAtom['id'],
): ConnectionEndpoint | null {
  const event = document.events.find(
    (event) => event.kind === 'pitched' && event.notes.some((note) => note.id === noteId),
  );
  if (event?.kind !== 'pitched') return null;
  const note = event.notes.find((note) => note.id === noteId)!;
  const measure = document.measures.find((measure) => measure.id === event.position.measureId);
  const voice = document.voices.find((voice) => voice.id === event.voiceId);
  const staff = document.staves.find((staff) => staff.id === event.staffId);
  if (!measure || !voice || !staff) return null;
  return {
    pitch: note.pitch,
    measureNumber: measure.number,
    voiceNumber: voice.number,
    staffIndex: staff.index,
  };
}
