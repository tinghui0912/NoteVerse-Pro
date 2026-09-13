import type {
  Measure,
  Part,
  Pitch,
  Rational,
  RhythmicValue,
  ScoreDocument,
  Staff,
  Voice,
  VoiceEvent,
} from './model';
import {
  getEventNotationControl,
  type EventNotationControl,
  type NotationPlacementOverride,
  type SlurNotationControl,
  type TieNotationControl,
} from './notation-model';

export type MusicXmlExportOptions = {
  divisions?: number;
  timeSignature?: {
    beats: number;
    beatType: number;
  };
};

export function exportEditorDomainToMusicXml(
  document: ScoreDocument,
  options: MusicXmlExportOptions = {}
): string {
  const divisions = options.divisions ?? 4;
  const timeSignature = options.timeSignature ?? { beats: 4, beatType: 4 };
  const xmlDoc = new DOMParser().parseFromString('<score-partwise version="4.0"/>', 'application/xml');
  const root = xmlDoc.documentElement;

  const partList = xmlDoc.createElement('part-list');
  document.parts.forEach((part) => {
    partList.appendChild(createScorePartElement(xmlDoc, part));
  });
  root.appendChild(partList);

  document.parts.forEach((part) => {
    const partElement = xmlDoc.createElement('part');
    partElement.setAttribute('id', String(part.id));
    document.measures.forEach((measure, measureIndex) => {
      partElement.appendChild(createMeasureElement(xmlDoc, {
        part,
        measure,
        measureIndex,
        document,
        divisions,
        timeSignature,
      }));
    });
    root.appendChild(partElement);
  });

  writeTieRelationships(xmlDoc, document);
  writeSlurRelationships(xmlDoc, document);
  writeBeamRelationships(xmlDoc, document);

  return serializeXml(xmlDoc);
}

function createScorePartElement(xmlDoc: XMLDocument, part: Part): Element {
  const scorePart = xmlDoc.createElement('score-part');
  scorePart.setAttribute('id', String(part.id));

  const partName = xmlDoc.createElement('part-name');
  partName.textContent = part.name;
  scorePart.appendChild(partName);

  return scorePart;
}

function createMeasureElement(
  xmlDoc: XMLDocument,
  params: {
    part: Part;
    measure: Measure;
    measureIndex: number;
    document: ScoreDocument;
    divisions: number;
    timeSignature: { beats: number; beatType: number };
  }
): Element {
  const measureElement = xmlDoc.createElement('measure');
  measureElement.setAttribute('number', String(params.measure.number));

  if (params.measureIndex === 0) {
    measureElement.appendChild(createAttributesElement(xmlDoc, params));
  }

  const partVoices = params.document.voices
    .filter((voice) => voice.partId === params.part.id)
    .sort((left, right) => getVoiceNumber(params.document, left) - getVoiceNumber(params.document, right));
  let previousVoiceCursor = 0;

  partVoices.forEach((voice, voiceIndex) => {
    if (voiceIndex > 0 && previousVoiceCursor > 0) {
      measureElement.appendChild(createBackupElement(xmlDoc, previousVoiceCursor));
      previousVoiceCursor = 0;
    }

    const voiceEvents = params.document.events
      .filter((event) => event.voiceId === voice.id && event.position.measureId === params.measure.id)
      .sort((left, right) => rationalToTicks(left.position.offset, params.divisions) - rationalToTicks(right.position.offset, params.divisions));
    let cursor = 0;

    voiceEvents.forEach((event) => {
      const startTicks = rationalToTicks(event.position.offset, params.divisions);
      if (startTicks > cursor) {
        const eventStaff = getStaffNumber(params.document, event.staffId);
        const voiceNumber = getVoiceNumber(params.document, voice);
        const forwardDuration = startTicks - cursor;
        measureElement.appendChild(createForwardElement(xmlDoc, forwardDuration, voiceNumber, eventStaff));
        cursor = startTicks;
      }

      createVoiceEventElements(xmlDoc, {
        document: params.document,
        event,
        voice,
        divisions: params.divisions,
      }).forEach((element) => measureElement.appendChild(element));

      cursor = Math.max(cursor, startTicks + rationalToTicks(event.rhythm.timelineDuration, params.divisions));
    });

    previousVoiceCursor = cursor;
  });

  return measureElement;
}

function createAttributesElement(
  xmlDoc: XMLDocument,
  params: {
    part: Part;
    document: ScoreDocument;
    divisions: number;
    timeSignature: { beats: number; beatType: number };
  }
): Element {
  const attributes = xmlDoc.createElement('attributes');

  const divisions = xmlDoc.createElement('divisions');
  divisions.textContent = String(params.divisions);
  attributes.appendChild(divisions);

  const time = xmlDoc.createElement('time');
  const beats = xmlDoc.createElement('beats');
  beats.textContent = String(params.timeSignature.beats);
  const beatType = xmlDoc.createElement('beat-type');
  beatType.textContent = String(params.timeSignature.beatType);
  time.append(beats, beatType);
  attributes.appendChild(time);

  const staves = params.document.staves.filter((staff) => staff.partId === params.part.id);
  if (staves.length > 1) {
    const stavesElement = xmlDoc.createElement('staves');
    stavesElement.textContent = String(staves.length);
    attributes.appendChild(stavesElement);
  }

  return attributes;
}

function createVoiceEventElements(
  xmlDoc: XMLDocument,
  params: {
    document: ScoreDocument;
    event: VoiceEvent;
    voice: Voice;
    divisions: number;
  }
): Element[] {
  const voiceNumber = getVoiceNumber(params.document, params.voice);
  const staffNumber = getStaffNumber(params.document, params.event.staffId);

  if (params.event.kind === 'explicitRest') {
    return [createRestElement(xmlDoc, params.event, voiceNumber, staffNumber, params.divisions)];
  }

  return params.event.notes.map((note, index) => (
    createPitchedNoteElement(xmlDoc, {
      eventNotation: index === 0
        ? getEventNotationControl(params.document.notationControls, params.event.id)
        : undefined,
      pitch: note.pitch,
      rhythm: params.event.rhythm,
      voiceNumber,
      staffNumber,
      divisions: params.divisions,
      isChordMember: index > 0,
      id: String(note.id),
      accidental: note.accidental,
      fingering: note.fingering,
    })
  ));
}

function createPitchedNoteElement(
  xmlDoc: XMLDocument,
  params: {
    pitch: Pitch;
    eventNotation?: EventNotationControl;
    rhythm: RhythmicValue;
    voiceNumber: number;
    staffNumber: number;
    divisions: number;
    isChordMember: boolean;
    id: string;
    accidental?: string | null;
    fingering?: string;
  }
): Element {
  const note = xmlDoc.createElement('note');
  note.setAttribute('id', params.id);

  if (params.isChordMember) {
    note.appendChild(xmlDoc.createElement('chord'));
  }

  const pitch = xmlDoc.createElement('pitch');
  const step = xmlDoc.createElement('step');
  step.textContent = params.pitch.step;
  pitch.appendChild(step);
  if (params.pitch.alter !== undefined && params.pitch.alter !== 0) {
    const alter = xmlDoc.createElement('alter');
    alter.textContent = String(params.pitch.alter);
    pitch.appendChild(alter);
  }
  const octave = xmlDoc.createElement('octave');
  octave.textContent = String(params.pitch.octave);
  pitch.appendChild(octave);
  note.appendChild(pitch);

  appendSharedNoteChildren(xmlDoc, note, params);

  if (params.eventNotation?.stemDirection) {
    const stem = xmlDoc.createElement('stem');
    stem.textContent = params.eventNotation.stemDirection;
    note.appendChild(stem);
  }

  if (params.accidental) {
    const accidental = xmlDoc.createElement('accidental');
    accidental.textContent = params.accidental;
    note.appendChild(accidental);
  }

  if (params.fingering) {
    const notations = xmlDoc.createElement('notations');
    const technical = xmlDoc.createElement('technical');
    const fingering = xmlDoc.createElement('fingering');
    fingering.textContent = params.fingering;
    technical.appendChild(fingering);
    notations.appendChild(technical);
    note.appendChild(notations);
  }

  return note;
}

function createRestElement(
  xmlDoc: XMLDocument,
  event: Extract<VoiceEvent, { kind: 'explicitRest' }>,
  voiceNumber: number,
  staffNumber: number,
  divisions: number
): Element {
  const note = xmlDoc.createElement('note');
  if (event.source?.musicXmlElementId) {
    note.setAttribute('id', event.source.musicXmlElementId);
  } else {
    note.setAttribute('id', String(event.id));
  }
  note.appendChild(xmlDoc.createElement('rest'));
  appendSharedNoteChildren(xmlDoc, note, {
    rhythm: event.rhythm,
    voiceNumber,
    staffNumber,
    divisions,
  });
  return note;
}

function appendSharedNoteChildren(
  xmlDoc: XMLDocument,
  note: Element,
  params: {
    rhythm: RhythmicValue;
    voiceNumber: number;
    staffNumber: number;
    divisions: number;
  }
): void {
  const duration = xmlDoc.createElement('duration');
  duration.textContent = String(rationalToTicks(params.rhythm.timelineDuration, params.divisions));
  note.appendChild(duration);

  const voice = xmlDoc.createElement('voice');
  voice.textContent = String(params.voiceNumber);
  note.appendChild(voice);

  const type = xmlDoc.createElement('type');
  type.textContent = params.rhythm.notation.base;
  note.appendChild(type);

  for (let index = 0; index < params.rhythm.notation.dots; index += 1) {
    note.appendChild(xmlDoc.createElement('dot'));
  }

  const staff = xmlDoc.createElement('staff');
  staff.textContent = String(params.staffNumber);
  note.appendChild(staff);
}

function createForwardElement(xmlDoc: XMLDocument, durationTicks: number, voiceNumber: number, staffNumber: number): Element {
  const forward = xmlDoc.createElement('forward');
  const duration = xmlDoc.createElement('duration');
  duration.textContent = String(durationTicks);
  forward.appendChild(duration);

  const voice = xmlDoc.createElement('voice');
  voice.textContent = String(voiceNumber);
  forward.appendChild(voice);

  const staff = xmlDoc.createElement('staff');
  staff.textContent = String(staffNumber);
  forward.appendChild(staff);

  return forward;
}

function createBackupElement(xmlDoc: XMLDocument, durationTicks: number): Element {
  const backup = xmlDoc.createElement('backup');
  const duration = xmlDoc.createElement('duration');
  duration.textContent = String(durationTicks);
  backup.appendChild(duration);
  return backup;
}

function writeBeamRelationships(xmlDoc: XMLDocument, document: ScoreDocument): void {
  document.beamRelationships.forEach((relationship) => {
    const roots = relationship.eventIds
      .map((eventId) => findRootNoteForEvent(xmlDoc, document, eventId))
      .filter((note): note is Element => Boolean(note));
    if (roots.length < 2) return;

    roots.forEach((note, index) => {
      note.querySelectorAll(':scope > beam').forEach((beam) => {
        if (Number.parseInt(beam.getAttribute('number') ?? '1', 10) === 1) beam.remove();
      });
      const beam = xmlDoc.createElement('beam');
      beam.setAttribute('number', '1');
      beam.textContent = index === 0
        ? 'begin'
        : index === roots.length - 1 ? 'end' : 'continue';
      const staff = note.querySelector(':scope > staff');
      if (staff) staff.after(beam);
      else note.appendChild(beam);
    });
  });
}

function writeTieRelationships(xmlDoc: XMLDocument, document: ScoreDocument): void {
  document.tieRelationships.forEach((relationship) => {
    const startNote = findNoteForNoteAtom(xmlDoc, relationship.startNoteAtomId);
    const stopNote = findNoteForNoteAtom(xmlDoc, relationship.stopNoteAtomId);
    if (!startNote || !stopNote) return;

    addTieElement(xmlDoc, startNote, 'start');
    addTieElement(xmlDoc, stopNote, 'stop');
    addTiedNotation(xmlDoc, startNote, 'start', getTiePlacement(document, relationship.id));
    addTiedNotation(xmlDoc, stopNote, 'stop');
  });
}

function writeSlurRelationships(xmlDoc: XMLDocument, document: ScoreDocument): void {
  document.slurRelationships.forEach((relationship, index) => {
    const startNote = findNoteForNoteAtom(xmlDoc, relationship.startNoteAtomId);
    const stopNote = findNoteForNoteAtom(xmlDoc, relationship.stopNoteAtomId);
    if (!startNote || !stopNote) return;

    const number = index + 1;
    addSlurNotation(xmlDoc, startNote, 'start', number, getSlurPlacement(document, relationship.id));
    addSlurNotation(xmlDoc, stopNote, 'stop', number);
  });
}

function addSlurNotation(
  xmlDoc: XMLDocument,
  note: Element,
  type: 'start' | 'stop',
  number: number,
  placement?: NotationPlacementOverride,
): void {
  let notations = note.querySelector(':scope > notations');
  if (!notations) {
    notations = xmlDoc.createElement('notations');
    note.appendChild(notations);
  }

  const slur = xmlDoc.createElement('slur');
  slur.setAttribute('type', type);
  slur.setAttribute('number', String(number));
  if (type === 'start' && placement) {
    slur.setAttribute('placement', placement);
  }
  notations.appendChild(slur);
}

function addTieElement(xmlDoc: XMLDocument, note: Element, type: 'start' | 'stop'): void {
  if (note.querySelector(`:scope > tie[type="${type}"]`)) return;
  const tie = xmlDoc.createElement('tie');
  tie.setAttribute('type', type);
  const voice = note.querySelector(':scope > voice');
  if (voice) note.insertBefore(tie, voice);
  else note.appendChild(tie);
}

function addTiedNotation(
  xmlDoc: XMLDocument,
  note: Element,
  type: 'start' | 'stop',
  placement?: NotationPlacementOverride,
): void {
  let notations = note.querySelector(':scope > notations');
  if (!notations) {
    notations = xmlDoc.createElement('notations');
    note.appendChild(notations);
  }

  let tied = notations.querySelector(`:scope > tied[type="${type}"]`);
  if (!tied) {
    tied = xmlDoc.createElement('tied');
    tied.setAttribute('type', type);
    notations.appendChild(tied);
  }
  if (type === 'start' && placement) {
    tied.setAttribute('orientation', placement === 'above' ? 'over' : 'under');
  }
}

function getTiePlacement(
  document: ScoreDocument,
  tieId: ScoreDocument['tieRelationships'][number]['id'],
): NotationPlacementOverride | undefined {
  return document.notationControls.find((control): control is TieNotationControl => (
    control.kind === 'tieNotation' && control.tieId === tieId
  ))?.placement;
}

function getSlurPlacement(
  document: ScoreDocument,
  notationId: ScoreDocument['slurRelationships'][number]['id'],
): NotationPlacementOverride | undefined {
  return document.notationControls.find((control): control is SlurNotationControl => (
    control.kind === 'slurNotation' && control.notationId === notationId
  ))?.placement;
}

function findRootNoteForEvent(
  xmlDoc: XMLDocument,
  document: ScoreDocument,
  eventId: VoiceEvent['id'],
): Element | null {
  const event = document.events.find((candidate) => candidate.id === eventId);
  if (!event || event.kind !== 'pitched') return null;
  const rootId = String(event.notes[0]?.id ?? '');
  if (!rootId) return null;
  return Array.from(xmlDoc.querySelectorAll('note')).find((note) => note.getAttribute('id') === rootId) ?? null;
}

function findNoteForNoteAtom(xmlDoc: XMLDocument, noteAtomId: string): Element | null {
  return Array.from(xmlDoc.querySelectorAll('note')).find((note) => note.getAttribute('id') === noteAtomId) ?? null;
}

function getVoiceNumber(document: ScoreDocument, voice: Voice): number {
  const voiceNumber = String(voice.id).match(/voice-(\d+)$/)?.[1];
  if (voiceNumber) return Number.parseInt(voiceNumber, 10);

  return document.voices
    .filter((candidate) => candidate.partId === voice.partId)
    .findIndex((candidate) => candidate.id === voice.id) + 1;
}

function getStaffNumber(document: ScoreDocument, staffId: Staff['id']): number {
  const staff = document.staves.find((candidate) => candidate.id === staffId);
  return staff ? staff.index + 1 : 1;
}

function rationalToTicks(value: Rational, divisions: number): number {
  return Math.round((value.numerator / value.denominator) * divisions);
}

function serializeXml(xmlDoc: XMLDocument): string {
  return new XMLSerializer()
    .serializeToString(xmlDoc)
    .replace(/></g, '>\n<');
}
