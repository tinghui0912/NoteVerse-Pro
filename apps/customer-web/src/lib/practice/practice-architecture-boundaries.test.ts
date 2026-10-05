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
  'cameraRecordingEnabled',
  'PerformanceEvidenceObservation',
  'ContinuousChunkPlanner',
  'ContinuousTranscriptionQueue',
  'ContinuousTranscriptionContract',
  'STEP_BYTEDANCE_ANCHOR_STEP_SAMPLES',
  'StepInferenceScheduler',
  'skippedAnchorCount',
  'pendingAnchor',
  'activeAnchor',
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

  it('keeps recording lifecycle out of the React practice hook', () => {
    const hookFile = path.resolve(__dirname, '../../hooks/practice/use-local-practice.ts');
    const content = readFileSync(hookFile, 'utf8');

    expect(content).not.toContain('new MediaRecorder');
    expect(content).not.toContain('recordingChunks');
    expect(content).not.toContain('cameraRecordingEnabled');
    expect(content).not.toContain('advanceAnalysisThrough(');
    expect(content).toContain('PerformanceRecorder');
  });

  it('keeps product input capability independent from ByteDance Continuous candidates', () => {
    const capabilityFile = path.resolve(__dirname, 'input-capability.ts');
    const content = readFileSync(capabilityFile, 'utf8');

    expect(content).not.toContain('BYTE_DANCE_CONTINUOUS_TRANSCRIPTION_CAPABILITY');
  });

  it('keeps acoustic inference independent from STEP score state', () => {
    const acousticRoots = [
      path.resolve(__dirname, 'acoustic-inference'),
      path.resolve(__dirname, 'audio-analysis'),
    ];
    const violations = acousticRoots
      .flatMap((root) => collectProductionSourceFiles(root))
      .flatMap((file) => {
        const content = readFileSync(file, 'utf8');
        return [
          'currentStepTarget',
          'StepPracticeRuntime',
          'groupForCurrentStep',
        ]
          .filter((token) => content.includes(token))
          .map((token) => `${path.relative(process.cwd(), file)} contains ${token}`);
      });

    expect(violations).toEqual([]);
  });

  it('keeps Continuous completion separate from analysis frontier advancement', () => {
    const evaluatorFile = path.resolve(__dirname, 'local-core/continuous-evaluation-session.ts');
    const content = readFileSync(evaluatorFile, 'utf8');
    const completeMethod = content.match(/complete\(input:[\s\S]*?\n  }\n\n  snapshot\(\)/)?.[0] ?? '';

    expect(completeMethod).not.toContain('advanceAnalysisThrough');
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
