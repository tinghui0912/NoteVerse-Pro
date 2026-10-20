import { RenderTimelineClock, sourceBoundary } from './latch';
import { ContinuousAcousticProjection } from '../../src/lib/practice/acoustic/continuous/continuous-projection';
import { ContinuousCaptureBridge } from '../../src/lib/practice/acoustic/continuous/capture-bridge';
import { BrowserAcousticCapture } from '../../src/lib/practice/acoustic/source/capture';
import type { AcousticInferencePort } from '../../src/lib/practice/acoustic/runtime/inference-types';
import { PerformanceClockRuntime } from '../../src/lib/practice/local-core/performance-runtime';
import type { PracticeScoreArtifact } from '../../src/lib/practice/local-core/artifact';
import { resolvePracticeTempoPlan } from '../../src/lib/practice/local-core/practice-tempo';
import { MetronomeController } from '../../src/lib/practice/metronome/metronome-controller';
import { evaluatePracticeInputCapabilities } from '../../src/lib/practice/input-capability';
import fixture from '../../src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function requireCondition(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
async function waitUntil(test: () => boolean, checkFailure: () => void) {
  const deadline = Date.now() + 30000; // Timeout only; never used for boundary or event identity.
  while (!test()) { checkFailure(); if (Date.now() > deadline) throw new Error('CLOCK_GATE_TIMEOUT'); await sleep(5); }
}
type Kind = 'A' | 'B' | 'C' | 'D';

async function scenario(rate: number, kind: Kind) {
  const coefficients = new Uint8Array(await (await fetch(`/fir-${rate}.f32`)).arrayBuffer());
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  const context = new AudioContext({ sampleRate: rate });
  let capture: BrowserAcousticCapture | undefined, runtime: ContinuousAcousticProjection | undefined, metronome: MetronomeController | undefined;
  const readings: { sequence: number; contextTime: number; contextFrame: number }[] = [];
  let rawWitnesses: unknown = null;
  try {
    await context.resume(); requireCondition(context.sampleRate === rate, 'ACTUAL_SOURCE_RATE_UNAVAILABLE');
    const clock = new RenderTimelineClock({ get currentTime() {
      const C = context.currentTime;
      readings.push({ sequence: readings.length, contextTime: C, contextFrame: Math.round(C * rate) });
      return C;
    } });
    const artifact: PracticeScoreArtifact = { ...fixture as PracticeScoreArtifact,
      // Clock-only synthetic scope; this is not an acoustic accuracy target.
      expectedPracticeGroups: fixture.expectedPracticeGroups.slice(0, 1), practiceAttackSteps: fixture.practiceAttackSteps.slice(0, 1),
      scoreEndBeat: kind === 'C' ? 1.2 : 120, scoreTempoSegments: [{ startBeat: 0, bpm: 120 }] };
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'CUSTOM_FIXED_BPM', bpm: 120 });
    const transport = new PerformanceClockRuntime({ artifact, tempoPlan, scope: { kind: 'FULL' }, clock, countInBeats: 0 });
    let fakeRuns = 0;
    const port: AcousticInferencePort = {
      async run() { return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: ++fakeRuns }; },
      async dispose() {},
    };
    const publications: { frontier: number; availability: number; events: number }[] = [];
    runtime = await ContinuousAcousticProjection.create({ sessionDomainId: transport.timebase.domainId,
      sourceDomainId: `clock-v2-${rate}-${kind}`, sourceSampleRateHz: rate, coefficientBytes: coefficients, worker: port,
      nowAvailabilityMs: () => clock.nowMs(), onPublication: pub => {
        requireCondition(pub.observations.length === 0, 'FAKE_PORT_CREATED_OBSERVATION');
        publications.push({ frontier: pub.analyzedThroughPerformanceMs, availability: pub.availabilityTimeMs, events: 0 });
      } });
    const analysis = runtime;
    const bridge = new ContinuousCaptureBridge(analysis, rate);
    const applied: { type: string; sourceSample: number; performanceTimeMs: number }[] = [];
    const segments: { performanceStartMs: number; performanceEndMs: number; sourceStartSample: number; sourceEndSample: number;
      expectedSourceDurationSamples: number; actualSourceDurationSamples: number; durationMismatchSamples: number }[] = [];
    let open: { time: number; source: number } | undefined, terminalInvocation = false;
    // Qualification instrumentation observes public boundary calls without changing their implementation.
    const begin = analysis.beginSegment.bind(analysis), end = analysis.endSegment.bind(analysis), terminal = analysis.requestTerminal.bind(analysis);
    analysis.beginSegment = time => {
      const source = analysis.snapshot().nextSourceSampleIndex;
      begin(time); open = { time, source }; applied.push({ type: 'BEGIN', sourceSample: source, performanceTimeMs: time });
    };
    analysis.endSegment = time => {
      const source = analysis.snapshot().nextSourceSampleIndex;
      requireCondition(open, 'NO_OPEN_SEGMENT');
      const expected = (time - open.time) * rate / 1000, actual = source - open.source;
      end(time);
      segments.push({ performanceStartMs: open.time, performanceEndMs: time, sourceStartSample: open.source, sourceEndSample: source,
        expectedSourceDurationSamples: expected, actualSourceDurationSamples: actual, durationMismatchSamples: actual - expected });
      if (!terminalInvocation) applied.push({ type: 'PAUSE', sourceSample: source, performanceTimeMs: time });
      open = undefined;
    };
    analysis.requestTerminal = time => {
      terminalInvocation = true;
      try { terminal(time); applied.push({ type: 'TERMINAL', sourceSample: analysis.snapshot().nextSourceSampleIndex, performanceTimeMs: time }); }
      finally { terminalInvocation = false; }
    };
    capture = await BrowserAcousticCapture.connect({ bridge, stream, ownership: 'OWNED_ANALYSIS', context, workletUrl: '/capture.worklet.js' });
    const check = () => { const error = analysis.snapshot().failureCode; if (error) throw new Error(error); };
    await waitUntil(() => bridge.snapshot().nextSourceSampleIndex >= rate * 1.4, check);
    const origin = bridge.snapshot().audioContextOriginFrame!;
    const boundaries: (ReturnType<typeof sourceBoundary> & { type: string; performanceTimeMs: number; transportState: string })[] = [];
    const pulses: { audioTime: number; pulseTimeMs: number; contextTime: number }[] = [];
    rawWitnesses = { boundaries, applied, segments, pulses };
    metronome = new MetronomeController({ artifact, tempoPlan, audioContext: context, enabled: false,
      onScheduledPulse: (pulse, audioTime) => pulses.push({ audioTime, pulseTimeMs: pulse.timeMs, contextTime: context.currentTime }) });
    const meter = metronome;
    function transition(type: 'BEGIN' | 'PAUSE' | 'RESUME-BEGIN' | 'TERMINAL') {
      return clock.transaction(C => {
        const mapped = sourceBoundary(C, rate, origin, bridge.snapshot().nextSourceSampleIndex);
        const snapshot = type === 'BEGIN' ? transport.start() : type === 'PAUSE' ? transport.pause()
          : type === 'RESUME-BEGIN' ? transport.resume() : transport.end('STOPPED_BY_USER');
        bridge.schedule({ type: type === 'RESUME-BEGIN' ? 'BEGIN' : type,
          sourceSampleIndex: mapped.sourceSample, performanceTimeMs: snapshot.performanceTimeMs });
        boundaries.push({ ...mapped, type, performanceTimeMs: snapshot.performanceTimeMs, transportState: snapshot.state });
        if (type === 'BEGIN') meter.start(snapshot);
        else if (type === 'PAUSE') meter.pause();
        else if (type === 'RESUME-BEGIN') meter.resume(snapshot);
        else meter.stop();
        return { ...mapped, snapshot };
      });
    }
    const first = transition('BEGIN');
    await waitUntil(() => bridge.snapshot().nextSourceSampleIndex >= first.sourceSample, check);
    const pauseWitnesses: { pausedPerformanceTimeMs: number; afterPausePerformanceTimeMs: number; resumePerformanceTimeMs: number; deltaMs: number;
      beforeSource: number; afterSource: number; beforeFrontier: number; afterFrontier: number; publicationsDuringPause: number }[] = [];
    let failureWitness: unknown = null;
    let futureBoundaryWitness: unknown = null;
    if (kind === 'C') {
      const D = transport.scopeDurationMs();
      requireCondition(D === 600, 'FUTURE_SCOPE_DURATION_NOT_600');
      const futureC = first.contextTime + D / 1000;
      const mapped = sourceBoundary(futureC, rate, origin, bridge.snapshot().nextSourceSampleIndex);
      bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: mapped.sourceSample, performanceTimeMs: D });
      boundaries.push({ ...mapped, type: 'TERMINAL', performanceTimeMs: D, transportState: 'FUTURE_SCOPE_COMPLETED' });
      await waitUntil(() => context.currentTime >= futureC && transport.snapshot().state === 'ENDED', check);
      const completionSessionMs = transport.completionCaptureTime().ms;
      const completionSourceSample = Math.round(completionSessionMs / 1000 * rate) - origin;
      requireCondition(completionSourceSample === mapped.sourceSample, 'FUTURE_CLOCK_SOURCE_BOUNDARY_MISMATCH');
      futureBoundaryWitness = { startContextTime: first.contextTime, durationMs: D, futureContextTime: futureC,
        completionSessionMs, completionSourceSample, registeredSourceSample: mapped.sourceSample,
        transport: transport.snapshot(), timerRole: 'OBSERVATION_ONLY_NOT_TRANSITION_AUTHORITY' };
    } else if (kind === 'D') {
      await sleep(850); check();
      analysis.failAnalysis(new Error('QUALIFICATION_ANALYSIS_ONLY_FAILURE'));
      const before = { contextTime: context.currentTime, transport: transport.snapshot(), publications: publications.length, analysis: analysis.snapshot() };
      await sleep(550);
      const after = { contextTime: context.currentTime, transport: transport.snapshot(), publications: publications.length, analysis: analysis.snapshot() };
      requireCondition(after.contextTime > before.contextTime && after.transport.performanceTimeMs > before.transport.performanceTimeMs
        && after.transport.musicalBeat > before.transport.musicalBeat && after.transport.state === 'RUNNING'
        && after.analysis.state === 'FAILED' && after.publications === before.publications && context.state === 'running', 'ANALYSIS_FAILURE_CONTROLLED_TRANSPORT');
      failureWitness = { before, after, contextState: context.state, ownsContext: 'HARNESS_SESSION_NOT_ANALYSIS' };
    } else {
      const repetitions = kind === 'B' ? 5 : 2;
      for (let i = 0; i < repetitions; i++) {
        await sleep(kind === 'B' ? 1800 : 600); check();
        if (i === repetitions - 1) { transition('TERMINAL'); break; }
        const paused = transition('PAUSE');
        await waitUntil(() => bridge.snapshot().nextSourceSampleIndex >= paused.sourceSample, check);
        // Pending pre-pause windows can legitimately drain while paused. Frontier may reach T, never pass it.
        const before = analysis.snapshot(), beforePubs = publications.length;
        await sleep(kind === 'B' ? 300 : 200); check();
        const after = transport.snapshot(), afterAnalysis = analysis.snapshot();
        requireCondition(after.performanceTimeMs === paused.snapshot.performanceTimeMs, 'PAUSE_ADVANCED_PERFORMANCE_TIME');
        requireCondition(afterAnalysis.analyzedThroughPerformanceMs <= paused.snapshot.performanceTimeMs, 'PAUSE_PCM_ADVANCED_COVERAGE');
        const resumed = transition('RESUME-BEGIN');
        requireCondition(resumed.snapshot.performanceTimeMs === paused.snapshot.performanceTimeMs, 'RESUME_PERFORMANCE_GAP');
        pauseWitnesses.push({ pausedPerformanceTimeMs: paused.snapshot.performanceTimeMs, afterPausePerformanceTimeMs: after.performanceTimeMs,
          resumePerformanceTimeMs: resumed.snapshot.performanceTimeMs, deltaMs: resumed.snapshot.performanceTimeMs - paused.snapshot.performanceTimeMs,
          beforeSource: before.nextSourceSampleIndex,
          afterSource: afterAnalysis.nextSourceSampleIndex, beforeFrontier: before.analyzedThroughPerformanceMs,
          afterFrontier: afterAnalysis.analyzedThroughPerformanceMs, publicationsDuringPause: publications.length - beforePubs });
      }
    }
    if (kind !== 'D') {
      await waitUntil(() => analysis.tailReady, check); capture.stop(); await analysis.seal();
      requireCondition(analysis.snapshot().outstanding === 0 && analysis.snapshot().state === 'SEALED', 'TERMINAL_NOT_DRAINED');
      requireCondition(publications.at(-1)?.frontier === transport.snapshot().performanceTimeMs, 'EXACT_T_TERMINAL_MISMATCH');
      requireCondition(applied.length === boundaries.length, 'BOUNDARY_APPLICATION_COUNT');
      for (let i = 0; i < applied.length; i++) {
        requireCondition(applied[i].type === boundaries[i].type.replace('RESUME-BEGIN', 'BEGIN')
          && applied[i].sourceSample === boundaries[i].sourceSample
          && applied[i].performanceTimeMs === boundaries[i].performanceTimeMs, 'BOUNDARY_NOT_APPLIED_EXACTLY_ONCE');
      }
    }
    requireCondition(segments.every(s => Math.abs(s.durationMismatchSamples) <= 1), 'SEGMENT_EXCEEDS_ONE_SAMPLE');
    requireCondition(pulses.length > 0 && pulses.every(p => p.audioTime === p.pulseTimeMs / 1000), 'METRONOME_DOMAIN_WITNESS_FAILED');
    if (kind === 'B') requireCondition(context.currentTime - first.contextTime >= 10, 'REPEATED_SCENARIO_TOO_SHORT');
    const capabilities = evaluatePracticeInputCapabilities();
    return { status: 'PASS', rate, scenario: kind, readings, boundaries, applied, segments, pauseWitnesses, failureWitness, futureBoundaryWitness,
      maximumDurationMismatchSamples: Math.max(0, ...segments.map(s => Math.abs(s.durationMismatchSamples))),
      fractionalFrameErrors: boundaries.map(b => b.fractionalFrameError), capture: bridge.snapshot(), snapshot: analysis.snapshot(),
      publications, transport: transport.snapshot(), metronome: { sameContext: true, audible: false, pulses },
      fakeInferenceCalls: fakeRuns, actualNeuralRuns: 0, capabilities, productionMicrophone: false };
  } catch (error) {
    throw new Error(JSON.stringify({ rate, scenario: kind, error: String(error), readings, rawWitnesses,
      analysis: runtime?.snapshot() }), { cause: error });
  } finally {
    metronome?.stop(); capture?.stop(); await runtime?.dispose();
    stream.getTracks().forEach(track => track.stop()); await context.close();
  }
}

declare global { interface Window { runAudioContextClockGate(rate: number, kind: Kind): Promise<unknown>; } }
if (typeof window !== 'undefined') window.runAudioContextClockGate = scenario;
