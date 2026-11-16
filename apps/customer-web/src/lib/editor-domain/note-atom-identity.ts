import type { NoteAtomId, PitchedEvent, ScoreDocument } from './model';

export type AppendedNoteAtomIdentity = {
  noteAtomId: NoteAtomId;
  musicXmlElementId: string;
};

/** Allocate a stable note identity and source anchor for an appended chord member. */
export function createAppendedNoteAtomIdentity(
  document: ScoreDocument,
  event: PitchedEvent,
): AppendedNoteAtomIdentity {
  const chordMemberNumber = event.notes.length + 1;
  const baseId = `${getIdentityBase(event)}-chord-${chordMemberNumber}`;
  const usedIds = collectUsedIdentityValues(document);
  let musicXmlElementId = baseId;
  let suffix = 2;
  while (usedIds.has(musicXmlElementId)) {
    musicXmlElementId = `${baseId}-${suffix++}`;
  }

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
