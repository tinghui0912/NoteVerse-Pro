import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const practiceRoots = [
  path.resolve(__dirname),
  path.resolve(__dirname, '../../components/practice'),
  path.resolve(__dirname, '../../hooks/practice'),
];

const forbiddenProductionTokens = [
  'PerformanceExpectedEventOutcome',
  'PerformanceExpectedStrikeOutcome',
  'PerformanceEvaluationObservation',
  'LocalPerformanceExpectedEventOutcomeRecord',
  'evaluationCoverageIntervals',
  'UNCONFIRMED',
  'performance-evaluator',
  'ContinuousEventStitcher',
  'windowStrideSamples',
  'BYTE_DANCE_CONTINUOUS_TRANSCRIPTION_NOT_VIABLE',
  'executionProviderFallback',
  'providerFallback',
  'follow-controller',
  'Practice WebSocket',
];

describe('practice architecture boundaries', () => {
  it('keeps production Continuous practice on the clean-break domain model', () => {
    const violations = practiceRoots
      .flatMap((root) => collectProductionSourceFiles(root))
      .flatMap((file) => {
        const content = readFileSync(file, 'utf8');
        return forbiddenProductionTokens
          .filter((token) => content.includes(token))
          .map((token) => `${path.relative(process.cwd(), file)} contains ${token}`);
      });

    expect(violations).toEqual([]);
  });
});

function collectProductionSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (entry === '__fixtures__') continue;
      files.push(...collectProductionSourceFiles(absolute));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    files.push(absolute);
  }
  return files;
}
