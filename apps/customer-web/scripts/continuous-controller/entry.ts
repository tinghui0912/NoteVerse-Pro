import { ContinuousPracticeController } from '../../src/lib/practice/continuous/continuous-practice-controller';
import { browserContinuousPlatform } from '../../src/lib/practice/continuous/continuous-platform';
import { AcousticModelWorker } from '../../src/lib/practice/acoustic/model/worker-client';
import { evaluatePracticeInputCapabilities } from '../../src/lib/practice/input-capability';
import fixture from '../../src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../../src/lib/practice/local-core/artifact';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
type Scenario = 'natural_recording_offline' | 'count_in_cancel_multiple_pause_manual_stop' | 'pause_near_terminal_resume_natural' | 'recording_analysis_failure_running';
declare global { interface Window {
  runContinuousControllerQualification(rate: number, scenario: Scenario): Promise<unknown>;
  controllerAssetsReady: boolean; controllerOfflineReady: boolean;
} }

if (typeof window !== 'undefined') {
window.controllerAssetsReady = false; window.controllerOfflineReady = false;
window.runContinuousControllerQualification = async (rate, scenario) => {
  let root: MediaStream | null = null, context: AudioContext | null = null, client: AcousticModelWorker | null = null;
  let acquisitions = 0, nativeAcquisitions = 0, contextsCreated = 0, contextsClosed = 0, workersCreated = 0;
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = constraints => { nativeAcquisitions++; return nativeGetUserMedia(constraints); };
  const clones: MediaStream[] = [], resumeWitnesses: { pause: number; resume: number; deltaMs: number }[] = [];
  const recording = scenario === 'natural_recording_offline' || scenario === 'recording_analysis_failure_running';
  const failureCase = scenario === 'recording_analysis_failure_running';
  const artifact: PracticeScoreArtifact = { ...fixture as PracticeScoreArtifact, scoreEndBeat: failureCase ? 4.8 : 2.4,
    expectedPracticeGroups: fixture.expectedPracticeGroups.slice(0, 1), practiceAttackSteps: fixture.practiceAttackSteps.slice(0, 1) };
  const platform = { ...browserContinuousPlatform,
    modelUrl: async () => '/model.onnx', workletUrl: '/capture.worklet.js',
    createWorker: () => { workersCreated++; client = new AcousticModelWorker(new Worker('/worker.js', { type: 'module' })); return client; },
    createAudioContext: () => {
      contextsCreated++; context = new AudioContext({ sampleRate: rate });
      const close = context.close.bind(context); context.close = () => { contextsClosed++; return close(); }; return context;
    },
    acquireMicrophone: async () => {
      acquisitions++; root = await browserContinuousPlatform.acquireMicrophone(); const clone = root.clone.bind(root);
      root.clone = () => { const stream = clone(); clones.push(stream); return stream; }; return root;
    },
  };
  const controller = new ContinuousPracticeController({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE',
    countInBeats: failureCase || scenario === 'pause_near_terminal_resume_natural' ? 0 : 1,
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 }, recordingMode: recording ? 'AUDIO' : 'OFF' }, platform);
  const lifecycleTimings: { state: string; wallTimeMs: number; contextTime: number | null; performanceTimeMs: number | null }[] = [];
  const detachTimings = controller.subscribe(() => {
    const snapshot = controller.snapshot();
    if (snapshot.session === lifecycleTimings.at(-1)?.state) return;
    lifecycleTimings.push({ state: snapshot.session, wallTimeMs: performance.now(),
      contextTime: context?.currentTime ?? null, performanceTimeMs: snapshot.transport?.performanceTimeMs ?? null });
    if (lifecycleTimings.length > 32) lifecycleTimings.shift();
  });
  async function wait(test: () => boolean, allowFailure = false) {
    const deadline = performance.now() + 45000;
    while (!test()) {
      controller.refresh(); const state = controller.snapshot();
      if (state.session === 'FAILED_BEFORE_START' || state.session === 'FAILED' || (!allowFailure && state.analysis === 'FAILED')) throw new Error(JSON.stringify(state));
      if (performance.now() > deadline) throw new Error('CONTROLLER_QUALIFICATION_TIMEOUT'); await sleep(5);
    }
  }
  async function pauseResume(ms: number) {
    controller.pause(); const pause = controller.snapshot().transport!.performanceTimeMs;
    await sleep(ms); assert(controller.snapshot().transport!.performanceTimeMs === pause, 'PAUSE_ADVANCED_PERFORMANCE');
    controller.resume(); const resume = controller.snapshot().transport!.performanceTimeMs;
    resumeWitnesses.push({ pause, resume, deltaMs: resume - pause }); assert(pause === resume, 'RESUME_IDENTITY');
  }
  let failureWitness: unknown = null;
  try {
    await controller.start(); assert(controller.snapshot().session === 'ACTIVE', 'PREPARATION_FAILED');
    assert(context !== null && root !== null && client !== null, 'RESOURCE_NOT_CREATED');
    const audioContext = context as AudioContext, stream = root as MediaStream, worker = client as AcousticModelWorker;
    assert(audioContext.sampleRate === rate, 'ACTUAL_CONTEXT_RATE_UNAVAILABLE');
    const trackSettings = stream.getAudioTracks()[0].getSettings();
    window.controllerAssetsReady = true; await wait(() => window.controllerOfflineReady);
    const offlineWitness = { contextTime: audioContext.currentTime, snapshot: controller.snapshot().transport };
    if (scenario === 'count_in_cancel_multiple_pause_manual_stop') {
      assert(controller.snapshot().transport!.state === 'COUNT_IN', 'COUNT_IN_NOT_OBSERVED');
      await pauseResume(200);
    }
    await wait(() => controller.snapshot().transport?.state === 'RUNNING');
    if (scenario === 'count_in_cancel_multiple_pause_manual_stop') {
      await wait(() => controller.snapshot().transport!.performanceTimeMs >= 400); await pauseResume(200);
      await wait(() => controller.snapshot().transport!.performanceTimeMs >= 750); await pauseResume(150);
      await wait(() => controller.snapshot().transport!.performanceTimeMs >= 1000); await controller.finish();
    } else if (scenario === 'pause_near_terminal_resume_natural') {
      await wait(() => controller.snapshot().transport!.performanceTimeMs >= 1050); await pauseResume(250);
    } else if (failureCase) {
      await wait(() => controller.snapshot().transport!.performanceTimeMs >= 400); controller.pause();
      await wait(() => {
        const runtime = controller.engineeringSnapshot().microphone?.runtime;
        return Boolean(runtime && runtime.counts.windowsPublished >= 1 && runtime.outstanding === 0);
      });
      const T = controller.snapshot().transport!.performanceTimeMs; controller.resume();
      assert(controller.snapshot().transport!.performanceTimeMs === T, 'FAILURE_CASE_RESUME_IDENTITY');
      worker.terminate('QUALIFICATION_ANALYSIS_FAILURE');
      const before = { snapshot: controller.snapshot(), contextTime: audioContext.currentTime,
        publications: controller.engineeringSnapshot().microphone!.publications };
      await sleep(400); controller.refresh();
      const after = { snapshot: controller.snapshot(), contextTime: audioContext.currentTime,
        publications: controller.engineeringSnapshot().microphone!.publications };
      assert(after.snapshot.analysis === 'FAILED' && after.snapshot.transport!.state === 'RUNNING'
        && after.snapshot.transport!.performanceTimeMs > before.snapshot.transport!.performanceTimeMs
        && after.snapshot.transport!.musicalBeat > before.snapshot.transport!.musicalBeat
        && after.contextTime > before.contextTime && audioContext.state === 'running'
        && before.publications === after.publications && stream.getTracks().every(t => t.readyState === 'live')
        && after.snapshot.recording?.state === 'RECORDING', 'FAILURE_NOT_ISOLATED');
      failureWitness = { before, after, rootTrackStates: stream.getTracks().map(t => t.readyState) };
      await controller.finish();
    }
    await wait(() => controller.snapshot().session === 'COMPLETE', failureCase);
    const result = controller.snapshot(), engineering = controller.engineeringSnapshot(), runtime = engineering.microphone!.runtime!;
    const completion = result.completed!;
    assert(completion.evaluation.status === (failureCase ? 'UNAVAILABLE' : 'COMPLETE'), 'WRONG_COMPLETED_EVALUATION');
    assert(completion.media.status === (recording ? 'READY' : 'NOT_RECORDED'), 'RECORDING_NOT_FINALIZED');
    assert(runtime.outstanding === 0 && runtime.resources.sessionPcmBytes === 0 && runtime.resources.retainedPublicationEvents === 0
      && acquisitions === 1 && nativeAcquisitions === 1 && contextsCreated === 1 && contextsClosed === 1 && workersCreated === 1
      && clones.length === (recording ? 2 : 1)
      && stream.getTracks().every(t => t.readyState === 'ended') && clones.every(s => s.getTracks().every(t => t.readyState === 'ended')), 'RESOURCE_OWNERSHIP_OR_LEAK');
    const boundaries = engineering.microphone!.capture!.boundaryDiagnostics;
    assert(boundaries.filter(b => b.action === 'SCHEDULED').every(b => b.sourceSampleIndex >= b.nextSourceAtAction), 'LATE_BOUNDARY');
    assert(boundaries.filter(b => b.action === 'APPLIED').every(b => b.sourceSampleIndex === b.nextSourceAtAction), 'INEXACT_APPLIED_BOUNDARY');
    if (!failureCase) assert(runtime.analyzedThroughPerformanceMs === result.transport!.performanceTimeMs && runtime.counts.terminalPublications === 1, 'TERMINAL_EXACT_T');
    const capabilities = evaluatePracticeInputCapabilities();
    assert(capabilities.acousticAnalysis.continuous.status === 'MODEL_NOT_VALIDATED'
      && capabilities.acousticAnalysis.step.status === 'ATTEMPT_ANALYZER_NOT_VALIDATED', 'CAPABILITY_ENABLED');
    return { status: 'PASS', rate, scenario, trackSettings, nativeHardwareRateQualification: false, offlineWitness, resumeWitnesses,
      failureWitness, engineering, model: engineering.microphone!.model, transport: result.transport,
      lifecycleTimings: [...lifecycleTimings],
      terminalFinalizationDelayMs: lifecycleTimings.find(t => t.state === 'COMPLETE')!.wallTimeMs - lifecycleTimings.find(t => t.state === 'FINALIZING')!.wallTimeMs,
      completed: { evaluation: completion.evaluation, mediaStatus: completion.media.status,
        mediaBytes: completion.media.status === 'READY' ? completion.media.blob.size : 0, recordingTimebase: completion.recordingTimebase },
      resources: { acquisitions, nativeAcquisitions, contextsCreated, contextsClosed, workersCreated, clonedStreams: clones.length,
        allRootAndCloneTracksEnded: true }, actualModelRuns: runtime.diagnostics.at(-1)?.actualSessionRunCount ?? 0,
      capabilities, productionMicrophone: false, realDevice: 'NOT_PERFORMED' };
  } catch (error) {
    throw new Error(JSON.stringify({ reason: String(error), rate, scenario, snapshot: controller.snapshot(), engineering: controller.engineeringSnapshot(),
      resumeWitnesses, acquisitions, contextsCreated, contextsClosed, workersCreated }), { cause: error });
  } finally { detachTimings(); await controller.dispose(); navigator.mediaDevices.getUserMedia = nativeGetUserMedia; }
};
}
