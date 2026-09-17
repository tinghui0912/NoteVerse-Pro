import {
  compareRational,
  createBeamRelationship,
  createExplicitRestEvent,
  createPitchedEvent,
  createSlurRelationship,
  createTieRelationship,
  deriveTimelineGaps,
  type BeamRelationship,
  type Accidental,
  type DerivedRest,
  type EventId,
  type MusicalPosition,
  type NoteAtom,
  type NoteAtomId,
  type NotationId,
  type PitchedEvent,
  type Pitch,
  type Rational,
  type RhythmicValue,
  type ScoreDocument,
  type StaffId,
  type TimelineGap,
  type TieId,
  type VoiceId,
  type VoiceEvent,
} from './model';
import type { EventNotationControl, StemDirectionOverride } from './notation-model';
import type { NotationPlacementOverride } from './notation-model';

export type CommandResult =
  | {
      success: true;
      document: ScoreDocument;
      gaps?: TimelineGap[];
    }
  | {
      success: false;
      error: string;
    };

export type BeamRelationshipAction = 'previous' | 'next' | 'break-left' | 'break-right';

export function addTieRelationship(params: {
  document: ScoreDocument;
  startNoteAtomId: NoteAtomId;
  stopNoteAtomId: NoteAtomId;
  tieId?: TieId;
}): CommandResult {
  if (!noteAtomExists(params.document, params.startNoteAtomId) || !noteAtomExists(params.document, params.stopNoteAtomId)) {
    return { success: false, error: 'Tie endpoints must reference existing note atoms.' };
  }
  if (params.document.tieRelationships.some((relationship) => (
    relationship.startNoteAtomId === params.startNoteAtomId
    && relationship.stopNoteAtomId === params.stopNoteAtomId
  ))) {
    return { success: false, error: 'Tie relationship already exists.' };
  }

  const startNote = findNoteAtom(params.document, params.startNoteAtomId);
  const stopNote = findNoteAtom(params.document, params.stopNoteAtomId);
  if (startNote?.tieOut || stopNote?.tieIn) {
    return { success: false, error: 'Tie endpoint already has a tie in the requested direction.' };
  }

  const tieId = params.tieId ?? createTieRelationshipId(params.startNoteAtomId, params.stopNoteAtomId);

  return {
    success: true,
    document: {
      ...params.document,
      events: params.document.events.map((event) => (
        event.kind === 'pitched'
          ? {
              ...event,
              notes: event.notes.map((note) => {
                if (note.id === params.startNoteAtomId) return { ...note, tieOut: tieId };
                if (note.id === params.stopNoteAtomId) return { ...note, tieIn: tieId };
                return note;
              }) as typeof event.notes,
            }
          : event
      )),
      tieRelationships: [
        ...params.document.tieRelationships,
        createTieRelationship({
          id: tieId,
          startNoteAtomId: params.startNoteAtomId,
          stopNoteAtomId: params.stopNoteAtomId,
        }),
      ],
    },
  };
}

export function deleteTieRelationship(params: {
  document: ScoreDocument;
  tieId: TieId;
}): CommandResult {
  const relationship = params.document.tieRelationships.find((candidate) => candidate.id === params.tieId);
  if (!relationship) {
    return { success: false, error: 'Tie relationship does not exist.' };
  }

  return {
    success: true,
    document: {
      ...params.document,
      events: params.document.events.map((event) => (
        event.kind === 'pitched'
          ? {
              ...event,
              notes: event.notes.map((note) => (
                note.tieIn === params.tieId || note.tieOut === params.tieId
                  ? {
                      ...note,
                      tieIn: note.tieIn === params.tieId ? undefined : note.tieIn,
                      tieOut: note.tieOut === params.tieId ? undefined : note.tieOut,
                    }
                  : note
              )) as typeof event.notes,
            }
          : event
      )),
      tieRelationships: params.document.tieRelationships.filter((candidate) => candidate.id !== params.tieId),
      notationControls: params.document.notationControls.filter((control) => (
        control.kind !== 'tieNotation' || control.tieId !== params.tieId
      )),
    },
  };
}

export function setTieRelationshipPlacement(params: {
  document: ScoreDocument;
  tieId: TieId;
  placement?: NotationPlacementOverride;
}): CommandResult {
  if (!params.document.tieRelationships.some((relationship) => relationship.id === params.tieId)) {
    return { success: false, error: 'Tie relationship does not exist.' };
  }

  const otherControls = params.document.notationControls.filter((control) => (
    control.kind !== 'tieNotation' || control.tieId !== params.tieId
  ));

  return {
    success: true,
    document: {
      ...params.document,
      notationControls: params.placement
        ? [
            ...otherControls,
            {
              kind: 'tieNotation',
              tieId: params.tieId,
              placement: params.placement,
            },
          ]
        : otherControls,
    },
  };
}

export function deleteSlurRelationship(params: {
  document: ScoreDocument;
  notationId: ScoreDocument['slurRelationships'][number]['id'];
}): CommandResult {
  if (!params.document.slurRelationships.some((relationship) => relationship.id === params.notationId)) {
    return { success: false, error: 'Slur relationship does not exist.' };
  }

  return {
    success: true,
    document: {
      ...params.document,
      slurRelationships: params.document.slurRelationships.filter((relationship) => (
        relationship.id !== params.notationId
      )),
      notationControls: params.document.notationControls.filter((control) => (
        control.kind !== 'slurNotation' || control.notationId !== params.notationId
      )),
    },
  };
}

export function addSlurRelationship(params: {
  document: ScoreDocument;
  startNoteAtomId: NoteAtomId;
  stopNoteAtomId: NoteAtomId;
  notationId?: NotationId;
}): CommandResult {
  if (!noteAtomExists(params.document, params.startNoteAtomId) || !noteAtomExists(params.document, params.stopNoteAtomId)) {
    return { success: false, error: 'Slur endpoints must reference existing note atoms.' };
  }
  if (params.document.slurRelationships.some((relationship) => (
    (
      relationship.startNoteAtomId === params.startNoteAtomId
      && relationship.stopNoteAtomId === params.stopNoteAtomId
    )
    || (
      relationship.startNoteAtomId === params.stopNoteAtomId
      && relationship.stopNoteAtomId === params.startNoteAtomId
    )
  ))) {
    return { success: false, error: 'Slur relationship already exists.' };
  }

  const notationId = params.notationId ?? createSlurRelationshipId(params.startNoteAtomId, params.stopNoteAtomId);

  return {
    success: true,
    document: {
      ...params.document,
      slurRelationships: [
        ...params.document.slurRelationships,
        createSlurRelationship({
          id: notationId,
          startNoteAtomId: params.startNoteAtomId,
          stopNoteAtomId: params.stopNoteAtomId,
        }),
      ],
    },
  };
}

export function setSlurRelationshipPlacement(params: {
  document: ScoreDocument;
  notationId: ScoreDocument['slurRelationships'][number]['id'];
  placement?: NotationPlacementOverride;
}): CommandResult {
  if (!params.document.slurRelationships.some((relationship) => relationship.id === params.notationId)) {
    return { success: false, error: 'Slur relationship does not exist.' };
  }

  const otherControls = params.document.notationControls.filter((control) => (
    control.kind !== 'slurNotation' || control.notationId !== params.notationId
  ));

  return {
    success: true,
    document: {
      ...params.document,
      notationControls: params.placement
        ? [
            ...otherControls,
            {
              kind: 'slurNotation',
              notationId: params.notationId,
              placement: params.placement,
            },
          ]
        : otherControls,
    },
  };
}

export function insertPitchedEvent(
  document: ScoreDocument,
  event: Omit<PitchedEvent, 'kind' | 'notes'> & { notes: NoteAtom[] }
): CommandResult {
  if (document.events.some((candidate) => candidate.id === event.id)) {
    return { success: false, error: 'Event id already exists.' };
  }

  try {
    return {
      success: true,
      document: withSortedEvents({
        ...document,
        events: [...document.events, createPitchedEvent(event)],
        notationControls: [...document.notationControls],
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to insert pitched event.',
    };
  }
}

export function insertExplicitRest(
  document: ScoreDocument,
  event: Parameters<typeof createExplicitRestEvent>[0]
): CommandResult {
  if (document.events.some((candidate) => candidate.id === event.id)) {
    return { success: false, error: 'Event id already exists.' };
  }

  return {
    success: true,
    document: withSortedEvents({
      ...document,
      events: [...document.events, createExplicitRestEvent(event)],
      notationControls: [...document.notationControls],
    }),
  };
}

export function deleteVoiceEvent(params: {
  document: ScoreDocument;
  eventId: EventId;
  measureDuration?: Rational;
}): CommandResult {
  const event = params.document.events.find((candidate) => candidate.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }

  const removedNoteAtomIds = event.kind === 'pitched'
    ? new Set(event.notes.map((note) => note.id))
    : new Set<NoteAtomId>();
  const removedTieIds = new Set(params.document.tieRelationships
    .filter((relationship) => (
      removedNoteAtomIds.has(relationship.startNoteAtomId)
      || removedNoteAtomIds.has(relationship.stopNoteAtomId)
    ))
    .map((relationship) => relationship.id));
  const removedSlurIds = new Set(params.document.slurRelationships
    .filter((relationship) => (
      removedNoteAtomIds.has(relationship.startNoteAtomId)
      || removedNoteAtomIds.has(relationship.stopNoteAtomId)
    ))
    .map((relationship) => relationship.id));
  const events = params.document.events.filter((candidate) => candidate.id !== params.eventId);
  const gaps = params.measureDuration
    ? deriveTimelineGaps({
        events,
        measureId: event.position.measureId,
        staffId: event.staffId,
        voiceId: event.voiceId,
        measureDuration: params.measureDuration,
      })
    : undefined;

  return {
    success: true,
    document: {
      ...params.document,
      events,
      beamRelationships: params.document.beamRelationships.filter((relationship) => (
        !relationship.eventIds.includes(params.eventId)
      )),
      tieRelationships: params.document.tieRelationships.filter((relationship) => (
        !removedTieIds.has(relationship.id)
      )),
      slurRelationships: params.document.slurRelationships.filter((relationship) => (
        !removedSlurIds.has(relationship.id)
      )),
      notationControls: params.document.notationControls.filter((control) => (
        (control.kind !== 'eventNotation' || control.eventId !== params.eventId)
        && (control.kind !== 'tieNotation' || !removedTieIds.has(control.tieId))
        && (control.kind !== 'slurNotation' || !removedSlurIds.has(control.notationId))
      )),
    },
    ...(gaps ? { gaps } : {}),
  };
}

export function addNoteAtom(params: {
  document: ScoreDocument;
  eventId: EventId;
  note: NoteAtom;
}): CommandResult {
  const event = params.document.events.find((candidate) => candidate.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }
  if (event.kind !== 'pitched') {
    return { success: false, error: 'Only pitched events can receive note atoms.' };
  }
  if (event.notes.some((note) => note.id === params.note.id)) {
    return { success: false, error: 'Note atom id already exists in event.' };
  }

  return replaceEvent(params.document, {
    ...event,
    notes: [...event.notes, params.note] as PitchedEvent['notes'],
  });
}

export function removeNoteAtom(params: {
  document: ScoreDocument;
  eventId: EventId;
  noteAtomId: NoteAtomId;
}): CommandResult {
  const event = params.document.events.find((candidate) => candidate.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }
  if (event.kind !== 'pitched') {
    return { success: false, error: 'Only pitched events contain note atoms.' };
  }
  if (!event.notes.some((note) => note.id === params.noteAtomId)) {
    return { success: false, error: 'Note atom does not exist in event.' };
  }
  if (event.notes.length === 1) {
    return { success: false, error: 'Cannot remove the last note atom from a pitched event. Delete the event instead.' };
  }

  const result = replaceEvent(params.document, {
    ...event,
    notes: event.notes.filter((note) => note.id !== params.noteAtomId) as PitchedEvent['notes'],
  });
  if (!result.success) return result;

  const removedTieIds = new Set(result.document.tieRelationships
    .filter((relationship) => (
      relationship.startNoteAtomId === params.noteAtomId
      || relationship.stopNoteAtomId === params.noteAtomId
    ))
    .map((relationship) => relationship.id));
  const removedSlurIds = new Set(result.document.slurRelationships
    .filter((relationship) => (
      relationship.startNoteAtomId === params.noteAtomId
      || relationship.stopNoteAtomId === params.noteAtomId
    ))
    .map((relationship) => relationship.id));

  return {
    ...result,
    document: {
      ...result.document,
      tieRelationships: result.document.tieRelationships.filter((relationship) => (
        !removedTieIds.has(relationship.id)
      )),
      slurRelationships: result.document.slurRelationships.filter((relationship) => (
        !removedSlurIds.has(relationship.id)
      )),
      notationControls: result.document.notationControls.filter((control) => (
        control.kind !== 'tieNotation' || !removedTieIds.has(control.tieId)
      )).filter((control) => (
        control.kind !== 'slurNotation' || !removedSlurIds.has(control.notationId)
      )),
    },
  };
}

export function updatePitchedEvent(params: {
  document: ScoreDocument;
  eventId: EventId;
  patch: {
    voiceId?: VoiceId;
    staffId?: StaffId;
    position?: MusicalPosition;
    rhythm?: RhythmicValue;
    notes?: NoteAtom[];
  };
}): CommandResult {
  const event = params.document.events.find((candidate) => candidate.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }
  if (event.kind !== 'pitched') {
    return { success: false, error: 'Only pitched events can be updated with pitched event drafts.' };
  }

  try {
    return replaceEvent(params.document, createPitchedEvent({
      ...event,
      ...omitUndefined(params.patch),
      notes: params.patch.notes ?? event.notes,
    }));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update pitched event.',
    };
  }
}

export function updateNoteAtom(params: {
  document: ScoreDocument;
  eventId: EventId;
  noteAtomId: NoteAtomId;
  patch: {
    pitch?: Pitch;
    accidental?: Accidental | null;
    fingering?: string | null;
  };
}): CommandResult {
  const event = params.document.events.find((candidate) => candidate.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }
  if (event.kind !== 'pitched') {
    return { success: false, error: 'Only pitched events contain note atoms.' };
  }
  if (!event.notes.some((note) => note.id === params.noteAtomId)) {
    return { success: false, error: 'Note atom does not exist in event.' };
  }

  return replaceEvent(params.document, {
    ...event,
    notes: event.notes.map((note) => {
      if (note.id !== params.noteAtomId) {
        return note;
      }
      return {
        ...note,
        ...(params.patch.pitch ? { pitch: params.patch.pitch } : {}),
        ...(
          Object.hasOwn(params.patch, 'accidental')
            ? { accidental: params.patch.accidental ?? undefined }
            : {}
        ),
        ...(
          Object.hasOwn(params.patch, 'fingering')
            ? { fingering: params.patch.fingering ?? undefined }
            : {}
        ),
      };
    }) as PitchedEvent['notes'],
  });
}

export function updateExplicitRest(params: {
  document: ScoreDocument;
  eventId: EventId;
  patch: {
    voiceId?: VoiceId;
    staffId?: StaffId;
    position?: MusicalPosition;
    rhythm?: RhythmicValue;
  };
}): CommandResult {
  const event = params.document.events.find((candidate) => candidate.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }
  if (event.kind !== 'explicitRest') {
    return { success: false, error: 'Only explicit rests can be updated with rest drafts.' };
  }

  return replaceEvent(params.document, createExplicitRestEvent({
    ...event,
    ...omitUndefined(params.patch),
  }));
}

export function materializeTimelineGapAsExplicitRest(params: {
  document: ScoreDocument;
  gap: TimelineGap;
  eventId: EventId;
  rhythm: RhythmicValue;
}): CommandResult {
  if (compareRational(params.rhythm.timelineDuration, params.gap.duration) > 0) {
    return { success: false, error: 'Explicit rest duration cannot exceed the selected timeline gap.' };
  }

  return insertExplicitRest(params.document, {
    id: params.eventId,
    voiceId: params.gap.voiceId,
    staffId: params.gap.staffId,
    position: params.gap.start,
    rhythm: params.rhythm,
  });
}

export function materializeDerivedRestAsExplicitRest(params: {
  document: ScoreDocument;
  rest: DerivedRest;
  eventId: EventId;
  rhythm?: RhythmicValue;
}): CommandResult {
  return materializeTimelineGapAsExplicitRest({
    document: params.document,
    gap: params.rest.sourceGap,
    eventId: params.eventId,
    rhythm: params.rhythm ?? params.rest.rhythm,
  });
}

export function setEventStemDirectionOverride(params: {
  document: ScoreDocument;
  eventId: EventId;
  stemDirection?: StemDirectionOverride;
}): CommandResult {
  const event = params.document.events.find((event) => event.id === params.eventId);
  if (!event) {
    return { success: false, error: 'Event does not exist.' };
  }
  if (event.kind !== 'pitched') {
    return { success: false, error: 'Only pitched events can have stem direction overrides.' };
  }

  const otherControls = params.document.notationControls.filter((control) => (
    control.kind !== 'eventNotation' || control.eventId !== params.eventId
  ));
  const nextControls = params.stemDirection
    ? [
        ...otherControls,
        {
          kind: 'eventNotation',
          eventId: params.eventId,
          stemDirection: params.stemDirection,
        } satisfies EventNotationControl,
      ]
    : otherControls;

  return {
    success: true,
    document: {
      ...params.document,
      notationControls: nextControls,
    },
  };
}

export function updateBeamRelationshipAtEvent(params: {
  document: ScoreDocument;
  eventId: EventId;
  action: BeamRelationshipAction;
}): CommandResult {
  const voiceEvents = getBeamContextEvents(params.document, params.eventId);
  const index = voiceEvents.findIndex((event) => event.id === params.eventId);
  if (index < 0 || !isBeamableEvent(voiceEvents[index])) {
    return { success: false, error: 'Selected event cannot be beamed.' };
  }

  const currentBounds = getBeamRelationshipBounds(params.document, voiceEvents, params.eventId) ?? [index, index];

  if (params.action === 'break-left' || params.action === 'break-right') {
    return splitBeamRelationship(params.document, voiceEvents, currentBounds, index, params.action);
  }

  const neighborIndex = params.action === 'previous' ? currentBounds[0] - 1 : currentBounds[1] + 1;
  if (neighborIndex < 0 || neighborIndex >= voiceEvents.length || !isBeamableEvent(voiceEvents[neighborIndex])) {
    return { success: false, error: 'Adjacent event cannot be joined into a beam.' };
  }

  const neighborBounds = getBeamRelationshipBounds(params.document, voiceEvents, voiceEvents[neighborIndex].id) ?? [neighborIndex, neighborIndex];
  const start = Math.min(currentBounds[0], neighborBounds[0]);
  const end = Math.max(currentBounds[1], neighborBounds[1]);
  const nextEvents = voiceEvents.slice(start, end + 1);
  if (!nextEvents.every(isBeamableEvent)) {
    return { success: false, error: 'Beam relationship cannot include rests, gaps, or unbeamable durations.' };
  }

  return replaceBeamRelationships(params.document, nextEvents);
}

function replaceEvent(document: ScoreDocument, event: VoiceEvent): CommandResult {
  return {
    success: true,
    document: withSortedEvents({
      ...document,
      events: document.events.map((candidate) => candidate.id === event.id ? event : candidate),
    }),
  };
}

function splitBeamRelationship(
  document: ScoreDocument,
  voiceEvents: VoiceEvent[],
  bounds: [number, number],
  index: number,
  action: Extract<BeamRelationshipAction, 'break-left' | 'break-right'>,
): CommandResult {
  if (bounds[0] === bounds[1]) {
    return { success: false, error: 'Selected event is not inside a multi-event beam.' };
  }

  const splitAfter = action === 'break-left' ? index - 1 : index;
  if (splitAfter < bounds[0] || splitAfter >= bounds[1]) {
    return { success: false, error: 'Beam cannot be split at the selected edge.' };
  }

  const left = voiceEvents.slice(bounds[0], splitAfter + 1);
  const right = voiceEvents.slice(splitAfter + 1, bounds[1] + 1);
  return replaceBeamRelationships(document, ...[left, right].filter((events) => events.length >= 2));
}

function replaceBeamRelationships(document: ScoreDocument, ...groups: VoiceEvent[][]): CommandResult {
  const nextGroupEventIds = groups.flatMap((group) => group.map((event) => event.id));
  const nextGroupEventIdSet = new Set(nextGroupEventIds);
  const unrelatedRelationships = document.beamRelationships.filter((relationship) => (
    !relationship.eventIds.some((eventId) => nextGroupEventIdSet.has(eventId))
  ));
  const nextRelationships = groups.map((group) => createBeamRelationship({
    id: createBeamRelationshipId(group),
    eventIds: group.map((event) => event.id),
  }));

  return {
    success: true,
    document: {
      ...document,
      beamRelationships: [...unrelatedRelationships, ...nextRelationships],
    },
  };
}

function getBeamContextEvents(document: ScoreDocument, eventId: EventId): VoiceEvent[] {
  const event = document.events.find((candidate) => candidate.id === eventId);
  if (!event) return [];
  return document.events
    .filter((candidate) => (
      candidate.voiceId === event.voiceId
      && candidate.staffId === event.staffId
      && candidate.position.measureId === event.position.measureId
    ))
    .sort((left, right) => compareRational(left.position.offset, right.position.offset));
}

function getBeamRelationshipBounds(
  document: ScoreDocument,
  voiceEvents: VoiceEvent[],
  eventId: EventId,
): [number, number] | null {
  const relationship = document.beamRelationships.find((candidate) => candidate.eventIds.includes(eventId));
  if (!relationship) return null;
  const indexes = relationship.eventIds
    .map((relationshipEventId) => voiceEvents.findIndex((event) => event.id === relationshipEventId))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  if (indexes.length === 0) return null;
  return [indexes[0], indexes[indexes.length - 1]];
}

function isBeamableEvent(event: VoiceEvent | undefined): event is Extract<VoiceEvent, { kind: 'pitched' }> {
  if (!event || event.kind !== 'pitched') return false;
  return event.rhythm.notation.base === 'eighth'
    || event.rhythm.notation.base === '16th'
    || event.rhythm.notation.base === '32nd'
    || event.rhythm.notation.base === '64th';
}

function createBeamRelationshipId(events: VoiceEvent[]): BeamRelationship['id'] {
  return `${events[0]?.id ?? 'beam'}--beam--${events.at(-1)?.id ?? 'beam'}` as BeamRelationship['id'];
}

function createTieRelationshipId(startNoteAtomId: NoteAtomId, stopNoteAtomId: NoteAtomId): TieId {
  return `${startNoteAtomId}--tie--${stopNoteAtomId}` as TieId;
}

function createSlurRelationshipId(startNoteAtomId: NoteAtomId, stopNoteAtomId: NoteAtomId): NotationId {
  return `${startNoteAtomId}--slur--${stopNoteAtomId}` as NotationId;
}

function noteAtomExists(document: ScoreDocument, noteAtomId: NoteAtomId): boolean {
  return Boolean(findNoteAtom(document, noteAtomId));
}

function findNoteAtom(document: ScoreDocument, noteAtomId: NoteAtomId): NoteAtom | null {
  for (const event of document.events) {
    if (event.kind !== 'pitched') continue;
    const note = event.notes.find((candidate) => candidate.id === noteAtomId);
    if (note) return note;
  }
  return null;
}

function withSortedEvents(document: ScoreDocument): ScoreDocument {
  return {
    ...document,
    events: [...document.events].sort((left, right) => {
      const measureOrder = String(left.position.measureId).localeCompare(String(right.position.measureId));
      if (measureOrder !== 0) return measureOrder;

      const voiceOrder = String(left.voiceId).localeCompare(String(right.voiceId));
      if (voiceOrder !== 0) return voiceOrder;

      const staffOrder = String(left.staffId).localeCompare(String(right.staffId));
      if (staffOrder !== 0) return staffOrder;

      return compareRationalForSort(left.position.offset, right.position.offset);
    }),
  };
}

function compareRationalForSort(left: Rational, right: Rational): number {
  return left.numerator * right.denominator - right.numerator * left.denominator;
}

function omitUndefined<TPatch extends Record<string, unknown>>(patch: TPatch): Partial<TPatch> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<TPatch>;
}
