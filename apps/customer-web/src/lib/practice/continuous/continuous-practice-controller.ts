import { releaseRecordingMedia } from "@/lib/practice/recording/recording-media-resource";
import type { PerformanceRecording } from "@/lib/practice/recording/recording-artifact";
import { MetronomeRuntime } from "@/lib/practice/metronome/metronome-runtime";
import {
  DeviceFailure,
  MidiFailure,
  isPracticeCausalFailure,
} from "@/lib/practice/failure/causal-failure";
import { resumePracticeAudioContext } from "@/lib/practice/failure/browser-failures";
import type { PracticeRootHealthPort } from "@/lib/practice/device/device-contract";
import type { PracticeDeviceRoots } from "@/lib/practice/device/device-contract";
import { PracticeStartupTimings } from "@/lib/practice/diagnostics/startup-timings";
import { unavailableContinuousEvaluation } from "@/lib/practice/continuous/domain/evaluation/session";
import { ContinuousMicrophoneHealth } from "./microphone-resource-health";
import type { ContinuousPracticeCompletion } from "./completion";
import { createNaturalContinuousCompletion } from "./natural-completion";
import {
  midiEvidenceProvenance,
  microphoneEvidenceProvenance,
  type ContinuousEvidenceProvenance,
} from "@/lib/practice/result/continuous-result-provenance";
import { qualifiedAcousticSourceRate } from "@/lib/practice/acoustic/failure-boundary";
import type { ContinuousTargetFeedback } from "@/lib/practice/continuous/domain/evaluation/target-feedback";
import { type PerformanceClockSnapshot } from "@/lib/practice/continuous/domain/performance-clock";
import { ContinuousPracticeSession } from "@/lib/practice/continuous/domain/practice-session";
import { type ContinuousPracticeSessionSnapshot } from "@/lib/practice/continuous/domain/session";
import { ContinuousMidiEvidence } from "@/lib/practice/continuous/input/midi-evidence";
import { createLocalSessionId } from "@/lib/practice/session/session";
import type { ContinuousPracticePlan } from "@/lib/practice/planning/practice-plan";
import { RecordingFailure } from "@/lib/practice/failure/causal-failure";
import type { ContinuousAnalysisIntervention } from "./analysis-intervention";
import type { PracticeResourceIntervention } from "./resource-intervention";
import { AudioContextPerformanceClock } from "./audio-context-performance-clock";
import {
  projectContinuousFailure,
  ContinuousApplicationFailure,
  type ContinuousErrorCode,
} from "./continuous-errors";
import type {
  ContinuousPlatform,
  ContinuousRecorderPort,
} from "./continuous-input";
import { ContinuousMicrophoneInput } from "./continuous-microphone-input";
import { ContinuousMidiInput } from "./continuous-midi-input";
import { browserContinuousPlatform } from "./continuous-platform";

import { continuousMetronomeSyncPoint } from "./metronome-sync";

import {
  initialContinuousControl,
  transitionContinuousControl,
  analysisAvailable,
  analysisControlError,
  resourceIntervention,
  type ContinuousControlState,
  type ContinuousControlEvent,
  type ContinuousControlEffect,
} from "./continuous-control-machine";

const DIAGNOSTIC_LIMIT = 32;

export type ContinuousControllerOptions = Readonly<{
  devices: PracticeDeviceRoots;
  rootHealth: PracticeRootHealthPort;
  startupTimings?: PracticeStartupTimings;
  plan: ContinuousPracticePlan;
  onNaturalCompletion?(snapshot: ContinuousPracticeSessionSnapshot): void;
}>;
type ContinuousControllerState =
  | "IDLE"
  | "PREPARING"
  | "ACTIVE"
  | "FINALIZING"
  | "COMPLETE"
  | "FAILED_BEFORE_START"
  | "FAILED"
  | "ABANDONED"
  | "DISPOSED";
export type ContinuousControllerSnapshot = Readonly<{
  session: ContinuousControllerState;
  transport: PerformanceClockSnapshot | null;
  analysis:
    | "NOT_REQUIRED"
    | "PREPARING"
    | "PREROLL"
    | "RUNNING"
    | "PAUSED"
    | "DRAINING"
    | "COMPLETE"
    | "INTERRUPTED"
    | "DISABLED"
    | "FAILED";
  analysisError: ContinuousErrorCode | null;
  inputError: ContinuousErrorCode | null;
  recording: ReturnType<ContinuousRecorderPort["snapshot"]> | null;
  analysisIntervention: ContinuousAnalysisIntervention | null;
  resourceIntervention: PracticeResourceIntervention | null;
  evaluation: ContinuousTargetFeedback | null;
  completed: ContinuousPracticeCompletion | null;
  sessionSnapshot: ContinuousPracticeSessionSnapshot | null;
}>;

type ContinuousRuntimeHandles = {
  session: ContinuousPracticeSession | null;
  microphone: ContinuousMicrophoneInput | null;
  midi: ContinuousMidiInput | null;
  recorder: ContinuousRecorderPort | null;
  metronome: MetronomeRuntime | null;
  context: AudioContext | null;
  rootStream: MediaStream | null;
  renderClock: AudioContextPerformanceClock | null;
  inputResources: ContinuousMicrophoneHealth | null;
  abort: AbortController;
  boundaries: { begin: string | null; terminal: string | null };
  timer: ReturnType<typeof setInterval> | null;
  detachRootHealth: (() => void) | null;
  detachRecorder: (() => void) | null;
  evidenceProvenance: ContinuousEvidenceProvenance | null;
};
type ContinuousOperationHandles = {
  preparation?: Promise<void>;
  finalization?: Promise<void>;
  analysisRelease?: Promise<void>;
  recordingRetirement?: Promise<void>;
  mediaRetirement?: Promise<void>;
  resourceRelease?: Promise<readonly unknown[]>;
};
type Acknowledgement = {
  promise: Promise<void>;
  resolve(): void;
  done(state: ContinuousControlState): boolean;
};
const settled = Promise.resolve();

/** Browser effect host; all lifecycle, intervention and coordination decisions are reduced as events. */
export class ContinuousPracticeController {
  private control: ContinuousControlState;
  private readonly runtime: ContinuousRuntimeHandles = {
    session: null,
    microphone: null,
    midi: null,
    recorder: null,
    metronome: null,
    context: null,
    rootStream: null,
    renderClock: null,
    inputResources: null,
    abort: new AbortController(),
    boundaries: { begin: null, terminal: null },
    timer: null,
    detachRootHealth: null,
    detachRecorder: null,
    evidenceProvenance: null,
  };
  private readonly operations: ContinuousOperationHandles = {};
  private readonly mailbox: {
    event: ContinuousControlEvent;
    acknowledged?: () => void;
  }[] = [];
  private processing = false;
  private readonly acknowledgements = new Map<string, Acknowledgement>();
  private readonly listeners = new Set<() => void>();
  private readonly diagnostics: Readonly<{
    action: string;
    state: string;
    performanceTimeMs: number;
    detail?: string;
  }>[] = [];
  private readonly startup: PracticeStartupTimings;
  constructor(
    private readonly options: ContinuousControllerOptions,
    private readonly platform: ContinuousPlatform = browserContinuousPlatform(),
  ) {
    this.startup = options.startupTimings ?? new PracticeStartupTimings();
    const resources = options.plan.resources;
    this.control = initialContinuousControl(
      {
        input: resources.input.kind,
        analysisRequired: resources.analysis.kind === "ACOUSTIC",
        recording: resources.recording.mode,
      },
      options.plan.metronomePlan.initiallyEnabled,
    );
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot(): ContinuousControllerSnapshot {
    return projectContinuousControllerSnapshot(this.control, {
      microphoneState:
        this.runtime.microphone?.snapshot().runtime?.state ?? null,
      recording:
        this.runtime.recorder?.snapshot(
          this.control.transport?.performanceTimeMs ?? 0,
        ) ?? null,
      evaluation: this.runtime.session?.targetFeedback ?? null,
    });
  }

  engineeringSnapshot() {
    return Object.freeze({
      startup: this.startup.snapshot(),
      sessionId: this.runtime.session?.timebase.domainId ?? null,
      microphone: this.runtime.microphone?.snapshot() ?? null,
      diagnostics: Object.freeze([...this.diagnostics]),
      diagnosticLimit: DIAGNOSTIC_LIMIT,
      diagnosticPlanningBytes: DIAGNOSTIC_LIMIT * 1024,
      physicalRootHealth: this.options.rootHealth.snapshot(),
      audioContextState: this.runtime.context?.state ?? "CLOSED",
      audioContextRate: this.runtime.context?.sampleRate ?? null,
      failureCause:
        this.control.tag === "FAILED" ? this.control.failure.cause : null,
    });
  }
  start(): Promise<void> {
    return this.command(
      { type: "START_REQUESTED" },
      "start",
      (state) =>
        state.tag !== "PREPARING" &&
        !(state.tag === "ACTIVE" && state.transportAction === "START") &&
        !this.releasing(state),
    );
  }
  pause(): void {
    this.dispatch({ type: "PAUSE_REQUESTED" });
  }
  resume(): void {
    this.dispatch({ type: "RESUME_REQUESTED" });
  }
  refresh(): void {
    this.dispatch({ type: "REFRESH_REQUESTED" });
  }
  abandon(): Promise<void> {
    // Read an existing formal domain latch, without advancing time on End.
    if (
      this.control.tag === "ACTIVE" &&
      this.runtime.session?.clock.terminationReason === "SCOPE_COMPLETED"
    ) {
      this.dispatch({
        type: "TRANSPORT_OBSERVED",
        attemptId: this.control.attemptId,
        action: "EVIDENCE",
        transport: this.runtime.session.snapshot(),
      });
    }
    return this.command(
      { type: "ABANDON_REQUESTED" },
      "abandon",
      (state) => state.tag !== "FINALIZING" && !this.releasing(state),
    );
  }
  dispose(): Promise<void> {
    return this.command(
      { type: "DISPOSE_REQUESTED" },
      "dispose",
      (state) => !this.releasing(state),
    );
  }
  continueWithoutAnalysis(): Promise<void> {
    return this.command(
      { type: "CONTINUE_ANALYSIS_REQUESTED" },
      "continue-analysis",
      (state) =>
        state.tag !== "ACTIVE" ||
        state.analysis.kind !== "INTERRUPTED" ||
        state.analysis.choice !== "CONTINUE",
    );
  }
  continueWithoutRecording(): Promise<void> {
    this.dispatch({ type: "ROOTS_CHANGED", attemptId: this.control.attemptId });
    return this.command(
      { type: "CONTINUE_RECORDING_REQUESTED" },
      "continue-recording",
      (state) =>
        state.tag !== "ACTIVE" ||
        state.resources.action.kind !== "ACCEPT_RECORDING",
    );
  }
  continueAfterRecovery(): boolean {
    this.dispatch({ type: "ROOTS_CHANGED", attemptId: this.control.attemptId });
    const before = resourceIntervention(this.control);
    this.dispatch({ type: "RECOVERY_REQUESTED" });
    return (
      before?.state === "RECOVERED_WAITING_FOR_USER" &&
      resourceIntervention(this.control) === null
    );
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.dispatch({ type: "METRONOME_REQUESTED", enabled });
  }
  private releasing(state: ContinuousControlState): boolean {
    return (
      (state.tag === "ABANDONED" ||
        state.tag === "DISPOSED" ||
        state.tag === "FAILED") &&
      state.release.kind === "RELEASING"
    );
  }
  private command(
    event: ContinuousControlEvent,
    key: string,
    done: Acknowledgement["done"],
  ): Promise<void> {
    const acknowledge = () => {
      if (done(this.control)) return settled;
      const existing = this.acknowledgements.get(key);
      if (existing) return existing.promise;
      let resolve!: () => void;
      const promise = new Promise<void>((complete) => {
        resolve = complete;
      });
      this.acknowledgements.set(key, { promise, resolve, done });
      return promise;
    };
    if (this.processing)
      return new Promise<void>((resolve) =>
        this.dispatch(event, () => resolve(acknowledge())),
      );
    this.dispatch(event);
    return acknowledge();
  }
  private dispatch(
    event: ContinuousControlEvent,
    acknowledged?: () => void,
  ): void {
    this.mailbox.push({ event, acknowledged });
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.mailbox.length) {
        const queued = this.mailbox.shift()!,
          before = this.control;
        const transition = transitionContinuousControl(before, queued.event);
        this.control = transition.state;
        if (this.control !== before) {
          if (before.tag !== "FINALIZING" && this.control.tag === "FINALIZING")
            this.record("NATURAL_TERMINAL");
          const previous = resourceIntervention(before),
            current = resourceIntervention(this.control);
          if (!previous && current)
            this.record("RESOURCE_INTERVENTION", current.impact);
          for (const listener of this.listeners) listener();
          for (const [key, waiter] of this.acknowledgements)
            if (waiter.done(this.control)) {
              this.acknowledgements.delete(key);
              waiter.resolve();
            }
        }
        for (const effect of transition.effects) this.effect(effect);
        queued.acknowledged?.();
      }
    } finally {
      this.processing = false;
    }
  }
  private effect(effect: ContinuousControlEffect): void {
    switch (effect.kind) {
      case "PREPARE":
        this.operations.preparation = this.prepare(effect.operationId);
        break;
      case "START_TRANSPORT":
      case "PAUSE_TRANSPORT":
      case "RESUME_TRANSPORT":
      case "REFRESH_TRANSPORT":
      case "ABANDON_TRANSPORT":
        this.mutateClock(effect);
        break;
      case "START_RECORDING":
        this.runtime.recorder?.startIfReady(0);
        this.observeResources(this.control.attemptId);
        break;
      case "RESUME_RECORDING":
        this.runtime.recorder?.resume(effect.performanceTimeMs);
        this.observeResources(this.control.attemptId);
        break;
      case "OBSERVE_RESOURCES":
        this.observeResources(effect.attemptId);
        break;
      case "RELEASE_ANALYSIS": {
        this.runtime.boundaries = { begin: null, terminal: null };
        this.runtime.inputResources?.releaseAnalysisSource();
        void this.releaseAnalysis().then(
          () =>
            this.dispatch({
              type: "ANALYSIS_RELEASED",
              operationId: effect.operationId,
            }),
          (cause) =>
            this.dispatch({
              type: "ANALYSIS_RELEASE_FAILED",
              operationId: effect.operationId,
              code: "RESOURCE_CLEANUP_FAILED",
              cause,
            }),
        );
        break;
      }
      case "ACCEPT_RECORDING_LOSS": {
        this.operations.recordingRetirement = (async () => {
          try {
            await this.runtime.recorder!.continueWithoutRecording();
            this.dispatch({
              type: "RESOURCE_ACTION_FINISHED",
              operationId: effect.operationId,
              success: true,
              recording: this.runtime.recorder?.runtimeFault() ?? null,
            });
          } catch (cause) {
            this.dispatch({
              type: "RESOURCE_ACTION_FAILED",
              operationId: effect.operationId,
              code: "RESOURCE_CLEANUP_FAILED",
              cause,
            });
          }
        })();
        break;
      }
      case "RECOVER_RECORDING": {
        const inputHealthy =
          !this.runtime.inputResources ||
          this.runtime.inputResources.snapshot().healthy;
        const midiHealthy = this.midiHealthy();
        const success =
          inputHealthy &&
          midiHealthy &&
          (!this.runtime.recorder?.runtimeFault() ||
            this.runtime.recorder.recoverRuntime());
        this.dispatch({
          type: "RESOURCE_ACTION_FINISHED",
          operationId: effect.operationId,
          success,
          recording: this.runtime.recorder?.runtimeFault() ?? null,
        });
        break;
      }
      case "FINALIZE":
        this.operations.finalization = this.finalize(effect.operationId);
        break;
      case "CLEANUP":
        void this.cleanup(effect.operationId).catch((failure) =>
          this.dispatch({
            type: "CLEANUP_FINISHED",
            operationId: effect.operationId,
            failure,
          }),
        );
        break;
      case "NOTIFY_COMPLETION":
        this.record("COMPLETE");
        this.options.onNaturalCompletion?.(effect.session);
        break;
      case "RELEASE_COMPLETION":
        if (effect.completion.recording.status === "READY")
          this.operations.mediaRetirement = releaseRecordingMedia(
            effect.completion.recording.resource,
          );
        break;
      case "SET_METRONOME":
        this.runtime.session?.setMetronomeEnabled(effect.enabled);
        if (effect.enabled && this.control.transport)
          this.runtime.metronome?.syncContinuous(
            continuousMetronomeSyncPoint(this.control.transport),
          );
        this.runtime.metronome?.setEnabled(effect.enabled);
        break;
      case "PUBLISH_ANALYSIS":
        this.runtime.session?.publishAnalysis(effect.publication);
        this.observeEvidence();
        break;
      case "OBSERVE_MIDI":
        this.runtime.session?.observeMidiAttack(effect.attack);
        this.observeEvidence();
        break;
    }
  }
  private async prepare(operationId: number): Promise<void> {
    const h = this.runtime,
      resources = this.options.plan.resources;
    try {
      if (resources.analysis.kind === "ACOUSTIC") {
        h.microphone = new ContinuousMicrophoneInput(
          this.platform,
          (reason) => this.analysisFailure(operationId, reason),
          this.startup,
        );
        await this.startup.measure("acquireInferenceLease", () =>
          h.microphone!.acquire(h.abort.signal),
        );
        this.preparing(operationId);
        h.rootStream = this.options.devices[resources.analysis.sourceRoot];
        if (
          !h.rootStream ||
          this.options.rootHealth.snapshot().health[
            resources.analysis.sourceRoot
          ] !== "HEALTHY"
        )
          throw new DeviceFailure("SOURCE_LOST", "MICROPHONE");
        h.context = this.platform.createAudioContext();
        await this.startup.measure("audioContextResume", () =>
          resumePracticeAudioContext(h.context!),
        );
        this.preparing(operationId);
        h.inputResources = new ContinuousMicrophoneHealth(
          this.options.rootHealth.snapshot().health[
            resources.analysis.sourceRoot
          ] ?? "LOST",
          h.context,
          (health) =>
            this.dispatch({
              type: "INPUT_HEALTH_OBSERVED",
              attemptId: operationId,
              health,
            }),
        );
        h.renderClock = new AudioContextPerformanceClock(h.context);
        h.evidenceProvenance = microphoneEvidenceProvenance(
          qualifiedAcousticSourceRate(h.context.sampleRate),
        );
      }
      h.session = new ContinuousPracticeSession({
        plan: this.options.plan,
        ...(resources.input.kind === "MIDI"
          ? {
              createClockEvidence: (domainId: string) => {
                const evidence = new ContinuousMidiEvidence(domainId);
                h.evidenceProvenance = midiEvidenceProvenance(
                  evidence.evidencePolicyId,
                );
                return evidence;
              },
            }
          : {}),
        clock: h.renderClock ?? this.platform.midiClock,
        localSessionId: createLocalSessionId(),
      });
      h.session.setMetronomeEnabled(this.control.metronomeEnabled);
      if (h.microphone) {
        await h.microphone.connect(
          {
            context: h.context!,
            stream: h.rootStream!,
            sessionDomainId: h.session.timebase.domainId,
            clock: h.renderClock!,
            publish: (publication) =>
              this.dispatch({
                type: "ANALYSIS_PUBLICATION",
                attemptId: operationId,
                publication,
              }),
          },
          h.abort.signal,
        );
      } else if (resources.input.kind === "MIDI") {
        h.midi = new ContinuousMidiInput(this.platform, {
          access: this.options.devices[resources.input.root]!,
          timebase: h.session.timebase,
          observe: (attack) =>
            this.dispatch({
              type: "MIDI_ATTACK",
              attemptId: operationId,
              attack,
            }),
        });
        await this.startup.measure("midiBind", () => h.midi!.prepare());
      } else throw new DeviceFailure("SOURCE_LOST", "MICROPHONE");
      this.preparing(operationId);
      try {
        const recording = resources.recording;
        h.recorder = this.platform.createRecorder(recording.mode);
        await this.startup.measure("recorderAdmission", () =>
          h.recorder!.prepare({
            audioRoot:
              recording.mode === "OFF"
                ? null
                : this.options.devices[recording.audioRoot],
            cameraStream:
              recording.mode === "VIDEO"
                ? this.options.devices[recording.videoRoot]
                : null,
          }),
        );
      } catch (error) {
        throw error instanceof RecordingFailure
          ? error
          : new ContinuousApplicationFailure("RECORDING_PREPARATION_FAILED", {
              cause: error,
            });
      }
      h.detachRecorder = h.recorder.onRuntimeFault(() =>
        this.dispatch({ type: "ROOTS_CHANGED", attemptId: operationId }),
      );
      h.detachRootHealth = this.options.rootHealth.subscribe(() =>
        this.dispatch({ type: "ROOTS_CHANGED", attemptId: operationId }),
      );
      this.observeResources(operationId);
      this.preparing(operationId);
      h.metronome = new MetronomeRuntime(
        this.options.plan.metronomePlan,
        this.platform.createMetronomeAudio(h.context),
      );
      h.metronome.setEnabled(this.control.metronomeEnabled);
      this.dispatch({ type: "PREPARED", operationId });
    } catch (cause) {
      const code = this.preparationCode(cause);
      this.record("PREPARATION_FAILED", String(cause));
      this.dispatch({
        type: "PREPARATION_FAILED",
        operationId,
        code,
        cause,
        analysisFailure:
          resources.analysis.kind === "ACOUSTIC" &&
          code !== "RECORDING_PREPARATION_FAILED",
      });
    }
  }
  private preparing(operationId: number): void {
    if (
      this.control.tag !== "PREPARING" ||
      this.control.operationId !== operationId ||
      this.runtime.abort.signal.aborted
    )
      throw new Error("CONTINUOUS_PREPARATION_CANCELLED");
  }
  private preparationCode(cause: unknown): ContinuousErrorCode {
    return cause instanceof ContinuousApplicationFailure
      ? cause.code
      : cause instanceof RecordingFailure
        ? "RECORDING_PREPARATION_FAILED"
        : isPracticeCausalFailure(cause)
          ? projectContinuousFailure(cause, "PREPARING")
          : this.options.plan.resources.analysis.kind === "ACOUSTIC"
            ? "MODEL_LOAD_FAILED"
            : "MIDI_UNAVAILABLE";
  }
  private mutateClock(
    effect: Extract<ContinuousControlEffect, { attemptId: number }>,
  ): void {
    const h = this.runtime,
      session = h.session;
    if (!session) return;
    try {
      const action =
        effect.kind === "START_TRANSPORT"
          ? "START"
          : effect.kind === "PAUSE_TRANSPORT"
            ? "PAUSE"
            : effect.kind === "RESUME_TRANSPORT"
              ? "RESUME"
              : effect.kind === "ABANDON_TRANSPORT"
                ? "ABANDON"
                : "REFRESH";
      let transport!: PerformanceClockSnapshot;
      const mutation = (C: number) => {
        if (action === "START") {
          this.assertMidiSourceHealthy();
          try {
            h.recorder!.assertPrepared();
          } catch (error) {
            throw error instanceof RecordingFailure
              ? error
              : new ContinuousApplicationFailure(
                  "RECORDING_PREPARATION_FAILED",
                  { cause: error },
                );
          }
          h.microphone?.assertBoundary(C);
          h.recorder!.activate();
          transport = session.start();
          this.planRunning(C, transport);
          h.metronome?.start(continuousMetronomeSyncPoint(transport));
        } else if (action === "PAUSE") {
          const before = session.advanceToNow();
          if (before.state === "ENDED" || before.state === "PAUSED") {
            transport = before;
            return;
          }
          this.cancelFuture(before.state === "COUNT_IN");
          transport = session.pause();
          if (
            analysisAvailable(this.control) &&
            (before.state === "RUNNING" ||
              (before.countInKind === "INITIAL" &&
                h.microphone?.hasRunningSegment)) &&
            h.context?.state !== "closed" &&
            !h.microphone?.snapshot().capture?.failed
          )
            this.boundary("PAUSE", C, transport.performanceTimeMs);
          if (
            this.control.tag === "ACTIVE" &&
            this.control.recordingEntry.kind !== "INITIAL"
          )
            h.recorder?.pause(transport.performanceTimeMs);
          h.metronome?.pause();
        } else if (action === "RESUME") {
          this.assertMidiSourceHealthy();
          const position = session.snapshot().performanceTimeMs;
          transport = session.resume();
          if (transport.performanceTimeMs !== position)
            throw new Error("CONTINUOUS_RESUME_IDENTITY_VIOLATION");
          this.planRunning(C, transport);
          h.metronome?.resume(continuousMetronomeSyncPoint(transport));
        } else if (action === "ABANDON") {
          this.cancelFuture(true);
          transport = session.abandon();
        } else transport = session.advanceToNow();
      };
      if (h.renderClock) h.renderClock.transaction(mutation);
      else mutation(0);
      if (action === "START") {
        h.timer = setInterval(() => this.refresh(), 10);
        this.record("START");
      } else if (action !== "REFRESH") this.record(action);
      this.dispatch({
        type: "TRANSPORT_OBSERVED",
        attemptId: effect.attemptId,
        action,
        transport,
      });
    } catch (cause) {
      this.fatal(
        effect.kind === "START_TRANSPORT"
          ? this.preparationCode(cause)
          : isPracticeCausalFailure(cause)
            ? projectContinuousFailure(cause, "ACTIVE")
            : "ANALYSIS_FAILED",
        cause,
      );
    }
  }
  private observeEvidence(): void {
    const session = this.runtime.session;
    if (!session) return;
    this.dispatch({
      type: "TRANSPORT_OBSERVED",
      attemptId: this.control.attemptId,
      action: "EVIDENCE",
      transport: session.snapshot(),
    });
  }
  private midiHealthy(): boolean {
    const input = this.options.plan.resources.input;
    return (
      input.kind !== "MIDI" ||
      this.options.rootHealth.snapshot().health[input.root] === "HEALTHY"
    );
  }
  private assertMidiSourceHealthy(): void {
    if (!this.midiHealthy()) throw new MidiFailure("NO_CONNECTED_INPUT");
  }
  private observeResources(attemptId: number): void {
    const h = this.runtime,
      resources = this.options.plan.resources,
      snapshot = this.options.rootHealth.snapshot();
    if (resources.analysis.kind === "ACOUSTIC")
      h.inputResources?.observeSourceHealth(
        snapshot.health[resources.analysis.sourceRoot] ?? "LOST",
      );
    if (resources.input.kind === "MIDI") h.midi?.refreshInputs();
    const recording = resources.recording;
    if (recording.mode !== "OFF")
      h.recorder?.observeSourceHealth({
        audio: snapshot.health[recording.audioRoot] ?? "LOST",
        ...(recording.mode === "VIDEO"
          ? { video: snapshot.health[recording.videoRoot] ?? "LOST" }
          : {}),
      });
    this.dispatch({
      type: "RESOURCE_FACTS_OBSERVED",
      attemptId,
      midiHealthy: this.midiHealthy(),
      recording: h.recorder?.runtimeFault() ?? null,
    });
  }
  private analysisFailure(attemptId: number, cause: unknown): void {
    if (
      this.control.tag === "ACTIVE" &&
      this.runtime.microphone?.snapshot().capture?.failed
    ) {
      this.dispatch({
        type: "INPUT_HEALTH_OBSERVED",
        attemptId,
        health: {
          healthy: false,
          reason: "CAPTURE_PIPELINE_INVALID",
          recoverability: "RESTART_REQUIRED",
        },
      });
      return;
    }
    this.record("ANALYSIS_FAILED", String(cause));
    this.dispatch({
      type: "ANALYSIS_FAILED",
      attemptId,
      code: isPracticeCausalFailure(cause)
        ? projectContinuousFailure(
            cause,
            this.control.tag === "PREPARING" ? "PREPARING" : "ACTIVE",
          )
        : "ANALYSIS_FAILED",
    });
  }
  private planRunning(C: number, transport: PerformanceClockSnapshot): void {
    if (!this.runtime.microphone || !analysisAvailable(this.control)) return;
    const beginC = C + transport.countInRemainingMs / 1000;
    this.runtime.boundaries.begin = this.boundary(
      "BEGIN",
      beginC,
      transport.performanceTimeMs,
    );
    this.runtime.boundaries.terminal = this.boundary(
      "TERMINAL",
      beginC +
        (this.runtime.session!.clock.scopeDurationMs() -
          transport.performanceTimeMs) /
          1000,
      this.runtime.session!.clock.scopeDurationMs(),
    );
  }
  private cancelFuture(cancelBegin: boolean): void {
    const h = this.runtime;
    if (cancelBegin) h.microphone?.cancelPending(h.boundaries.begin);
    h.microphone?.cancelPending(h.boundaries.terminal);
    h.boundaries = { begin: null, terminal: null };
  }
  private boundary(
    type: "BEGIN" | "PAUSE" | "TERMINAL",
    C: number,
    T: number,
  ): string | null {
    if (!this.runtime.microphone || !analysisAvailable(this.control))
      return null;
    try {
      return this.runtime.microphone.boundary(type, C, T);
    } catch (cause) {
      this.runtime.microphone.fail(
        cause instanceof Error
          ? cause
          : new Error("Unexpected microphone boundary failure", { cause }),
      );
      this.analysisFailure(this.control.attemptId, cause);
      return null;
    }
  }
  private async finalize(operationId: number): Promise<void> {
    this.stopScheduling();
    let finalizedRecording: PerformanceRecording | null = null;
    try {
      const stopped = Promise.resolve(
        this.runtime.recorder?.freeze(
          this.control.transport!.performanceTimeMs,
        ),
      ).catch((cause) => this.fatal("RECORDER_UNAVAILABLE", cause));
      if (
        this.runtime.microphone &&
        this.control.analysis.kind === "DRAINING"
      ) {
        try {
          await this.runtime.microphone.finish(this.runtime.abort.signal);
        } catch (cause) {
          this.analysisFailure(this.control.attemptId, cause);
        }
      }
      await stopped;
      if (!this.finalizing(operationId)) return;
      const recording = await this.runtime.recorder!.finalize();
      finalizedRecording = recording;
      if (!this.finalizing(operationId)) {
        if (recording.status === "READY")
          await releaseRecordingMedia(recording.resource);
        return;
      }
      const session = this.runtime.session!,
        sessionSnapshot = session.snapshotSession();
      const evaluation = analysisControlError(this.control)
        ? unavailableContinuousEvaluation(
            this.options.plan.resources.input.kind,
            "CONTINUOUS_ANALYSIS_UNAVAILABLE",
          )
        : session.completedEvaluation();
      if (!this.runtime.evidenceProvenance)
        throw new Error("CONTINUOUS_EVIDENCE_IDENTITY_UNAVAILABLE");
      const completion = createNaturalContinuousCompletion({
        session: sessionSnapshot,
        evaluation,
        evidenceProvenance: this.runtime.evidenceProvenance,
        recording,
        completedAt: new Date().toISOString(),
      });
      finalizedRecording = null;
      this.dispatch({
        type: "FINALIZED",
        operationId,
        completion,
        session: sessionSnapshot,
      });
    } catch (cause) {
      if (finalizedRecording?.status === "READY")
        await releaseRecordingMedia(finalizedRecording.resource);
      this.dispatch({
        type: "FINALIZATION_FAILED",
        operationId,
        code: isPracticeCausalFailure(cause)
          ? projectContinuousFailure(cause, "ACTIVE")
          : "RECORDER_UNAVAILABLE",
        cause,
      });
    }
  }
  private finalizing(operationId: number): boolean {
    return (
      this.control.tag === "FINALIZING" &&
      this.control.operationId === operationId
    );
  }
  private fatal(code: ContinuousErrorCode, cause: unknown = code): void {
    this.record("SESSION_FAILED", String(cause));
    this.dispatch({
      type: "FATAL_FAILED",
      attemptId: this.control.attemptId,
      code,
      cause,
    });
  }
  private releaseAnalysis(): Promise<void> {
    if (!this.operations.analysisRelease) {
      try {
        this.operations.analysisRelease =
          this.runtime.microphone?.dispose() ?? settled;
      } catch (cause) {
        this.operations.analysisRelease = Promise.reject(cause);
      }
    }
    return this.operations.analysisRelease;
  }
  private stopScheduling(): void {
    if (this.runtime.timer) clearInterval(this.runtime.timer);
    this.runtime.timer = null;
    this.runtime.metronome?.stop();
  }
  private async cleanup(operationId: number): Promise<void> {
    const h = this.runtime;
    this.stopScheduling();
    h.abort.abort();
    if (!this.operations.resourceRelease) {
      h.inputResources?.dispose();
      h.inputResources = null;
      h.detachRootHealth?.();
      h.detachRootHealth = null;
      h.detachRecorder?.();
      h.detachRecorder = null;
      this.operations.resourceRelease = (async () => {
        const jobs = [
          () => h.metronome?.dispose(),
          () => h.midi?.dispose(),
          () => h.recorder?.stopAndCleanup(),
          () => this.releaseAnalysis(),
        ].map((release) => {
          try {
            return Promise.resolve(release());
          } catch (cause) {
            return Promise.reject(cause);
          }
        });
        const results = await Promise.allSettled(jobs),
          failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
        h.rootStream = null;
        try {
          if (h.context && h.context.state !== "closed")
            await h.context.close();
        } catch (cause) {
          failures.push(cause);
        }
        return failures;
      })();
    }
    const failures = await this.operations.resourceRelease;
    await Promise.allSettled([
      this.operations.preparation,
      this.operations.finalization,
      this.operations.recordingRetirement,
    ]);
    await this.operations.mediaRetirement;
    this.dispatch({
      type: "CLEANUP_FINISHED",
      operationId,
      ...(failures.length ? { failure: failures[0] } : {}),
    });
    if (this.control.tag === "DISPOSED") this.listeners.clear();
  }
  private record(action: string, detail?: string): void {
    this.diagnostics.push(
      Object.freeze({
        action,
        state: this.control.tag,
        performanceTimeMs: this.control.transport?.performanceTimeMs ?? 0,
        ...(detail ? { detail: detail.slice(0, 256) } : {}),
      }),
    );
    if (this.diagnostics.length > DIAGNOSTIC_LIMIT) this.diagnostics.shift();
  }
}

/** Pure presentation of accepted control state and non-advancing leaf observations. */
function projectContinuousControllerSnapshot(
  state: ContinuousControlState,
  observations: Readonly<{
    microphoneState: string | null;
    recording: ContinuousControllerSnapshot["recording"];
    evaluation: ContinuousTargetFeedback | null;
  }>,
): ContinuousControllerSnapshot {
  const transport = state.transport,
    error = analysisControlError(state);
  const analysisIntervention: ContinuousAnalysisIntervention | null =
    state.tag === "ACTIVE" && state.analysis.kind === "INTERRUPTED"
      ? Object.freeze({
          pauseOrigin:
            state.pauseOwnership === "USER" ? "USER" : "INTERVENTION",
        })
      : null;
  const analysis: ContinuousControllerSnapshot["analysis"] = !state
    .configuration.analysisRequired
    ? "NOT_REQUIRED"
    : state.tag === "FAILED"
      ? "FAILED"
      : analysisIntervention
        ? "INTERRUPTED"
        : state.analysis.kind === "DISABLED"
          ? "DISABLED"
          : error
            ? "FAILED"
            : state.tag === "PREPARING"
              ? observations.microphoneState === "PREROLL"
                ? "PREROLL"
                : "PREPARING"
              : state.tag === "COMPLETE"
                ? "COMPLETE"
                : state.tag === "FINALIZING"
                  ? "DRAINING"
                  : transport?.state === "PAUSED"
                    ? "PAUSED"
                    : transport?.state === "RUNNING"
                      ? "RUNNING"
                      : "PREROLL";
  const session: ContinuousControllerState =
    state.tag === "FAILED" && state.failure.origin === "PREPARATION"
      ? "FAILED_BEFORE_START"
      : state.tag;
  return Object.freeze({
    session,
    transport: transport ? Object.freeze({ ...transport }) : null,
    analysis,
    analysisError: error,
    inputError:
      state.tag === "FAILED"
        ? state.failure.code
        : state.resources.midi === "LOST"
          ? "NO_CONNECTED_INPUT"
          : null,
    recording:
      state.tag === "ABANDONED" ||
      state.tag === "DISPOSED" ||
      (state.tag === "FAILED" && state.failure.origin !== "PREPARATION")
        ? null
        : observations.recording,
    analysisIntervention,
    resourceIntervention: resourceIntervention(state),
    evaluation:
      error || ["FAILED", "ABANDONED", "DISPOSED"].includes(state.tag)
        ? null
        : observations.evaluation,
    completed: state.tag === "COMPLETE" ? state.completion : null,
    sessionSnapshot: state.tag === "COMPLETE" ? state.session : null,
  });
}
