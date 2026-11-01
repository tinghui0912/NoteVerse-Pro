# Practice Failure Boundaries

## Causal Facts

`failure/causal-failure.ts` defines the browser-independent `PracticeCausalFailure`
union. Each category has a closed code union; `kind` and `code` carry semantics,
while `cause` retains diagnostic context.

| Category | Causal responsibility |
| --- | --- |
| DeviceFailure | Microphone/camera acquisition, permission and physical source loss |
| MidiFailure | MIDI support, permission, access and connected-input admission |
| AudioContextFailure | Context construction, resume and interrupted/closed pipeline state |
| CaptureFailure | Capture connection, worklet transport, source mapping and cleanup |
| AcousticFailure | Qualified source rate, asset/identity, WebGPU and model preparation |
| InferenceFailure | Worker protocol, crash, timeout, backpressure and live inference execution |
| RecordingFailure | Recorder preparation/action failures |
| SourceFailure | Invalid score/source contract or source transport/load failure |

Browser adapters interpret native exception names where they call browser APIs.
`failure/browser-failures.ts` provides shared normalization for media, MIDI,
AudioContext and recorder boundaries. Acoustic adapters project closed
`AcousticAnalysisError` codes into causal facts. Worker RPC validates untrusted
error codes; unknown payloads produce a protocol failure. Diagnostic text supplies
no causal meaning. Typed facts pass through boundaries without being reinterpreted.

Domain invariant errors retain their domain owners. An unexpected invariant reaching
an application boundary fails closed with a stable generic mode error and keeps its
original cause for diagnostics. It never becomes a recoverable device incident.

## Mode Consequences

`projectStepFailure` and `projectContinuousFailure` are pure mode policies over typed
causes and PREPARING/ACTIVE phase. The causal layer imports neither mode.

STEP maps active inference failure to its terminal analysis intervention, and
microphone/context/capture infrastructure failure to its infrastructure intervention.
Preparation failures remain admission failures. The session, target and retirement
owners determine recovery and progression.

Continuous keeps startup failure, analysis intervention and resource intervention
separate. Analysis-only failure permits the existing explicit continuation without
analysis. Same-pipeline microphone/context interruption uses its recoverable resource
policy; hard source/capture loss requires restart. Recording runtime faults and
interruptions remain typed live value objects, with recording-only or input-required
impact determined by the mode's current resource bindings and intervention policy.

PracticeResourceBinding alone interprets retained physical-root health as HEALTHY, INTERRUPTED
or LOST. AudioContext, capture, worker and recorder pipeline facts have their own
owners; they do not change physical-root health. See
[session and resource planning](practice-session-planning.md#physical-root-health-and-pipeline-health).

Cleanup failure is an application consequence: `STEP_RESOURCE_CLEANUP_FAILED` or
`RESOURCE_CLEANUP_FAILED`. The execution owner retains that failure and blocks safe
replacement until its release contract is satisfied. Natural completion and stale
callback handling retain their lifecycle ownership.

## Source and Presentation

The revision-source query runs the canonical strict artifact parser once per response.
Invalid artifact, envelope identity or notation produces `SourceFailure.INVALID_SCORE`;
transport/service failure produces `SourceFailure.LOAD_FAILED`. The load failure retains
its transport cause for safe API error-code formatting and HTTP resource decisions.
Setup admits Source before acquiring live roots and validating those same objects.
Failed acquisition or validation closes the transaction binding and cannot commit
PreparedPractice. Source failure permits no acquisition or automatic navigation.
Physical binding health and acoustic engine lifecycle are independent: worker/capture/
context/recording faults never close the retained physical binding.

`PracticeExecutionView` is mode-discriminated and exposes closed STEP/Continuous
application codes. `PracticeStatus` maps those codes, capability facts and typed device
issues to localized copy. Raw exception text, browser URLs, worker payloads and model
paths remain diagnostic details, outside the public execution error contract.
