'use client';

import {
  applyAddModeInsertCommandToDomain,
  createAddModeNoteAtomId,
  type AddModeInsertCommand,
} from './add-mode-command';
import {
  exportEditorDomainToMusicXml,
  importMusicXmlToEditorDomain,
  type EventId,
  type InsertionAnchor,
  type MusicalPosition,
  type ScoreDocument,
  type StaffId,
  type VoiceId,
} from '@/lib/editor-domain';
import type { ScoreData } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml/parser';

export type ApplyAddModeDomainInsertResult =
  | {
      success: true;
      newXml: string;
      newScoreData: ScoreData;
      insertedEntityId: string;
      historyLabel: 'addNote';
    }
  | {
      success: false;
      error: string;
    };

export function applyAddModeDomainInsert(params: {
  currentXml: string;
  insertionAnchor: InsertionAnchor;
  command: AddModeInsertCommand;
  getExpectedVoices: (data: ScoreData | null) => Map<number, Map<number, number[]>> | undefined;
  scoreData: ScoreData;
}): ApplyAddModeDomainInsertResult {
  const imported = importMusicXmlToEditorDomain(params.currentXml);
  const target = getInsertionAnchorTarget(params.insertionAnchor);
  const targetDocument = ensureAddModeTarget(imported.document, target);
  const staff = targetDocument.staves.find((candidate) => candidate.id === target.staffId);
  const voice = targetDocument.voices.find((candidate) => candidate.id === target.voiceId);
  if (!staff || !voice) {
    return { success: false, error: 'Add-mode domain insert target could not be resolved.' };
  }

  const insertedEventId = createAddModeEventId(target, params.command);
  const insertedEntityId = params.command.kind === 'insertPitchedEvent'
    ? String(createAddModeNoteAtomId(insertedEventId as EventId))
    : insertedEventId;
  const applied = applyAddModeInsertCommandToDomain({
    document: targetDocument,
    eventId: insertedEventId as EventId,
    voiceId: voice.id,
    staffId: staff.id,
    position: target.position,
    command: params.command,
  });
  if (!applied.success) {
    return applied;
  }

  const newXml = exportEditorDomainToMusicXml(applied.document, getExportOptions(params.currentXml));
  const expectedVoices = params.getExpectedVoices(params.scoreData);
  const newScoreData = new MusicXMLParser(newXml, { expectedVoices }).parse();

  return {
    success: true,
    newXml,
    newScoreData,
    insertedEntityId,
    historyLabel: 'addNote',
  };
}

type AddModeInsertTarget = {
  staffId: StaffId;
  voiceId: VoiceId;
  position: MusicalPosition;
};

function getInsertionAnchorTarget(anchor: InsertionAnchor): AddModeInsertTarget {
  if (anchor.kind === 'caret') {
    return {
      staffId: anchor.caret.staffId,
      voiceId: anchor.caret.voiceId,
      position: anchor.caret.position,
    };
  }
  if (anchor.kind === 'timelineGap') {
    return {
      staffId: anchor.staffId,
      voiceId: anchor.voiceId,
      position: anchor.position,
    };
  }

  return {
    staffId: anchor.staffId,
    voiceId: anchor.voiceId,
    position: anchor.position,
  };
}

function ensureAddModeTarget(document: ScoreDocument, target: AddModeInsertTarget): ScoreDocument {
  const part = document.parts[0];
  const measure = document.measures.find((candidate) => candidate.id === target.position.measureId);
  if (!part || !measure) return document;

  const staff = document.staves.find((candidate) => candidate.id === target.staffId) ?? {
    id: target.staffId,
    partId: part.id,
    index: getTrailingNumber(String(target.staffId), 1) - 1,
  };
  const staves = document.staves.some((candidate) => candidate.id === staff.id)
    ? document.staves
    : [...document.staves, staff].sort((left, right) => left.index - right.index);

  const voice = document.voices.find((candidate) => candidate.id === target.voiceId) ?? {
    id: target.voiceId,
    partId: part.id,
    homeStaffId: staff.id,
    stemPolicy: 'automatic' as const,
  };
  const voices = document.voices.some((candidate) => candidate.id === voice.id)
    ? document.voices
    : [...document.voices, voice];

  return {
    ...document,
    staves,
    voices,
  };
}

function createAddModeEventId(target: AddModeInsertTarget, command: AddModeInsertCommand): string {
  return [
    command.kind === 'insertPitchedEvent' ? 'add-note' : 'add-rest',
    slugId(String(target.position.measureId)),
    slugId(String(target.staffId)),
    slugId(String(target.voiceId)),
    `o${rationalSlug(target.position.offset)}`,
  ].join('-');
}

function getExportOptions(xml: string) {
  const xmlDoc = parseMusicXml(xml);
  return {
    divisions: getPositiveInt(xmlDoc.querySelector('attributes > divisions')?.textContent, 4),
    timeSignature: {
      beats: getPositiveInt(xmlDoc.querySelector('attributes > time > beats')?.textContent, 4),
      beatType: getPositiveInt(xmlDoc.querySelector('attributes > time > beat-type')?.textContent, 4),
    },
  };
}

function parseMusicXml(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function getPositiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTrailingNumber(value: string, fallback: number): number {
  const match = value.match(/(\d+)$/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rationalSlug(value: MusicalPosition['offset']): string {
  return value.denominator === 1
    ? String(value.numerator)
    : `${value.numerator}_${value.denominator}`;
}

function slugId(value: string): string {
  return value.replace(/[^\dA-Za-z]+/g, '-').replace(/^-|-$/g, '');
}
