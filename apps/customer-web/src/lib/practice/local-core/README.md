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
- expected practice groups
- canonical expected notes and physical strike targets
- physical attack steps and continuation metadata
- canonical expected-group sounding end beats for tied scope terminals
- render note, measure, staff, and voice identities for UI correlation
- meter segments with count-in duration/pulse metadata and tempo segments
- first playable position, score end, and schema version

The browser must not build a second independent MusicXML parser for active
practice execution. The canonical producer is
`backend/app/processing/practice_score/practice_score_artifact.py`; browser
tests consume the checked JSON fixture it produces.

## Shared Core

Shared local concepts live here:

- `PracticeScope` and scope resolution
- local session snapshots used for explicit runtime restore
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
complete physical attack pitch set may produce MATCH. The observation must also
carry a fresh attack onset after the current activation boundary; stale onset or
sustain residue from a previous STEP cannot satisfy a repeated-pitch STEP.
Wrong, partial, stale, missing, continuation-only, or unrelated evidence waits.
MATCH and Skip advance exactly once and invalidate previous asynchronous
evidence.

## CONTINUOUS_PLAY Runtime

Continuous is a clock-driven performance mode, not score following. The
expected timeline is fully determined by the score artifact, resolved scope,
and resolved tempo plan before the performance begins.

`PerformanceClockRuntime` owns only transport behavior:

- resolved performance scope and tempo timeline
- meter-derived count-in
- start, pause, resume, and end state
- exact clock segments and terminal boundaries
- local musical position from an injected monotonic clock
- capture/session time to performance time mapping

MIDI and acoustic evidence never starts, stops, accelerates, delays, or
relocates the performance clock. Evidence is downstream evaluation only.

`ContinuousEvaluationSession` owns the expected strikes, observed attacks,
analysis frontier, and reconciled strike/extra verdicts. `ContinuousPracticeSession`
composes the clock and evaluator for the application layer. MIDI Continuous uses
this path today; future microphone Continuous must also publish observed attacks
into the same evaluator instead of creating a second evaluation architecture.

## Evidence and Timebase

Inference completion time is never treated as attack time. Evidence carries
capture-relative timing so delayed model output can still be mapped back to the
audio or MIDI capture timeline.

The future shared microphone path is:

`AudioWorklet -> captured frames -> local inference worker -> normalized note evidence`

Mode adapters then consume the same normalized evidence:

- STEP adapter: target-conditioned `StepVerifierObservation`
- CONTINUOUS adapter: timestamped observed attacks for reconciliation

Continuous microphone analysis is intentionally unavailable until a model
contract and runtime throughput gate are validated.

## Local Sessions

`LocalPracticeSessionSnapshot` is the explicit runtime restore boundary. It
stores the local session id, score/revision identity, mode, input source, scope,
runtime/schema version, lifecycle state, mode-specific runtime snapshot, and
history required for product behavior. Restore operations validate
score/revision/artifact identity, runtime/schema version, input source, and
scope. Performance restores use logical runtime position and resume interrupted
active sessions as paused, so a new browser monotonic clock origin cannot
silently advance musical time.

Snapshots are runtime values. They are created and consumed by the local
runtime/controller; this module does not define a persistence store or a
server execution protocol.
