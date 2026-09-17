import { createUniqueMusicXmlId } from '@/lib/musicxml';

import type { NoteAtomId, PitchedEvent, ScoreDocument } from './model';

export type AppendedNoteAtomIdentity = {
  noteAtomId: NoteAtomId;
  musicXmlElementId: string;
};

/**
 * Creates the stable identity for a note appended to an existing chord.
 *
 * A note atom id is also the MusicXML <note id> emitted by the exporter. Using
 * the same newly allocated value for both fields lets a later import recover
 * the exact domain identity and render anchor without a compatibility map.
 */
export function createAppendedNoteAtomIdentity(
  document: ScoreDocument,
  event: PitchedEvent,
): AppendedNoteAtomIdentity {
  const chordMemberNumber = event.notes.length + 1;
  const baseId = `${getIdentityBase(event)}-chord-${chordMemberNumber}`;
  const musicXmlElementId = createUniqueMusicXmlId(baseId, collectUsedIdentityValues(document));

  return {
    noteAtomId: musicXmlElementId as NoteAtomId,
    musicXmlElementId,
  };
}

function getIdentityBase(event: PitchedEvent): string {
  return event.notes[0].source?.musicXmlElementId
    ?? String(event.notes[0].id);
}

function collectUsedIdentityValues(document: ScoreDocument): Set<string> {
  const usedIds = new Set<string>();

  for (const event of document.events) {
    usedIds.add(String(event.id));

    if (event.kind === 'explicitRest') {
      addIfDefined(usedIds, event.source?.musicXmlElementId);
      continue;
    }

    for (const sourceId of event.source?.musicXmlElementIds ?? []) {
      addIfDefined(usedIds, sourceId);
    }
    for (const note of event.notes) {
      usedIds.add(String(note.id));
      addIfDefined(usedIds, note.source?.musicXmlElementId);
    }
  }

  return usedIds;
}

function addIfDefined(values: Set<string>, value: string | undefined): void {
  if (value) values.add(value);
}
