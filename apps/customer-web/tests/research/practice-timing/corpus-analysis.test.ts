import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { analyzeMidiCorpus, discoverMidiFiles, extractMidiNoteStarts } from './corpus-analysis';
import { syntheticMidiFixture } from './synthetic-midi-fixture';
import { assertResearchReport } from './research-report';
import { parseResearchArguments, runResearchCommand } from './command';

const dataset = { name: 'generated-five-note-fixture', version: '1', sourceNote: 'No external composition or dataset.' };
const date = '2026-01-01T00:00:00.000Z';

describe('explicit local MIDI corpus research', () => {
  it('extracts NOTE_ON starts and explicit local tempo from the existing Tone parser', () => {
    const result = extractMidiNoteStarts(syntheticMidiFixture());
    expect(result.tempoEventCount).toBe(2);
    expect(result.notes.map(n => n.midi)).toEqual([60, 62, 60, 60, 64]);
    expect(result.notes.map(n => n.timeMs)).toEqual([0, 250, 500, 1000, 2000]);
    expect(result.notes.map(n => n.localBpm)).toEqual([120, 120, 120, 60, 60]);
  });
  it('does not present implicit MIDI default tempo as observed metadata', () => {
    expect(extractMidiNoteStarts(syntheticMidiFixture(false)).notes.every(n => n.localBpm === null)).toBe(true);
  });
  it.each(['not midi', 'truncated', 'unsupported time division'])('rejects %s without exposing parser messages', condition => {
    const bytes = condition === 'not midi' ? Buffer.from('not midi') : Buffer.from(syntheticMidiFixture());
    if (condition === 'unsupported time division') bytes.writeUInt16BE(0xe728, 12);
    expect(() => extractMidiNoteStarts(condition === 'truncated' ? bytes.subarray(0, bytes.length - 1) : bytes)).toThrow('INVALID_MIDI');
  });
  it('discovers nested .mid/.midi case-insensitively and characterizes spacing without mixing files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'practice corpus with spaces '));
    try {
      await mkdir(path.join(directory, 'nested 子目录'));
      await writeFile(path.join(directory, 'a.mid'), syntheticMidiFixture());
      await writeFile(path.join(directory, 'nested 子目录', 'b.MIDI'), syntheticMidiFixture(false));
      await writeFile(path.join(directory, 'ignored.txt'), 'ignored');
      const files = await discoverMidiFiles(directory);
      expect(files).toHaveLength(2);
      expect(files).toEqual([...files].sort());
      const report = await analyzeMidiCorpus(directory, dataset, date);
      expect(report).toMatchObject({ totalMidiFiles: 2, filesSucceeded: 2, filesFailed: 0, dataset });
      expect(report.aggregateMetrics).toMatchObject({ totalNoteOnCount: 10, explicitTempoEventCount: 2, implicitTempoNoteCount: 5,
        samePitchGapCount: 4, samePitchGapsWithinCohortCount: 4, normalizedSamePitchGapCount: 2,
        samePitchGapMs: { count: 4, min: 500, max: 500 }, samePitchGapLocalBeats: { count: 2, min: 1, max: 1 },
        interOnsetIntervalMs: { count: 8, min: 250, max: 1000 } });
      expect(() => assertResearchReport(JSON.parse(JSON.stringify(report)))).not.toThrow();
      expect(await analyzeMidiCorpus(directory, dataset, date)).toEqual(report);
      expect((await analyzeMidiCorpus(files[0], dataset, date)).totalMidiFiles).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('writes a partial report and returns nonzero for invalid MIDI instead of swallowing it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'practice-invalid-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await writeFile(path.join(directory, 'good.mid'), syntheticMidiFixture());
      await writeFile(path.join(directory, 'bad.midi'), 'corrupt');
      const output = path.join(directory, 'out.json');
      expect(await runResearchCommand('MIDI_CORPUS_SPACING', ['--input', directory, '--output', output])).toBe(1);
      const report = JSON.parse(await readFile(output, 'utf8'));
      assertResearchReport(report);
      expect(report).toMatchObject({ filesSucceeded: 1, filesFailed: 1, failures: [{ path: path.join(directory, 'bad.midi'), category: 'INVALID_MIDI' }] });
      expect(error).toHaveBeenCalledWith(`INVALID_MIDI: ${path.join(directory, 'bad.midi')}`);
    } finally { log.mockRestore(); table.mockRestore(); error.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  });
  it('runs the actual Node CLI with one quoted Windows-safe path argument and no dataset/network dependency', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'practice cli spaces '));
    try {
      const input = path.join(directory, 'tiny fixture.mid'), output = path.join(directory, 'report.json');
      await writeFile(input, syntheticMidiFixture());
      const result = spawnSync(process.execPath, ['scripts/analyze-practice-midi-corpus.mjs', '--input', input, '--output', output,
        '--dataset-name', dataset.name, '--dataset-version', dataset.version], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(await readFile(output, 'utf8'));
      assertResearchReport(report);
      expect(report).toMatchObject({ filesSucceeded: 1, filesFailed: 0, dataset: { name: dataset.name, version: dataset.version } });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('preserves literal Windows paths and rejects missing, duplicate, unknown or malformed CLI options', () => {
    const windowsPath = 'C:\\Users\\Researcher\\MIDI corpus';
    expect(parseResearchArguments('MIDI_CORPUS_SPACING', ['--input', windowsPath])['--input']).toBe(windowsPath);
    for (const args of [[], ['--input'], ['--input', 'x', '--input', 'y'], ['--url', 'https://example.com'], ['--input', '--output']]) {
      expect(() => parseResearchArguments('MIDI_CORPUS_SPACING', args)).toThrow();
    }
  });
  it('rejects remote input and explicit non-MIDI files', async () => {
    await expect(discoverMidiFiles('https://example.com/corpus.mid')).rejects.toThrow('LOCAL_INPUT_REQUIRED');
    const directory = await mkdtemp(path.join(tmpdir(), 'practice-no-midi-'));
    try {
      const file = path.join(directory, 'text.txt'); await writeFile(file, 'text');
      await expect(discoverMidiFiles(file)).rejects.toThrow('UNSUPPORTED_INPUT');
      await expect(discoverMidiFiles(path.join(directory, 'absent'))).rejects.toThrow('CORPUS_DISCOVERY_FAILED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
