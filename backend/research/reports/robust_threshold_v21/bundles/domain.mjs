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

// backend/research/step_waiting_topology_v3/assembly.ts
var GESTURE_WIDTH_MS = 50;
var WaitingTopologyGate = class {
  constructor(rate, domain, start, semanticEnd, analysisHold, resetHold) {
    this.rate = rate;
    this.domain = domain;
    this.semanticEnd = semanticEnd;
    this.analysisHold = analysisHold;
    this.resetHold = resetHold;
    if (![44100, 48e3].includes(rate) || ![start, semanticEnd, analysisHold, resetHold].every(Number.isSafeInteger)) throw Error("SOURCE_SCRIPT_INVALID");
    this.physical = start;
    this.eligible = start;
  }
  state = "UNAVAILABLE";
  physical;
  eligible;
  active = null;
  pending = null;
  until = Infinity;
  actions = [];
  receipts = [];
  arm(source, wallMs) {
    if (this.state !== "UNAVAILABLE" || source !== this.physical) throw Error("INVALID_ARM");
    this.eligible = source;
    this.state = "READY";
    this.actions.push({ type: "ARM", sourceSample: source, wallMs, eligibleAfter: source });
  }
  get nextBoundary() {
    return this.until;
  }
  captureThrough(source, wallMs) {
    if (source < this.physical) throw Error("CAPTURE_BACKWARDS");
    this.physical = source;
    if (source >= this.until && this.state === "ANALYZING") this.finishAnalysis(wallMs);
    if (source >= this.until && this.state === "RESET") this.reopen(wallMs);
  }
  finishAnalysis(wallMs) {
    this.actions.push({ type: "VERDICT_READY", sourceSample: this.physical, wallMs, attempt: this.pending });
    this.state = "RESET";
    this.until = this.physical + this.resetHold;
    this.actions.push({ type: "RESET", sourceSample: this.physical, wallMs, id: this.pending.id });
    if (!this.resetHold) this.reopen(wallMs);
  }
  reopen(wallMs) {
    this.eligible = this.physical;
    this.state = "READY";
    this.until = Infinity;
    this.actions.push({ type: "READY", sourceSample: this.physical, wallMs, eligibleAfter: this.eligible, id: this.pending.id });
    this.pending = null;
  }
  accept(p) {
    if (p.capturedThrough !== this.physical) throw Error("CAPTURE_RECEIPT_MISMATCH");
    const before = this.state;
    let opened = false;
    if (this.state === "READY") {
      const first = [...p.observations].sort((a, b) => a.sourceEventSample - b.sourceEventSample || a.observationId.localeCompare(b.observationId)).find((o) => o.sourceEventSample > this.eligible && o.sourceEventSample < this.semanticEnd);
      if (first) {
        this.active = {
          id: `${this.domain}:a:${first.sourceEventSample}`,
          anchor: first.sourceEventSample,
          end: first.sourceEventSample + this.rate * GESTURE_WIDTH_MS / 1e3,
          lockWallMs: p.wallMs,
          eligibleAfter: this.eligible,
          observations: /* @__PURE__ */ new Map()
        };
        this.state = "CAPTURING";
        opened = true;
        this.actions.push({ type: "OPEN", wallMs: p.wallMs, sourceSample: this.physical, id: this.active.id, anchor: this.active.anchor, eligibleAfter: this.eligible });
      }
    }
    if (this.state === "CAPTURING") {
      const a = this.active;
      for (const o of p.observations) if (o.sourceEventSample >= a.anchor && o.sourceEventSample < a.end) {
        const old = a.observations.get(o.observationId);
        if (old && JSON.stringify(old) !== JSON.stringify(o)) throw Error("MUTATED_OBSERVATION");
        a.observations.set(o.observationId, Object.freeze({ ...o }));
        if (a.observations.size > 32768) throw Error("BOUNDED_ATTEMPT_LIMIT");
      }
      if (p.frontier >= a.end) {
        const observations = Object.freeze([...a.observations.values()]);
        this.pending = Object.freeze({
          id: a.id,
          anchor: a.anchor,
          end: a.end,
          observations,
          pitches: Object.freeze([...new Set(observations.map((o) => o.pitch))].sort()),
          confidence: Math.min(...observations.map((o) => o.confidence)),
          lockWallMs: a.lockWallMs,
          sealWallMs: p.wallMs,
          eligibleAfter: a.eligibleAfter,
          frontier: p.frontier,
          capturedThrough: this.physical
        });
        this.active = null;
        this.state = "ANALYZING";
        this.until = this.physical + this.analysisHold;
        this.actions.push({ type: "SEAL", wallMs: p.wallMs, sourceSample: this.physical, attempt: this.pending });
        if (!this.analysisHold) this.finishAnalysis(p.wallMs);
      }
    }
    this.receipts.push(Object.freeze({
      publicationId: p.publicationId,
      state: before,
      opened,
      late: p.late === true,
      eligibleAfter: this.eligible,
      capturedThrough: this.physical,
      observationIds: Object.freeze(p.observations.map((o) => o.observationId))
    }));
  }
  snapshot() {
    return { state: this.state, eligibleAfter: this.eligible, capturedThrough: this.physical, activeId: this.active?.id ?? null, pendingId: this.pending?.id ?? null };
  }
};

// backend/research/robust_threshold_v21/domain.ts
var pitch = (n) => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12] + (Math.floor(n / 12) - 1);
function runtime(targets, domainId) {
  const artifact = {
    schemaVersion: 1,
    scoreId: "frozen-v6",
    revisionId: "v6",
    artifactId: "v21-target-view",
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
    practiceAttackSteps: targets.map((set, i) => ({
      stepId: `s${i}`,
      onsetBeat: i,
      attackTargets: set.map((n) => ({ pitch: pitch(n) })),
      continuation: []
    }))
  };
  const clock = new ManualClock(), owner = new StepPracticeRuntime({
    artifact,
    scope: { kind: "FULL" },
    inputSource: "MICROPHONE",
    localSessionId: domainId,
    clock,
    metadataClock: { nowEpochMs: () => 0 }
  });
  return { owner, clock, time: (ms) => ({ domainId, ms }) };
}
export {
  GESTURE_WIDTH_MS,
  WaitingTopologyGate,
  pitch,
  runtime
};
