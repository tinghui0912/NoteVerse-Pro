import type { NoteAtom, PitchedEvent, ScoreDocument, VoiceEvent } from './model';

export type FindNoteAtomByMusicXmlElementIdResult = {
  event: PitchedEvent;
  note: NoteAtom;
};

export function getVoiceEventMusicXmlElementIds(event: VoiceEvent): string[] {
  if (event.kind === 'explicitRest') {
    return event.source?.musicXmlElementId ? [event.source.musicXmlElementId] : [];
  }

  const eventSourceIds = event.source?.musicXmlElementIds ?? [];
  const noteSourceIds = event.notes
    .map((note) => note.source?.musicXmlElementId)
    .filter((id): id is string => Boolean(id));

  return [...new Set([...eventSourceIds, ...noteSourceIds])];
}

export function findVoiceEventByMusicXmlElementIds(
  document: ScoreDocument,
  musicXmlElementIds: readonly string[],
): VoiceEvent | null {
  const sourceIdSet = new Set(musicXmlElementIds.filter(Boolean));
  if (sourceIdSet.size === 0) return null;

  return document.events.find((event) => (
    getVoiceEventMusicXmlElementIds(event).some((id) => sourceIdSet.has(id))
  )) ?? null;
}

export function findNoteAtomByMusicXmlElementId(
  document: ScoreDocument,
  musicXmlElementId: string,
): FindNoteAtomByMusicXmlElementIdResult | null {
  if (!musicXmlElementId) return null;

  for (const event of document.events) {
    if (event.kind !== 'pitched') continue;

    const note = event.notes.find((note) => note.source?.musicXmlElementId === musicXmlElementId);
    if (note) {
      return { event, note };
    }
  }

  return null;
}
