import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import midiPackage from '@tonejs/midi';
import { distribution, envelope, type CorpusReport, type CorpusFailure } from './research-report';
import { productionPolicy } from './production-policy';

const { Midi } = midiPackage;
type NoteStart = { midi: number; timeMs: number; ticks: number; localBpm: number | null };

/** Public Tone parser, never Midi.fromUrl(). No network or second MIDI parser. */
export function extractMidiNoteStarts(bytes: Uint8Array): { notes: NoteStart[]; tempoEventCount: number } {
  // Validate SMF framing too: a parser must not turn a truncated container into successful data.
  const buffer = Buffer.from(bytes);
  if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'MThd' || buffer.readUInt32BE(4) !== 6
    || buffer.readUInt16BE(8) > 1 || buffer.readUInt16BE(12) === 0 || buffer.readUInt16BE(12) & 0x8000) {
    throw new Error('INVALID_MIDI');
  }
  let offset = 14;
  for (let track = 0; track < buffer.readUInt16BE(10); track++) {
    if (offset + 8 > buffer.length || buffer.toString('ascii', offset, offset + 4) !== 'MTrk') throw new Error('INVALID_MIDI');
    offset += 8 + buffer.readUInt32BE(offset + 4);
    if (offset > buffer.length) throw new Error('INVALID_MIDI');
  }
  if (offset !== buffer.length) throw new Error('INVALID_MIDI');
  const midi = new Midi(bytes);
  const tempos = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks);
  if (tempos.some(t => !Number.isFinite(t.bpm) || t.bpm <= 0 || !Number.isFinite(t.ticks) || t.ticks < 0)) throw new Error('INVALID_MIDI');
  const notes = midi.tracks.flatMap(track => track.notes.filter(note => note.velocity > 0).map(note => {
    if (!Number.isFinite(note.time) || note.time < 0 || !Number.isFinite(note.ticks) || note.ticks < 0
      || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127) throw new Error('INVALID_MIDI');
    const tempo = tempos.findLast(tempo => tempo.ticks <= note.ticks);
    return { midi: note.midi, ticks: note.ticks, timeMs: note.time * 1000, localBpm: tempo?.bpm ?? null };
  })).sort((a, b) => a.timeMs - b.timeMs || a.midi - b.midi);
  return { notes, tempoEventCount: tempos.length };
}

export async function discoverMidiFiles(input: string): Promise<string[]> {
  if (/^[a-z]+:\/\//i.test(input)) throw new Error('LOCAL_INPUT_REQUIRED');
  const root = path.resolve(input);
  async function visit(file: string): Promise<string[]> {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) return []; // No cycles, traversal outside the chosen tree, or implicit corpus handoff.
    if (stat.isDirectory()) {
      const names = (await readdir(file)).sort();
      const files: string[] = [];
      for (const name of names) files.push(...await visit(path.join(file, name)));
      return files;
    }
    return stat.isFile() && /\.midi?$/i.test(file) ? [file] : [];
  }
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() && !/\.midi?$/i.test(root)) throw new Error('UNSUPPORTED_INPUT');
    return await visit(root);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNSUPPORTED_INPUT') throw error;
    throw new Error('CORPUS_DISCOVERY_FAILED');
  }
}

export async function analyzeMidiCorpus(input: string, dataset: CorpusReport['dataset'], generatedAt = new Date().toISOString()): Promise<CorpusReport> {
  const files = await discoverMidiFiles(input);
  const failures: CorpusFailure[] = [];
  const interOnsets: number[] = [], samePitchGaps: number[] = [], localBeats: number[] = [], localTempos: number[] = [];
  let totalNoteOnCount = 0, explicitTempoEventCount = 0, implicitTempoNoteCount = 0, samePitchGapsWithinCohortCount = 0;
  for (const file of files) {
    let bytes: Uint8Array;
    try { bytes = await readFile(file); }
    catch { failures.push({ path: file, category: 'READ_FAILED' }); continue; }
    let parsed: ReturnType<typeof extractMidiNoteStarts>;
    try { parsed = extractMidiNoteStarts(bytes); }
    catch { failures.push({ path: file, category: 'INVALID_MIDI' }); continue; }
    totalNoteOnCount += parsed.notes.length;
    explicitTempoEventCount += parsed.tempoEventCount;
    const previousByPitch = new Map<number, NoteStart>();
    parsed.notes.forEach((note, index) => {
      if (note.localBpm === null) implicitTempoNoteCount++;
      else localTempos.push(note.localBpm);
      if (index) interOnsets.push(note.timeMs - parsed.notes[index - 1].timeMs);
      const previous = previousByPitch.get(note.midi);
      if (previous) {
        const gap = note.timeMs - previous.timeMs;
        samePitchGaps.push(gap);
        if (gap <= productionPolicy.cohortOverlapThresholdMs) samePitchGapsWithinCohortCount++;
        // Local onset-tempo normalization, not integrated beats across a tempo change.
        if (previous.localBpm !== null) localBeats.push(gap / (60_000 / previous.localBpm));
      }
      previousByPitch.set(note.midi, note);
    });
  }
  return { ...envelope('MIDI_CORPUS_SPACING', generatedAt), benchmarkKind: 'MIDI_CORPUS_SPACING', dataset,
    caseCount: files.length, totalMidiFiles: files.length, filesSucceeded: files.length - failures.length,
    filesFailed: failures.length, failures,
    aggregateMetrics: { totalNoteOnCount, explicitTempoEventCount, implicitTempoNoteCount,
      samePitchGapCount: samePitchGaps.length, samePitchGapsWithinCohortCount, normalizedSamePitchGapCount: localBeats.length,
      interOnsetIntervalMs: distribution(interOnsets), samePitchGapMs: distribution(samePitchGaps),
      samePitchGapLocalBeats: distribution(localBeats), noteWeightedLocalTempoBpm: distribution(localTempos) } };
}
