import { isPracticePianoKey, type PracticePianoKey } from './piano-key';

export class PracticeScoreContractError extends Error {
  readonly code = 'practice_score_invalid';
}
export const PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 3 as const;

/** Each retained notation fact occurs once, including its event and render ownership. */
export type PracticeScoreNote = {
  noteId: string; eventId: string; pianoKey: PracticePianoKey; renderNoteId: string;
  measureNumber: string; staffId: string; voiceId: string; tieTypes: ('start' | 'stop')[];
};
export type PracticeScoreEvent = { eventId: string; onsetBeat: number; durationBeats: number };
export type PracticeAttack = { attackId: string; pianoKey: PracticePianoKey; noteIds: string[] };
/** The single target sequence. groupId also owns scope identity; no step/group identity map. */
export type PracticeMoment = {
  groupId: string; onsetBeat: number; canonicalEndBeat: number;
  attacks: PracticeAttack[]; continuationNoteIds: string[];
};
export type MeterSegment = {
  startBeat: number; numerator: number; denominator: number; measureDurationBeats: number; countInPulses: number;
  source: 'MUSICXML' | 'DEFAULT_4_4';
};
export type TempoSegment = { startBeat: number; bpm: number };
export type PracticeScoreArtifact = {
  schemaVersion: typeof PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION;
  scoreId: string; revisionId: string; artifactId: string;
  notes: PracticeScoreNote[]; events: PracticeScoreEvent[]; moments: PracticeMoment[];
  meterSegments: MeterSegment[]; scoreTempoSegments: TempoSegment[];
  firstPlayableBeat: number; scoreEndBeat: number;
};

/** Validate untrusted transport, never upgrade, repair, coerce or mutate it. */
export function parsePracticeScoreArtifact(value: unknown): PracticeScoreArtifact {
  assertPracticeScoreArtifact(value);
  return value;
}

export function assertPracticeScoreArtifact(value: unknown): asserts value is PracticeScoreArtifact {
  const root = object(value, 'schemaVersion scoreId revisionId artifactId notes events moments meterSegments scoreTempoSegments firstPlayableBeat scoreEndBeat');
  if (root.schemaVersion !== PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION) fail('Unsupported PracticeScoreArtifact schema.');
  for (const key of ['scoreId', 'revisionId', 'artifactId']) identity(root[key]);
  const noteRows = array(root.notes), eventRows = array(root.events), momentRows = array(root.moments);
  if (!noteRows.length || !eventRows.length || !momentRows.length) fail('PracticeScoreArtifact has no playable targets.');
  const notes = new Map<string, PracticeScoreNote>(), renderIds = new Set<string>();
  for (const raw of noteRows) {
    const n = object(raw, 'noteId eventId pianoKey renderNoteId measureNumber staffId voiceId tieTypes');
    identity(n.noteId); identity(n.eventId); identity(n.renderNoteId);
    if (!isPracticePianoKey(n.pianoKey)) fail('Invalid Practice piano key.');
    for (const key of ['measureNumber', 'staffId', 'voiceId']) if (typeof n[key] !== 'string') fail('Invalid notation metadata.');
    const ties = array(n.tieTypes);
    if (new Set(ties).size !== ties.length || ties.some(t => t !== 'start' && t !== 'stop')) fail('Invalid tie facts.');
    if (notes.has(n.noteId) || renderIds.has(n.renderNoteId)) fail('Duplicate canonical note/render identity.');
    notes.set(n.noteId, raw as PracticeScoreNote); renderIds.add(n.renderNoteId);
  }
  const events = new Map<string, PracticeScoreEvent>();
  let previous = -Infinity, endBeat = -Infinity;
  for (const raw of eventRows) {
    const e = object(raw, 'eventId onsetBeat durationBeats'); identity(e.eventId);
    number(e.onsetBeat); number(e.durationBeats);
    if (e.onsetBeat < previous || e.durationBeats < 0 || events.has(e.eventId)) fail('Invalid event chronology/identity.');
    events.set(e.eventId, raw as PracticeScoreEvent); previous = e.onsetBeat;
    endBeat = Math.max(endBeat, e.onsetBeat + e.durationBeats);
  }
  const byEvent = new Map<string, PracticeScoreNote[]>(), byOnset = new Map<number, PracticeScoreNote[]>();
  for (const note of notes.values()) {
    const event = events.get(note.eventId); if (!event) fail('Dangling note event.');
    const owned = byEvent.get(note.eventId) ?? []; owned.push(note); byEvent.set(note.eventId, owned);
    const onset = byOnset.get(event.onsetBeat) ?? []; onset.push(note); byOnset.set(event.onsetBeat, onset);
  }
  if (byEvent.size !== events.size) fail('Event without canonical notation.');
  number(root.firstPlayableBeat); number(root.scoreEndBeat);
  if (root.firstPlayableBeat !== (eventRows[0] as PracticeScoreEvent).onsetBeat || root.scoreEndBeat !== roundBeat(endBeat)) fail('Invalid canonical score extent.');
  const expectedOnsets = [...byOnset].filter(([, ns]) => ns.some(n => !n.tieTypes.includes('stop'))).map(([onset]) => onset).sort((a,b) => a-b);
  if (expectedOnsets.length !== momentRows.length) fail('Moments must cover every attack onset exactly.');
  const groupIds = new Set<string>(), attackIds = new Set<string>();
  momentRows.forEach((raw, index) => {
    const m = object(raw, 'groupId onsetBeat canonicalEndBeat attacks continuationNoteIds'); identity(m.groupId);
    number(m.onsetBeat); number(m.canonicalEndBeat);
    if (groupIds.has(m.groupId) || m.onsetBeat !== expectedOnsets[index]) fail('Invalid moment identity/chronology.');
    groupIds.add(m.groupId);
    const onsetNotes = byOnset.get(m.onsetBeat)!;
    const expected = new Set(onsetNotes.filter(n => !n.tieTypes.includes('stop')).map(n => n.noteId));
    const continuation = onsetNotes.filter(n => n.tieTypes.includes('stop')).map(n => n.noteId);
    const attacks = array(m.attacks), owned = new Set<string>(), keys = new Set<number>();
    if (!attacks.length) fail('Empty physical attacks.');
    for (const rawAttack of attacks) {
      const a = object(rawAttack, 'attackId pianoKey noteIds'); identity(a.attackId);
      if (!isPracticePianoKey(a.pianoKey) || keys.has(a.pianoKey) || attackIds.has(a.attackId)) fail('Invalid physical attack identity/key.');
      keys.add(a.pianoKey); attackIds.add(a.attackId);
      const ids = references(a.noteIds); if (!ids.length) fail('Empty attack note references.');
      for (const id of ids) {
        if (!expected.has(id) || owned.has(id) || notes.get(id)?.pianoKey !== a.pianoKey) fail('Invalid attack note ownership.');
        owned.add(id);
      }
    }
    if (owned.size !== expected.size) fail('Missing physical attack note reference.');
    const continuationIds = references(m.continuationNoteIds);
    if (continuationIds.length !== continuation.length || continuationIds.some(id => !continuation.includes(id))) fail('Invalid continuation membership.');
    const expectedEnd = roundBeat([...expected].reduce((end, id) => Math.max(end, soundingEnd(notes.get(id)!, notes, events)), -Infinity));
    if (m.canonicalEndBeat !== expectedEnd) fail('Invalid canonicalEndBeat.');
  });
  let tempoBeat = -1;
  for (const raw of array(root.scoreTempoSegments)) {
    const t = object(raw, 'startBeat bpm'); number(t.startBeat); number(t.bpm);
    if (t.startBeat < 0 || t.startBeat <= tempoBeat || t.bpm <= 0) fail('Invalid score tempo chronology.');
    tempoBeat = t.startBeat;
  }
  let meterBeat = -1;
  for (const raw of array(root.meterSegments)) {
    const m = object(raw, 'startBeat numerator denominator measureDurationBeats countInPulses source');
    for (const key of ['startBeat', 'numerator', 'denominator', 'measureDurationBeats', 'countInPulses']) number(m[key]);
    if ((m.startBeat as number) < 0 || (m.startBeat as number) <= meterBeat || (m.numerator as number) < 1 || (m.denominator as number) < 1
      || (m.measureDurationBeats as number) <= 0 || (m.countInPulses as number) < 0 || !['numerator','denominator','countInPulses'].every(key => Number.isInteger(m[key])) || !['MUSICXML','DEFAULT_4_4'].includes(m.source as string)) fail('Invalid meter contract.');
    meterBeat = m.startBeat as number;
  }
}

function soundingEnd(note: PracticeScoreNote, notes: ReadonlyMap<string, PracticeScoreNote>, events: ReadonlyMap<string, PracticeScoreEvent>): number {
  let current = note, event = events.get(note.eventId)!;
  let end = event.onsetBeat + event.durationBeats;
  const visited = new Set([note.noteId]);
  while (current.tieTypes.includes('start')) {
    const candidates = [...notes.values()].filter(n => !visited.has(n.noteId) && n.tieTypes.includes('stop')
      && n.pianoKey === current.pianoKey && n.staffId === current.staffId && n.voiceId === current.voiceId
      && events.get(n.eventId)!.onsetBeat >= event.onsetBeat && events.get(n.eventId)!.onsetBeat <= event.onsetBeat + event.durationBeats);
    candidates.sort((a,b) => events.get(a.eventId)!.onsetBeat - events.get(b.eventId)!.onsetBeat);
    if (!candidates.length) break;
    current = candidates[0]; visited.add(current.noteId); event = events.get(current.eventId)!;
    end = Math.max(end, event.onsetBeat + event.durationBeats);
  }
  return end;
}

export function notesForIds(artifact: PracticeScoreArtifact, ids: readonly string[]): readonly PracticeScoreNote[] {
  const notes = new Map(artifact.notes.map(note => [note.noteId, note]));
  return ids.map(id => { const note = notes.get(id); if (!note) fail('Dangling canonical note reference.'); return note; });
}
export function attackNoteIds(moment: PracticeMoment): string[] { return moment.attacks.flatMap(attack => attack.noteIds); }

function object(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PracticeScoreArtifact object required.');
  const allowed = fields.split(' '), keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) fail('Unexpected or missing PracticeScoreArtifact fields.');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('PracticeScoreArtifact array required.');
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail('Sparse PracticeScoreArtifact array.');
  return value;
}
function references(value: unknown): string[] {
  const ids = array(value); for (const id of ids) identity(id);
  if (new Set(ids).size !== ids.length) fail('Duplicate note references.');
  return ids as string[];
}
function identity(value: unknown): asserts value is string { if (typeof value !== 'string' || !value) fail('Invalid canonical identity.'); }
function number(value: unknown): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value)) fail('Invalid numeric chronology.'); }
function fail(message: string): never { throw new PracticeScoreContractError(message); }
export function roundBeat(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
