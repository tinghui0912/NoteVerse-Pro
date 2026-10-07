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
  'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED',
  'TRIGGER_NOT_VALIDATED',
  'micStepTriggerNotValidated',
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

  it('derives completed Continuous evaluation from the finalized session ledger', () => {
    const evaluatorFile = path.resolve(__dirname, 'local-core/continuous-evaluation-session.ts');
    const content = readFileSync(evaluatorFile, 'utf8');
    const completedMethod = content.match(/completedEvaluation\(\): CompletedContinuousEvaluation[\s\S]*?\n  }\n\n  private finalizeReadyTruth/)?.[0] ?? '';

    expect(completedMethod).toContain('const snapshot = this.snapshot()');
    expect(completedMethod).not.toContain('reconcilePerformance');
  });

  it('documents Practice Product Contract v2 as the authoritative microphone boundary', () => {
    const contractFile = path.resolve(__dirname, '../../../../../docs/architecture/practice-product-contract-v2.md');
    const content = readFileSync(contractFile, 'utf8');

    expect(content).toContain('STEP is correctness-driven. STEP has no performance clock.');
    expect(content).toContain('CAPTURING one bounded attempt');
    expect(content).toContain('Continuous is tempo-clock practice. It is not score-following.');
    expect(content).toContain('A Continuous performance has exactly one accumulated evaluation truth.');
    expect(content).toContain('Review displays the same accumulated finalized truth');
    expect(content).toContain('There is no second whole-performance inference pass for the same Continuous performance evaluation.');
    expect(content).toContain('The canonical evaluation for a performance is the accumulated immutable finalized result produced incrementally during that performance.');
    expect(content).toContain('Stop or natural completion drains unfinished tail work only.');
    expect(content).toContain('Previously finalized regions are never re-inferred as part of completing the performance or opening Review.');
    expect(content).toContain('The product-domain evaluator owns the finalized ledger and the analysis coverage watermark.');
    expect(content).toContain('A strike reaching its individual late deadline is not by itself sufficient to freeze');
    expect(content).toContain('chunked score-aware analyzer');
    expect(content).toContain('stateful streaming analyzer');
    expect(content).toContain('The product contract is strategy-neutral');
    expect(content).toContain('Correctness and product-level evaluation accuracy are the primary selection criteria.');
    expect(content).toContain('Analysis PCM capture is a source timeline, not a performance clock.');
    expect(content).toContain('one monotonic source-sample identity domain');
    expect(content).toContain('Source sample ranges are half-open');
    expect(content).toContain('Running segments must not overlap in performance time.');
    expect(content).toContain('Pause and resume create separate acoustic source segments.');
    expect(content).toContain('Context-only samples consume source sample identity but do not extend performance duration');
    expect(content).toContain('input region:');
    expect(content).toContain('commit region:');
    expect(content).toContain('Production microphone Practice remains disabled');
    expect(content).toContain('must not require a continuous generic physical-onset stream');
    expect(content).not.toContain('a later full-performance or final analysis may become the canonical Review result');
    expect(content).not.toContain('live delayed feedback and final Review are produced by the same model or runtime');
    const oneTruthSection = content.match(/## One Evaluation Truth[\s\S]*?## Explicit Non-Goals/)?.[0] ?? '';
    expect(oneTruthSection).not.toContain('by default');
    expect(oneTruthSection).not.toContain('may later rerun');
    expect(oneTruthSection).not.toContain('canonical Review may come from another analysis pass');
  });

  it('marks older Continuous and ByteDance architecture notes as superseded or historical', () => {
    const continuousDoc = readFileSync(
      path.resolve(__dirname, '../../../../../docs/architecture/continuous-performance-analysis.md'),
      'utf8'
    );
    const bytedanceReadme = readFileSync(path.resolve(__dirname, 'acoustic-inference/README.md'), 'utf8');

    expect(continuousDoc).toContain('Superseded Scope');
    expect(continuousDoc).toContain('does not require STEP and Continuous to share one acoustic event stream');
    expect(continuousDoc).toContain('chunk geometry as one candidate strategy rather than the selected production winner');
    expect(continuousDoc).toContain('stateful streaming analyzer is also a candidate');
    expect(continuousDoc).toContain('old rolling scheduler as a fallback');
    expect(bytedanceReadme).toContain('Historical Candidate');
    expect(bytedanceReadme).toContain('not the authoritative Practice v2 acoustic architecture');
    expect(bytedanceReadme).toMatch(/must not be restored\s+as a fallback product path/);
    expect(bytedanceReadme).toContain('future bounded-attempt flow');
  });

  it('keeps PerformanceClockRuntime independent from acoustic model implementations', () => {
    const runtimeFile = path.resolve(__dirname, 'local-core/performance-runtime.ts');
    const content = readFileSync(runtimeFile, 'utf8');
    const runtimeClass = content.match(/export class PerformanceClockRuntime[\s\S]*?\n}\n\nexport class ContinuousPracticeSession/)?.[0] ?? '';

    for (const token of ['ByteDance', 'RTT', 'OnlineAMT', 'ONNX', 'WebGPU', 'inference', 'acoustic']) {
      expect(runtimeClass).not.toContain(token);
    }
  });

  it('keeps MIDI source-delivery grace independent from the musical assignment window', () => {
    const runtimeFile = path.resolve(__dirname, 'local-core/performance-runtime.ts');
    const content = readFileSync(runtimeFile, 'utf8');

    expect(content).toContain('DEFAULT_MIDI_COVERAGE_GRACE_MS');
    expect(content).not.toContain('DEFAULT_ASSIGNMENT_WINDOW_MS');
  });

  it('keeps PCM capture storage separate from clock and evaluation coverage', () => {
    const timelineFile = path.resolve(__dirname, 'audio-analysis/capture/performance-pcm-timeline.ts');
    const content = readFileSync(timelineFile, 'utf8');

    expect(content).toContain('PcmCaptureBlock');
    expect(content).toContain('sourceSampleRateHz');
    expect(content).not.toContain('ContinuousEvaluationSession');
    expect(content).not.toContain('PerformanceClockRuntime');
    expect(content).not.toContain('advanceAnalysisThrough');
  });

  it('keeps model-specific candidates out of product domain contracts', () => {
    const productContractFiles = [
      path.resolve(__dirname, 'local-core/step-runtime.ts'),
      path.resolve(__dirname, 'local-core/step-evidence-session.ts'),
      path.resolve(__dirname, 'local-core/performance-runtime.ts'),
      path.resolve(__dirname, 'local-core/continuous-evaluation-session.ts'),
      path.resolve(__dirname, 'audio-analysis/continuous/performance-reconciler.ts'),
      path.resolve(__dirname, 'performance-recorder.ts'),
      path.resolve(__dirname, 'completed-performance.ts'),
      path.resolve(__dirname, 'input-capability.ts'),
    ];
    const violations = productContractFiles.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      return ['ByteDance', 'RTT', 'OnlineAMT', 'BasicPitch', 'ONNX']
        .filter((token) => content.includes(token))
        .map((token) => `${path.relative(process.cwd(), file)} contains ${token}`);
    });

    expect(violations).toEqual([]);
  });

  it('does not make WebGPU a browser microphone capture prerequisite', () => {
    const capabilityFile = path.resolve(__dirname, 'input-capability.ts');
    const content = readFileSync(capabilityFile, 'utf8');

    expect(content).not.toContain('navigator.gpu');
    expect(content).toContain('microphoneCapture');
    expect(content).toContain('acousticAnalysis');
    expect(content).not.toContain('MODEL_ACCESS_UNAVAILABLE');
    expect(content).not.toContain('MODEL_STORAGE_UNAVAILABLE');
    expect(content).not.toContain('WEBGPU_UNAVAILABLE');
    expect(content).not.toContain('STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED');
    expect(content).not.toContain('TRIGGER_NOT_VALIDATED');
    expect(content).toContain('ATTEMPT_ANALYZER_NOT_VALIDATED');
    expect(content).toContain('STEP_ANALYSIS_UNAVAILABLE');
  });

  it('keeps historical research artifacts available without importing them as production policy', () => {
    const reportsRoot = path.resolve(__dirname, '../../../../../backend/research/reports');
    const reports = new Set(readdirSync(reportsRoot));

    expect([...reports].some((name) => name.includes('bytedance'))).toBe(true);
    expect([...reports].some((name) => name.includes('rtt'))).toBe(true);
    expect([...reports].some((name) => name.includes('online_amt'))).toBe(true);

    const productionImportsResearch = practiceRoots
      .flatMap((root) => collectProductionSourceFiles(root))
      .flatMap((file) => {
        const content = readFileSync(file, 'utf8');
        return ['backend/research', 'research/reports']
          .filter((token) => content.includes(token))
          .map((token) => `${path.relative(process.cwd(), file)} imports ${token}`);
      });

    expect(productionImportsResearch).toEqual([]);
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
