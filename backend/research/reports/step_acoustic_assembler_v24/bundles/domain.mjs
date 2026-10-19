// apps/customer-web/src/lib/practice/local-core/artifact.ts
var PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1;
function assertPracticeScoreArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error("PracticeScoreArtifact must be an object");
  }
  const candidate = artifact;
  if (candidate.schemaVersion !== PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported PracticeScoreArtifact schema: ${candidate.schemaVersion}`);
  }
  if (!candidate.scoreId || !candidate.revisionId || !candidate.artifactId) {
    throw new Error("PracticeScoreArtifact requires stable score, revision, and artifact identity.");
  }
  if (!Array.isArray(candidate.scoreTempoSegments)) {
    throw new Error("PracticeScoreArtifact requires scoreTempoSegments array.");
  }
  for (let i = 0; i < candidate.scoreTempoSegments.length; i += 1) {
    const segment = candidate.scoreTempoSegments[i];
    if (!segment || typeof segment !== "object") {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(segment.startBeat) || segment.startBeat < 0) {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid startBeat: ${segment.startBeat}.`);
    }
    if (!Number.isFinite(segment.bpm) || segment.bpm <= 0) {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid bpm: ${segment.bpm}.`);
    }
    if (i > 0 && segment.startBeat <= candidate.scoreTempoSegments[i - 1].startBeat) {
      throw new Error(
        "PracticeScoreArtifact scoreTempoSegments must be strictly sorted by startBeat ascending without duplicate start beats."
      );
    }
  }
  if (!Array.isArray(candidate.meterSegments)) {
    throw new Error("PracticeScoreArtifact requires meterSegments array.");
  }
  for (let i = 0; i < candidate.meterSegments.length; i += 1) {
    const meter = candidate.meterSegments[i];
    if (!meter || typeof meter !== "object") {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(meter.startBeat) || meter.startBeat < 0) {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} has invalid startBeat: ${meter.startBeat}.`);
    }
    if (!Number.isFinite(meter.numerator) || meter.numerator < 1 || !Number.isFinite(meter.denominator) || meter.denominator < 1) {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} has invalid time signature.`);
    }
  }
  if (!Array.isArray(candidate.practiceAttackSteps) || !Array.isArray(candidate.expectedPracticeGroups) || candidate.practiceAttackSteps.length !== candidate.expectedPracticeGroups.length) {
    throw new Error("PracticeScoreArtifact requires 1:1 attack steps and expected groups.");
  }
  const validArtifact = candidate;
  validArtifact.practiceAttackSteps.forEach((step, index) => {
    const group = validArtifact.expectedPracticeGroups[index];
    if (roundBeat(step.onsetBeat) !== roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact step/group onset mismatch at index ${index}.`);
    }
    const groupPitches = uniqueSorted(group.pitches);
    const stepPitches = uniqueSorted(step.attackTargets.map((target) => target.pitch));
    const strikePitches = uniqueSorted(group.strikeTargets.map((target) => target.pitch));
    if (groupPitches.join("") !== stepPitches.join("")) {
      throw new Error(`PracticeScoreArtifact step/group attack pitch mismatch at index ${index}.`);
    }
    if (groupPitches.join("") !== strikePitches.join("")) {
      throw new Error(`PracticeScoreArtifact group strike target mismatch at index ${index}.`);
    }
    if (roundBeat(group.canonicalEndBeat) < roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact group canonical end precedes onset at index ${index}.`);
    }
  });
}
function resolvePracticeScope(artifact, scope) {
  assertPracticeScoreArtifact(artifact);
  if (artifact.expectedPracticeGroups.length === 0) {
    throw new Error("Practice scope requires at least one expected group.");
  }
  const isRange = scope.kind === "RANGE";
  const startIndex = isRange ? groupIndex(artifact, scope.startGroupId) : 0;
  const endIndex = isRange ? groupIndex(artifact, scope.endGroupId) : artifact.expectedPracticeGroups.length - 1;
  if (endIndex < startIndex) {
    throw new Error("Practice scope end must not be before its start.");
  }
  const startGroup = artifact.expectedPracticeGroups[startIndex];
  const endGroup = artifact.expectedPracticeGroups[endIndex];
  if (scope.kind === "RANGE") {
    return {
      kind: "RANGE",
      startGroupId: scope.startGroupId,
      endGroupId: scope.endGroupId,
      startIndex,
      endIndex,
      startBeat: startGroup.onsetBeat,
      terminalBeat: entryGroupEndBeat(artifact, endGroup.groupId)
    };
  }
  return {
    kind: "FULL",
    startIndex,
    endIndex,
    startBeat: startGroup.onsetBeat,
    terminalBeat: artifact.scoreEndBeat
  };
}
function entryGroupEndBeat(artifact, groupId) {
  const group = artifact.expectedPracticeGroups.find((candidate) => candidate.groupId === groupId);
  if (!group) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return roundBeat(group.canonicalEndBeat);
}
function attackPitchesForStep(step) {
  return step.attackTargets.map((target) => target.pitch);
}
function continuationPitchesForStep(step) {
  return Array.from(new Set(step.continuation.map((note) => note.pitch)));
}
function groupIndex(artifact, groupId) {
  const index = artifact.expectedPracticeGroups.findIndex((group) => group.groupId === groupId);
  if (index < 0) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return index;
}
function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}
function roundBeat(value) {
  return Math.round(value * 1e6) / 1e6;
}

// apps/customer-web/src/lib/practice/local-core/evidence.ts
function normalizePitchSet(pitches) {
  return Array.from(new Set(pitches)).sort();
}
function pitchSetsEqual(left, right) {
  return normalizePitchSet(left).join("") === normalizePitchSet(right).join("");
}

// apps/customer-web/src/lib/practice/local-core/timebase.ts
var ManualClock = class {
  constructor(initialMs = 0) {
    this.currentMs = initialMs;
  }
  nowMs() {
    return this.currentMs;
  }
  set(ms) {
    this.currentMs = ms;
  }
  advance(ms) {
    this.currentMs += ms;
  }
};
var PracticeTimebase = class {
  constructor(options, sampleRateHz) {
    if (typeof options === "string") {
      this.domainId = options;
      this.runtimeOriginMs = 0;
      this.sampleRateHz = sampleRateHz;
      this.anchorSampleIndex = 0;
      this.anchorSessionTimeMs = 0;
      return;
    }
    this.domainId = options.domainId;
    this.runtimeOriginMs = options.runtimeOriginMs ?? 0;
    this.sampleRateHz = options.sampleRateHz;
    this.anchorSampleIndex = options.anchorSampleIndex ?? 0;
    this.anchorSessionTimeMs = options.anchorSessionTimeMs ?? 0;
  }
  atSessionMs(ms, sampleIndex) {
    if (!Number.isFinite(ms)) {
      throw new Error("Session time values must be finite.");
    }
    return sampleIndex === void 0 ? { domainId: this.domainId, ms } : { domainId: this.domainId, ms, sampleIndex };
  }
  runtimeToSessionTime(runtimeMs) {
    return this.atSessionMs(runtimeMs - this.runtimeOriginMs);
  }
  sampleIndexToSessionTime(sampleIndex) {
    if (!this.sampleRateHz || this.sampleRateHz <= 0) {
      throw new Error("Sample-index time conversion requires a positive sample rate.");
    }
    return this.atSessionMs(
      this.anchorSessionTimeMs + (sampleIndex - this.anchorSampleIndex) / this.sampleRateHz * 1e3,
      sampleIndex
    );
  }
  midiEventToSessionTime(midiEventTimeMs) {
    return this.runtimeToSessionTime(midiEventTimeMs);
  }
  assertSameSessionTimeDomain(left, right) {
    if (!Number.isFinite(left.ms) || !Number.isFinite(right.ms)) {
      throw new Error("Session time values must be finite before comparison.");
    }
    if (left.domainId !== right.domainId) {
      throw new Error("Session time values belong to different practice time domains.");
    }
  }
};

// apps/customer-web/src/lib/practice/local-core/session.ts
function createLocalSessionId(prefix = "local-practice") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}

// apps/customer-web/src/lib/practice/local-core/step-attempt.ts
var MAX_STEP_HISTORY_RECORDS = 1e5;
var STEP_RUNTIME_VERSION = Object.freeze({ schemaVersion: 6, runtimeVersion: "step-source-sensitive-verdict-v6" });
var StepDomainError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "StepDomainError";
  }
};

// apps/customer-web/src/lib/practice/local-core/step-runtime.ts
var StepPracticeRuntime = class {
  constructor(options) {
    this.options = options;
    this.generation = 1;
    this.status = "ACTIVE";
    this.completed = false;
    this.completionReason = null;
    this.attemptState = "READY";
    this.active = null;
    this.pendingPostVerdict = null;
    this.sequence = 0;
    this.inputAvailable = true;
    this.attempts = [];
    this.skips = [];
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.inputSource = options.inputSource;
    this.resolvedScope = resolvePracticeScope(this.artifact, options.scope);
    this.currentIndex = this.resolvedScope.startIndex;
    this.localSessionId = options.localSessionId ?? createLocalSessionId("step");
    this.timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    if (this.timebase.domainId !== this.localSessionId) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    this.boundary = this.now();
    this.createdAtMs = this.epoch();
    this.metronomeEnabled = options.metronomeEnabled ?? false;
  }
  currentTarget() {
    const step = this.artifact.practiceAttackSteps[this.currentIndex];
    if (!step || this.completed || this.status !== "ACTIVE") return null;
    return Object.freeze({
      stepId: step.stepId,
      targetGeneration: this.generation,
      inputEligibleAfter: this.boundary,
      attackPitches: Object.freeze(attackPitchesForStep(step)),
      continuationPitches: Object.freeze(continuationPitchesForStep(step))
    });
  }
  openAttempt(start) {
    const target = this.currentTarget();
    if (!target || !this.canAcceptAttempt) return null;
    this.validateTime(start);
    if (start.ms <= this.boundary.ms) return null;
    this.assertHistoryRoom();
    this.active = Object.freeze({
      attemptId: `${this.localSessionId}:attempt:${++this.sequence}`,
      localSessionId: this.localSessionId,
      stepId: target.stepId,
      targetGeneration: this.generation,
      inputSource: this.inputSource,
      attemptStartSessionTime: Object.freeze({ ...start })
    });
    this.attemptState = "CAPTURING";
    return this.active;
  }
  analyzeAttempt(identity) {
    if (!this.owns(identity) || this.attemptState !== "CAPTURING") return false;
    this.attemptState = "ANALYZING";
    return true;
  }
  completeAttempt(identity, evidence) {
    if (!this.owns(identity) || this.attemptState !== "ANALYZING") return Object.freeze({ kind: "REJECTED", reason: "STALE_ATTEMPT" });
    this.validateTime(evidence.captureEndSessionTime);
    if (evidence.captureEndSessionTime.ms < identity.attemptStartSessionTime.ms) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    if (evidence.kind === "EVIDENCE" && (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1 || evidence.observedAttackPitches.length > 128 || evidence.observedAttackPitches.some((p) => !/^[A-G]#?-?\d$/.test(p)))) {
      throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    }
    if (evidence.kind === "RETRY" && evidence.reason !== "UNCERTAIN" && evidence.reason !== "TOO_QUIET") throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    const pitches = Object.freeze(evidence.kind === "EVIDENCE" ? normalizePitchSet(evidence.observedAttackPitches) : []);
    const expected = this.currentTarget().attackPitches;
    const verdict = evidence.kind === "RETRY" ? "RETRY" : pitchSetsEqual(pitches, expected) ? "MATCH" : this.verdictPolicy === "MICROPHONE_CONSERVATIVE_TRISTATE" && expected.every((pitch2) => pitches.includes(pitch2)) ? "RETRY" : "MISMATCH";
    const record = Object.freeze({
      ...this.active,
      verdict,
      observedAttackPitches: pitches,
      confidence: evidence.kind === "EVIDENCE" ? evidence.confidence : null,
      captureEndSessionTime: Object.freeze({ ...evidence.captureEndSessionTime }),
      retryReason: evidence.kind === "RETRY" ? evidence.reason : verdict === "RETRY" ? "UNCERTAIN" : null
    });
    this.attempts.push(record);
    this.active = null;
    this.attemptState = "POST_VERDICT";
    this.pendingPostVerdict = record;
    this.boundary = record.captureEndSessionTime;
    return Object.freeze({ kind: "FINALIZED", record });
  }
  rearm(acceptAfterSessionTime) {
    if (this.status !== "ACTIVE" || !this.inputAvailable || this.attemptState !== "POST_VERDICT" || !this.pendingPostVerdict) throw new StepDomainError("STEP_ATTEMPT_STATE_INVALID");
    this.validateTime(acceptAfterSessionTime);
    if (acceptAfterSessionTime.ms < this.boundary.ms) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    this.boundary = Object.freeze({ ...acceptAfterSessionTime });
    const verdict = this.pendingPostVerdict.verdict;
    this.pendingPostVerdict = null;
    this.attemptState = "READY";
    if (verdict === "MATCH") this.advance();
  }
  cancelAttempt() {
    this.active = null;
    if (this.attemptState !== "POST_VERDICT") this.attemptState = "READY";
  }
  setInputUnavailable() {
    if (this.status !== "ACTIVE") return;
    this.cancelAttempt();
    this.inputAvailable = false;
  }
  acceptInputAfter(capturedThrough) {
    if (this.status !== "ACTIVE" || this.inputAvailable || this.active || this.attemptState !== "READY" && this.attemptState !== "POST_VERDICT") throw new StepDomainError("STEP_ATTEMPT_STATE_INVALID");
    this.validateTime(capturedThrough);
    if (capturedThrough.ms < this.boundary.ms) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    this.boundary = Object.freeze({ ...capturedThrough });
    this.inputAvailable = true;
  }
  skip() {
    const target = this.currentTarget();
    if (!target || !this.canAcceptAttempt) return false;
    this.assertHistoryRoom();
    this.cancelAttempt();
    const skippedAt = this.now();
    if (skippedAt.ms > this.boundary.ms) this.boundary = skippedAt;
    this.skips.push(Object.freeze({ stepId: target.stepId, targetGeneration: this.generation, sessionTime: skippedAt }));
    this.advance();
    return true;
  }
  end() {
    if (this.status === "ENDED") return;
    this.cancelAttempt();
    this.status = "ENDED";
    this.completionReason = "STOPPED_BY_USER";
  }
  snapshot() {
    return Object.freeze({
      localSessionId: this.localSessionId,
      scoreId: this.artifact.scoreId,
      revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId,
      mode: "STEP_BY_STEP",
      inputSource: this.inputSource,
      practiceScope: Object.freeze({ ...this.options.scope }),
      tempoSelection: Object.freeze({ ...this.options.tempoSelection ?? { mode: "SCORE" } }),
      metronomeEnabled: this.metronomeEnabled,
      runtimeStatus: this.status,
      completionReason: this.completionReason,
      version: STEP_RUNTIME_VERSION,
      createdAtMs: this.createdAtMs,
      updatedAtMs: this.epoch(),
      step: Object.freeze({
        verdictPolicy: this.verdictPolicy,
        currentIndex: this.currentIndex,
        targetGeneration: this.generation,
        inputEligibleAfter: this.boundary,
        inputAvailable: this.inputAvailable,
        completed: this.completed,
        attemptState: this.attemptState,
        activeAttempt: this.active,
        pendingPostVerdict: this.pendingPostVerdict,
        canAcceptAttempt: this.canAcceptAttempt,
        attempts: Object.freeze([...this.attempts]),
        skips: Object.freeze([...this.skips])
      })
    });
  }
  setMetronomeEnabled(enabled) {
    this.metronomeEnabled = enabled;
  }
  get currentStepIndex() {
    return this.currentIndex;
  }
  get currentOnsetBeat() {
    return this.artifact.practiceAttackSteps[this.currentIndex]?.onsetBeat ?? this.resolvedScope.terminalBeat;
  }
  get isCompleted() {
    return this.completed;
  }
  get state() {
    return this.status;
  }
  get verdictPolicy() {
    return this.inputSource === "MIDI" ? "MIDI_EXACT_SET" : "MICROPHONE_CONSERVATIVE_TRISTATE";
  }
  get canAcceptAttempt() {
    return this.status === "ACTIVE" && this.inputAvailable && this.attemptState === "READY" && this.currentTarget() !== null;
  }
  advance() {
    this.currentIndex++;
    this.generation++;
    if (this.currentIndex > this.resolvedScope.endIndex) {
      this.completed = true;
      this.status = "ENDED";
      this.completionReason = "SCOPE_COMPLETED";
    }
  }
  owns(identity) {
    return this.status === "ACTIVE" && this.active !== null && identity.attemptId === this.active.attemptId && identity.localSessionId === this.localSessionId && identity.stepId === this.active.stepId && identity.targetGeneration === this.generation && identity.inputSource === this.inputSource && identity.attemptStartSessionTime.domainId === this.active.attemptStartSessionTime.domainId && identity.attemptStartSessionTime.ms === this.active.attemptStartSessionTime.ms;
  }
  assertHistoryRoom() {
    if (this.attempts.length + this.skips.length >= MAX_STEP_HISTORY_RECORDS) {
      this.end();
      throw new StepDomainError("STEP_HISTORY_LIMIT_EXCEEDED");
    }
  }
  validateTime(time) {
    if (!time || time.domainId !== this.localSessionId || !Number.isFinite(time.ms)) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
  }
  now() {
    return Object.freeze(this.timebase.runtimeToSessionTime(this.options.clock.nowMs()));
  }
  epoch() {
    return this.options.metadataClock?.nowEpochMs() ?? Date.now();
  }
};

// apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts
var STEP_ACOUSTIC_GESTURE_MS = 50;
var MAX_STEP_ACOUSTIC_IDENTITIES = 1e5;
var MAX_GESTURE_OBSERVATIONS = 32768;
var order = (a, b) => a.sourceEventSample - b.sourceEventSample || (a.observationId < b.observationId ? -1 : a.observationId === b.observationId ? 0 : 1);
var fingerprint = (o) => JSON.stringify([
  o.observationId,
  o.pitch,
  o.midiPitch,
  o.confidence,
  o.sourceDomainId,
  o.sourceSampleRateHz,
  o.sourceEventSample,
  o.targetSample
]);
var validSample = (sample) => Number.isFinite(sample) && sample >= 0 && sample <= Number.MAX_SAFE_INTEGER;
var StepAcousticAttemptAssembler = class {
  constructor(options) {
    this.phase = "BLOCKED";
    this.active = null;
    this.eligibleAfter = null;
    this.frontier = null;
    this.lastWindow = null;
    this.processing = false;
    this.seen = /* @__PURE__ */ new Map();
    if (!options.sourceDomainId || options.sourceDomainId.length > 192 || !options.localSessionId || ![44100, 48e3].includes(options.sourceSampleRateHz) || !validSample(options.sourceAnchorSample) || options.sessionAnchorTime.domainId !== options.localSessionId || !Number.isFinite(options.sessionAnchorTime.ms)) {
      throw new Error("STEP_ACOUSTIC_SOURCE_MAPPING_INVALID");
    }
    this.sourceDomainId = options.sourceDomainId;
    this.sourceRate = options.sourceSampleRateHz;
    this.sink = Object.freeze({ ...options.sink });
    this.timebase = new PracticeTimebase({
      domainId: options.localSessionId,
      sampleRateHz: this.sourceRate,
      anchorSampleIndex: options.sourceAnchorSample,
      anchorSessionTimeMs: options.sessionAnchorTime.ms
    });
  }
  /** External owner calls only after its explicit retirement/READY commit. This does not rearm the domain. */
  acceptInputAfter(sourceWatermark) {
    this.guard();
    if (this.active || !validSample(sourceWatermark) || this.eligibleAfter !== null && sourceWatermark < this.eligibleAfter || this.frontier !== null && sourceWatermark < this.frontier) this.fail("STEP_ACOUSTIC_RETIREMENT_INVALID");
    this.eligibleAfter = sourceWatermark;
    this.phase = "READY";
  }
  /** Unfinished ownership is invalidated, not queued. Caller separately cancels its domain attempt. */
  suspend() {
    this.guard();
    this.active = null;
    this.phase = "BLOCKED";
  }
  accept(publication) {
    this.guard();
    this.processing = true;
    try {
      if (publication.sourceDomainId !== this.sourceDomainId || publication.sourceSampleRateHz !== this.sourceRate || !validSample(publication.ownedThroughSourceSample) || publication.observations.length > MAX_GESTURE_OBSERVATIONS) {
        this.fail("STEP_ACOUSTIC_PUBLICATION_INVALID");
      }
      const previousFrontier = this.frontier;
      if (this.active && previousFrontier !== null && publication.ownedThroughSourceSample > previousFrontier && this.lastWindow && (publication.window.regionIndex !== this.lastWindow.region || publication.window.windowIndex > this.lastWindow.index + 1)) {
        this.fail("STEP_ACOUSTIC_GESTURE_COVERAGE_GAP");
      }
      const observations = [...publication.observations].sort(order), fresh = /* @__PURE__ */ new Set();
      for (const o of observations) {
        if (Object.keys(o).length !== 8 || o.sourceDomainId !== this.sourceDomainId || o.sourceSampleRateHz !== this.sourceRate || !o.observationId || o.observationId.length > 512 || !validSample(o.sourceEventSample) || !Number.isSafeInteger(o.targetSample) || o.sourceEventSample >= publication.ownedThroughSourceSample || !Number.isInteger(o.midiPitch) || o.midiPitch < 21 || o.midiPitch > 108 || !/^[A-G]#?-?\d$/.test(o.pitch) || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) this.fail("STEP_ACOUSTIC_OBSERVATION_INVALID");
        const value = fingerprint(o), old = this.seen.get(o.observationId);
        if (old !== void 0 && old !== value) this.fail("STEP_ACOUSTIC_MUTATED_OBSERVATION");
        if (old === void 0) {
          if (this.seen.size === MAX_STEP_ACOUSTIC_IDENTITIES) this.fail("STEP_ACOUSTIC_IDENTITY_LIMIT");
          if (this.phase !== "BLOCKED" && this.eligibleAfter !== null && o.sourceEventSample > this.eligibleAfter && previousFrontier !== null && o.sourceEventSample < previousFrontier) this.fail("STEP_ACOUSTIC_NONCHRONOLOGICAL_OBSERVATION");
          this.seen.set(o.observationId, value);
          fresh.add(o.observationId);
        }
      }
      this.frontier = Math.max(previousFrontier ?? 0, publication.ownedThroughSourceSample);
      if (previousFrontier === null || publication.ownedThroughSourceSample > previousFrontier) {
        this.lastWindow = Object.freeze({ region: publication.window.regionIndex, index: publication.window.windowIndex });
      }
      if (this.phase === "READY") {
        const first = observations.find((o) => fresh.has(o.observationId) && o.sourceEventSample > this.eligibleAfter);
        if (first) {
          const identity = this.sink.open(this.timebase.sampleIndexToSessionTime(first.sourceEventSample));
          this.assertCallbackDidNotFail();
          if (identity === null) {
            this.phase = "BLOCKED";
            return null;
          }
          const end = first.sourceEventSample + this.sourceRate * STEP_ACOUSTIC_GESTURE_MS / 1e3;
          if (!validSample(end)) this.fail("STEP_ACOUSTIC_INTERVAL_INVALID");
          this.active = { identity, anchor: first.sourceEventSample, end, observations: /* @__PURE__ */ new Map() };
          this.phase = "CAPTURING";
        }
      }
      if (!this.active) return null;
      const active = this.active;
      for (const o of observations) if (o.sourceEventSample >= active.anchor && o.sourceEventSample < active.end && (fresh.has(o.observationId) || active.observations.has(o.observationId))) {
        active.observations.set(o.observationId, Object.freeze({ ...o }));
        if (active.observations.size > MAX_GESTURE_OBSERVATIONS) this.fail("STEP_ACOUSTIC_GESTURE_LIMIT");
      }
      if (this.frontier < active.end) return null;
      if (!active.observations.size) this.fail("STEP_ACOUSTIC_EMPTY_GESTURE");
      const bounded = Object.freeze([...active.observations.values()].sort(order));
      const evidence = Object.freeze({
        kind: "EVIDENCE",
        observedAttackPitches: Object.freeze([...new Set(bounded.map((o) => o.pitch))].sort()),
        confidence: Math.min(...bounded.map((o) => o.confidence)),
        captureEndSessionTime: Object.freeze(this.timebase.sampleIndexToSessionTime(active.end))
      });
      const sealed = Object.freeze({
        sourceDomainId: this.sourceDomainId,
        sourceSampleRateHz: this.sourceRate,
        anchorSourceSample: active.anchor,
        endSourceSample: active.end,
        observations: bounded,
        evidence
      });
      this.active = null;
      this.phase = "BLOCKED";
      this.sink.complete(active.identity, evidence);
      this.assertCallbackDidNotFail();
      return sealed;
    } catch (error) {
      this.active = null;
      this.phase = "FAILED";
      throw error;
    } finally {
      this.processing = false;
    }
  }
  snapshot() {
    return Object.freeze({
      phase: this.phase,
      inputEligibleAfterSourceSample: this.eligibleAfter,
      processedThroughSourceSample: this.frontier,
      gestureAnchorSourceSample: this.active?.anchor ?? null,
      gestureEndSourceSample: this.active?.end ?? null,
      activeObservationCount: this.active?.observations.size ?? 0,
      retainedObservationIdentityCount: this.seen.size
    });
  }
  guard() {
    if (this.processing || this.phase === "FAILED") this.fail("STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE");
  }
  assertCallbackDidNotFail() {
    if (this.phase === "FAILED") this.fail("STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE");
  }
  fail(code) {
    this.active = null;
    this.phase = "FAILED";
    throw new Error(code);
  }
};

// backend/research/step_acoustic_assembler_v24/domain.ts
var pitch = (n) => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12] + (Math.floor(n / 12) - 1);
function runtime(targets, domainId) {
  const artifact = {
    schemaVersion: 1,
    scoreId: "frozen-v6",
    revisionId: "v6",
    artifactId: "v24-h50-replay",
    scoreEndBeat: targets.length,
    scoreTempoSegments: [],
    meterSegments: [],
    expectedPracticeGroups: targets.map((set, i) => ({
      groupId: `g${i}`,
      onsetBeat: i,
      canonicalEndBeat: i + 1,
      pitches: set.map(pitch),
      strikeTargets: set.map((n) => ({ pitch: pitch(n) })),
      renderNoteIds: []
    })),
    practiceAttackSteps: targets.map((set, i) => ({ stepId: `s${i}`, onsetBeat: i, attackTargets: set.map((n) => ({ pitch: pitch(n) })), continuation: [] }))
  };
  const clock = new ManualClock(), owner = new StepPracticeRuntime({
    artifact,
    scope: { kind: "FULL" },
    inputSource: "MICROPHONE",
    clock,
    localSessionId: domainId,
    metadataClock: { nowEpochMs: () => 0 }
  });
  return { owner, clock, time: (ms) => ({ domainId, ms }) };
}
export {
  StepAcousticAttemptAssembler,
  runtime
};
