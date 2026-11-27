import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runSyntheticBenchmark } from './policy-benchmark';
import { analyzeMidiCorpus } from './corpus-analysis';
import { assertResearchReport, type ResearchKind } from './research-report';

export function parseResearchArguments(kind: ResearchKind, args: string[]): Record<string, string> {
  const allowed = kind === 'SYNTHETIC_ASSIGNMENT' ? ['--output'] : ['--input', '--output', '--dataset-name', '--dataset-version', '--source-note'];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]] !== undefined) {
      throw new Error('TIMING_RESEARCH_ARGUMENTS_INVALID');
    }
    options[args[i]] = args[i + 1];
  }
  if (kind === 'MIDI_CORPUS_SPACING' && !options['--input']) throw new Error('LOCAL_CORPUS_INPUT_REQUIRED');
  return options;
}

export async function runResearchCommand(kind: ResearchKind, args: string[]): Promise<number> {
  const options = parseResearchArguments(kind, args);
  const report = kind === 'SYNTHETIC_ASSIGNMENT' ? runSyntheticBenchmark() : await analyzeMidiCorpus(options['--input'], {
    name: options['--dataset-name'] ?? 'user-local', version: options['--dataset-version'] ?? 'unspecified', sourceNote: options['--source-note'] ?? '',
  });
  assertResearchReport(report);
  const output = path.resolve(options['--output'] ?? `artifacts/practice-timing/${kind.toLowerCase()}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report) + '\n');
  if (report.benchmarkKind === 'SYNTHETIC_ASSIGNMENT') {
    console.table(report.aggregateMetrics.map(row => ({
      BPM: row.bpm, spacingBeats: Number(row.spacingBeats.toFixed(3)), beatMs: Number(row.beatDurationMs.toFixed(2)),
      windowBeats: Number(row.assignmentWindowBeats.toFixed(3)), groupSpacingMs: Number(row.groupSpacingMs.toFixed(2)),
      claimantOverlap: row.claimantOverlapRate.toFixed(4), neighborMisassignment: row.neighborMisassignmentRate.toFixed(4),
      unattributed: row.unattributedRate.toFixed(4),
    })));
    console.log(`Synthetic cases: ${report.caseCount}. Rates use FULL_SWEEP observations only; probe/tie/transition cases are retained separately.`);
  } else {
    console.table({ files: { count: report.totalMidiFiles }, succeeded: { count: report.filesSucceeded }, failed: { count: report.filesFailed },
      noteOns: { count: report.aggregateMetrics.totalNoteOnCount }, samePitchGapsWithinCohort: { count: report.aggregateMetrics.samePitchGapsWithinCohortCount } });
    console.table({ interOnsetMs: report.aggregateMetrics.interOnsetIntervalMs, samePitchGapMs: report.aggregateMetrics.samePitchGapMs,
      localTempoBpm: report.aggregateMetrics.noteWeightedLocalTempoBpm, samePitchGapLocalBeats: report.aggregateMetrics.samePitchGapLocalBeats });
    for (const failure of report.failures) console.error(`${failure.category}: ${failure.path}`);
  }
  for (const limitation of report.limitations) console.log(limitation);
  console.log(`Report: ${output}`);
  // Partial analysis is still saved; corrupt/unreadable MIDI makes this explicit command fail.
  return report.benchmarkKind === 'MIDI_CORPUS_SPACING' && report.filesFailed > 0 ? 1 : 0;
}
