import { applyAddModeInsertCommandToDomain, type AddModeInsertCommand } from './add-mode-command';
import {
  effectiveMeasureContext,
  compareRational,
  addRational,
  type ScoreDocument,
  type Voice,
  type EventId,
  type InsertionAnchor,
  type CommandResult,
} from '@/lib/editor-domain';
export function applyAddModeDomainInsert(params: {
  document: ScoreDocument;
  insertionAnchor: InsertionAnchor;
  command: AddModeInsertCommand;
  inputVoices: Voice[];
}): CommandResult {
  const { document, command } = params;
  const anchor = params.insertionAnchor;
  const target = anchor.kind === 'caret' ? anchor.caret : anchor;
  const staff = document.staves.find((staff) => staff.id === target.staffId);
  const voice = [...document.voices, ...params.inputVoices].find(
    (voice) => voice.id === target.voiceId,
  );
  if (!staff || !voice || staff.partId !== voice.partId)
    return { success: false, error: 'A declared staff and input voice are required.' };
  const measure = document.measures.find((measure) => measure.id === target.position.measureId);
  if (!measure || measure.partId !== staff.partId)
    return { success: false, error: 'The insertion measure must belong to the target part.' };
  const context = effectiveMeasureContext(document, target.position.measureId, staff.id);
  if (!context.duration)
    return { success: false, error: 'A known meter is required for rhythmic insertion.' };
  if (command.kind === 'insertPitchedEvent' && !context.clef)
    return { success: false, error: 'A known clef is required for pitch insertion.' };
  if (
    compareRational(
      addRational(target.position.offset, command.inputDuration.rhythm.timelineDuration),
      context.duration,
    ) > 0
  )
    return { success: false, error: 'The event exceeds the measure duration.' };
  const withVoice = document.voices.some((item) => item.id === voice.id)
    ? document
    : { ...document, voices: [...document.voices, voice] };
  const base = `event-${voice.number}-${document.events.length + 1}`;
  let id = base;
  let suffix = 2;
  while (document.events.some((event) => event.id === id)) id = `${base}-${suffix++}`;
  return applyAddModeInsertCommandToDomain({
    document: withVoice,
    eventId: id as EventId,
    voiceId: voice.id,
    staffId: staff.id,
    position: target.position,
    command,
  });
}
