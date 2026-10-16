import { ContinuousAcousticRuntime } from '../src/lib/practice/acoustic-inference/continuous/acoustic-runtime';
import { ContinuousCaptureBridge } from '../src/lib/practice/acoustic-inference/continuous/capture-bridge';
import { ContinuousAcousticCapture } from '../src/lib/practice/acoustic-inference/continuous/capture';
import { ContinuousAcousticWorker } from '../src/lib/practice/acoustic-inference/continuous/worker-client';
import { ContinuousPracticeSession } from '../src/lib/practice/local-core/performance-runtime';
import { ManualClock } from '../src/lib/practice/local-core/timebase';
import type { PracticeScoreArtifact } from '../src/lib/practice/local-core';
import artifact from '../src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import { continuousMicrophoneSink } from '../src/lib/practice/continuous-microphone-input';
import { evaluatePracticeInputCapabilities } from '../src/lib/practice/input-capability';

declare global {
  interface Window {
    runContinuousCaptureQualification(rate: number): Promise<unknown>;
    continuousAssetsReady: boolean;
  }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
if (typeof window !== 'undefined') {
window.continuousAssetsReady = false;
window.runContinuousCaptureQualification = async rate => {
  const worker = new ContinuousAcousticWorker(new Worker('/worker.js', { type: 'module' }));
  let context: AudioContext | null = null, capture: ContinuousAcousticCapture | null = null;
  let runtime: ContinuousAcousticRuntime | null = null, stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const model = await worker.load('/model.onnx');
    const coefficients = new Uint8Array(await (await fetch(`/fir-${rate}.f32`)).arrayBuffer());
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    context = new AudioContext({ sampleRate: rate }); await context.resume();
    if (context.sampleRate !== rate) throw new Error(`ACTUAL_SOURCE_RATE_UNAVAILABLE:${context.sampleRate}`);
    const clock = new ManualClock(0), session = new ContinuousPracticeSession({ artifact: artifact as PracticeScoreArtifact,
      scope: { kind: 'FULL' }, clock, countInBeats: 0, inputSource: 'MICROPHONE' });
    const sink = continuousMicrophoneSink(session);
    const publications: { id: string; frontier: number; availability: number; count: number; sourceSamples: readonly number[] }[] = [];
    let startContextTime = Infinity, inferenceDoesNotChangeClock = true;
    runtime = await ContinuousAcousticRuntime.create({ sessionDomainId: session.timebase.domainId, sourceDomainId: `fake-capture-${rate}`,
      sourceSampleRateHz: rate, coefficientBytes: coefficients, worker,
      nowAvailabilityMs: () => context!.currentTime * 1000 - startContextTime,
      onPublication: publication => {
        const before = session.clock.snapshot(); sink(publication);
        inferenceDoesNotChangeClock &&= JSON.stringify(before) === JSON.stringify(session.clock.snapshot());
        publications.push({ id: publication.publicationId, frontier: publication.analyzedThroughPerformanceMs,
          availability: publication.availabilityTimeMs, count: publication.observations.length,
          sourceSamples: publication.observations.map(o => o.provenance!.sourceEventSample) });
      } });
    const bridge = new ContinuousCaptureBridge(runtime, rate);
    capture = await ContinuousAcousticCapture.connect({ bridge, stream, ownership: 'OWNED_ANALYSIS', context, workletUrl: '/capture.worklet.js' });
    window.continuousAssetsReady = true;
    while (bridge.snapshot().blocks < 2) await sleep(10);
    const origin = bridge.snapshot().audioContextOriginFrame!;
    const currentSource = () => Math.round(context!.currentTime * rate) - origin;
    const start = Math.ceil((currentSource() + rate * 2) / 128) * 128;
    const pause = start + Math.round(rate * .6), resume = pause + Math.round(rate * .2), end = resume + Math.round(rate * .6);
    startContextTime = (origin + start) / rate * 1000;
    const commands = [
      { sample: start, apply: () => session.start() }, { sample: pause, apply: () => session.pause() },
      { sample: resume, apply: () => session.resume() }, { sample: end, apply: () => session.end('STOPPED_BY_USER') },
    ];
    bridge.schedule({ type: 'BEGIN', sourceSampleIndex: start, performanceTimeMs: 0 });
    bridge.schedule({ type: 'PAUSE', sourceSampleIndex: pause, performanceTimeMs: 600 });
    bridge.schedule({ type: 'BEGIN', sourceSampleIndex: resume, performanceTimeMs: 600 });
    bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: end, performanceTimeMs: 1200 });
    const transportWitness: { sourceSample: number; state: string; performanceTimeMs: number }[] = [];
    // This is the harness's independent transport authority, never an acoustic callback.
    timer = setInterval(() => {
      const now = currentSource();
      while (commands[0] && now >= commands[0].sample) {
        const command = commands.shift()!; clock.set((command.sample - start) / rate * 1000);
        command.apply(); const snapshot = session.clock.snapshot();
        transportWitness.push({ sourceSample: command.sample, state: snapshot.state, performanceTimeMs: snapshot.performanceTimeMs });
      }
      clock.set(Math.max(0, (now - start) / rate * 1000));
    }, 2);
    const deadline = performance.now() + 90000;
    while (!runtime.tailReady || commands.length) {
      if (runtime.snapshot().failureCode) throw new Error(runtime.snapshot().failureCode!);
      if (performance.now() > deadline) throw new Error('CAPTURE_QUALIFICATION_TIMEOUT');
      await sleep(10);
    }
    capture.stop();
    await runtime.seal();
    const snapshot = runtime.snapshot(), completed = session.completedEvaluation();
    const capabilities = evaluatePracticeInputCapabilities();
    if (snapshot.counts.windowsStarted !== 2 || snapshot.counts.windowsPublished !== 2 || snapshot.outstanding !== 0
      || snapshot.state !== 'SEALED' || snapshot.counts.terminalPublications !== 1 || snapshot.diagnostics.at(-1)?.actualSessionRunCount !== 2
      || publications.at(-1)?.frontier !== 1200 || publications.at(-1)?.count !== 0
      || !inferenceDoesNotChangeClock || capabilities.acousticAnalysis.continuous.status !== 'MODEL_NOT_VALIDATED') throw new Error('CAPTURE_QUALIFICATION_ASSERTION');
    return { status: 'PASS', actualAudioContextRate: context.sampleRate, trackSettings: stream.getAudioTracks()[0].getSettings(),
      model, capture: bridge.snapshot(), snapshot, transportWitness, publications, completed,
      inferenceDoesNotChangeClock, capabilities, realDeviceProbe: 'NOT_PERFORMED', productionMicrophone: false };
  } finally {
    clearInterval(timer); capture?.stop();
    if (runtime) await runtime.dispose(); else await worker.dispose();
    for (const track of stream?.getTracks() ?? []) track.stop();
    await context?.close();
  }
};
}
