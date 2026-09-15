# Offline-First Local Practice Core

This module is the browser-local practice foundation. It is intentionally pure
domain code: no React, REST, WebSocket, IndexedDB, AudioContext, AudioWorklet,
WebGPU, ONNX Runtime, or model assets.

## PracticeScoreArtifact

`PracticeScoreArtifact` is the versioned browser-consumable score domain
boundary. It is produced from the canonical backend score pipeline and consumed
by both local runtimes. The artifact is deterministic for a score revision and
contains:

- score, revision, and artifact identity
- playable note events
- legacy expected practice groups
- physical attack steps and continuation metadata
- render note, measure, staff, and voice identities for UI correlation
- meter and tempo segments
- first playable position, score end, and schema version

The browser must not build a second independent MusicXML parser for active
practice execution.

## Shared Core

Shared local concepts live here:

- `PracticeScope` and scope resolution
- local session snapshots and persistence interfaces
- deterministic clocks and capture-relative evidence time
- normalized acoustic and MIDI evidence contracts
- shared runtime/schema version identity

React may orchestrate these objects and render their snapshots, but it must not
own progression rules.

## STEP_BY_STEP Runtime

`StepPracticeRuntime` owns correctness-driven STEP behavior locally:

- current expected group and `PracticeAttackStep`
- `StepVerifierTarget` construction
- activation generation for late asynchronous inference safety
- verifier observation validation
- WaitForNote MATCH/WAIT semantics
- Skip, reset, scope completion, and attempt history

Only a current-step observation with the current activation generation and the
complete physical attack pitch set may produce MATCH. Wrong, partial, stale,
missing, continuation-only, or unrelated evidence waits. MATCH and Skip advance
exactly once and invalidate previous asynchronous evidence.

## CONTINUOUS_PLAY Runtime

`PerformancePracticeRuntime` owns clock-driven performance behavior locally:

- resolved performance scope
- tempo timeline and speed ratio
- count-in, start, pause, resume, and end state
- local musical position from an injected monotonic clock
- capture-aligned evidence evaluation records

Acoustic or MIDI evidence never starts, stops, accelerates, or delays the
performance clock. Evidence is downstream evaluation only.

## Evidence and Timebase

Inference completion time is never treated as attack time. Evidence carries
capture-relative timing so delayed model output can still be mapped back to the
audio or MIDI capture timeline.

The future shared microphone path is:

`AudioWorklet -> captured frames -> local inference worker -> normalized note evidence`

Mode adapters then consume the same normalized evidence:

- STEP adapter: target-conditioned `StepVerifierObservation`
- CONTINUOUS adapter: performance observations for evaluation

The real ByteDance/WebGPU model is not integrated here.

## Local Sessions

`LocalPracticeSessionSnapshot` is the offline-first session boundary. It stores
the local session id, score/revision identity, mode, input source, scope,
runtime/schema version, lifecycle state, mode-specific runtime snapshot, and
history required for product behavior.

`LocalPracticeSessionStore` keeps persistence outside runtime logic. The current
implementation includes an in-memory store for deterministic domain tests.

## Legacy Replacement Targets

Backend active practice execution, Practice WebSocket progression, server-side
STEP verifier provider negotiation, Matchmaker-era realtime alignment, and
backend performance runtime are legacy replacement targets. They may remain
temporarily while the browser-local foundation is proven, but they are not the
target architecture for active practice execution.
