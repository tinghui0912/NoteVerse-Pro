// apps/customer-web/src/lib/practice/local-core/timebase.ts
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
export {
  STEP_ACOUSTIC_GESTURE_MS,
  StepAcousticAttemptAssembler
};
