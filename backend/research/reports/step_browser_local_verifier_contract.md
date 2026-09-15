# STEP Browser-Local Verifier Contract

Status: architecture spike, no production model integration.

## Current Runtime Paths

Customer-web microphone capture currently starts in
`apps/customer-web/src/hooks/practice/use-practice-audio-stream.ts`. The browser
uses `getUserMedia`, an `AudioContext`, and the
`practice-pcm-processor` AudioWorklet at
`apps/customer-web/public/audio-worklets/practice-pcm-processor.js`. The
worklet batches 2048 input samples and posts `Float32Array` frames back to the
main thread.

PCM conversion and transport live in
`apps/customer-web/src/lib/practice/audio-stream.ts`: browser audio is
downsampled to 16 kHz mono, encoded as little-endian `pcm_s16le`, and sent as
binary WebSocket frames through
`apps/customer-web/src/hooks/practice/use-practice-socket.ts`.

The backend practice WebSocket endpoint is
`backend/app/modules/practice/router.py`. JSON control messages are validated by
`backend/app/processing/realtime/protocol.py` and serialized by
`backend/app/processing/realtime/message_codec.py`. Binary PCM frames continue to
flow through `PracticeSessionRuntime.process_audio_chunk` for `SERVER`
microphone sessions; `BROWSER_LOCAL` STEP sessions ignore unexpected binary PCM.

STEP runtime construction is owned by
`backend/app/processing/realtime/session_runtime.py`. `STEP_BY_STEP` microphone
sessions use `StepPracticeEngine`; MIDI STEP uses `MidiPracticeEngine`; fixed
clock performance remains independent.

`StepPracticeEngine` owns the current `PracticeAttackStep`, creates
`StepVerifierTarget`, validates `StepVerifierObservation`, constructs
authoritative MATCH evaluations, and advances through
`WaitForNoteFollowPolicy`. It does not import or construct Matchmaker.

## Deployment Meanings

Local inference means microphone audio and neural inference stay in the browser,
while the backend remains authoritative for the practice session, current target,
progression, Skip, reset, and lifecycle.

Fully offline practice means the complete STEP session and progression path can
operate without backend connectivity. This change does not implement fully
offline practice.

## Browser-Local Contract

The backend publishes a `step.verifier_target` message containing:

- `step_id`
- `activation_generation`
- `attack_pitches`
- `continuation_pitches`

The browser verifier sends `client.step_verifier_observation` with:

- `step_id`
- `activation_generation`
- `observed_attack_pitches`
- `confidence`

The backend accepts an observation only when:

- the `step_id` matches the current `PracticeAttackStep`
- the `activation_generation` matches the current activation generation
- the observed attack pitch set exactly equals the current physical attack
  target set

Accepted observations are authoritative acoustic evidence and produce MATCH
directly. They are not sent back through the legacy expected-event evaluator.

After MATCH, Skip, or reset, `StepPracticeEngine` increments the activation
generation. That makes late browser observations from the previous target stale
even if their `step_id` is accidentally reused or their pitch set happens to
match.

Only one acoustic verification provider is allowed for a STEP microphone
session. Browser-local sessions do not instantiate a backend
`StepMicrophoneVerifier`; server-verifier sessions do not accept browser
observations. There is no per-chunk fallback from WAIT to Matchmaker or another
verifier.

## Runtime Boundary

`PracticeSessionRuntimeRegistry` requires an explicit STEP microphone verifier
provider and fails fast if none is configured. Production session creation now
persists that provider decision before stream runtime construction.

`PracticeSession.step_microphone_verification_provider` is the immutable
session-level provider decision for STEP microphone sessions. Session creation
defaults STEP microphone sessions to `SERVER`; `BROWSER_LOCAL` is accepted only
when the request also declares `STEP_MICROPHONE_VERIFIER_V1` browser capability.
MIDI STEP and fixed-clock performance sessions cannot carry a STEP microphone
verifier provider. `PracticeService.prepare_stream_runtime` passes the persisted
provider to `PracticeSessionRuntimeRegistry`, so the provider is selected before
the runtime exists and cannot change per frame or per observation.

`step.verifier_target` remains a protocol-version-1 extension. Compatibility is
provided by provider gating rather than a version bump: only explicit
`BROWSER_LOCAL` sessions publish this message. Default `SERVER`, MIDI, and
fixed-clock performance sessions do not publish browser-local targets, so older
strict clients in the ordinary product flow never receive the new message.

In browser-local mode, raw PCM is not required by the backend for progression.
The intended browser contract is to keep microphone audio and neural inference
local, then send only target-conditioned verifier observations. As defense in
depth, the backend ignores unexpected binary PCM frames for `BROWSER_LOCAL` STEP
sessions; they are not appended to the runtime audio buffer and cannot produce
MATCH. `SERVER` microphone sessions keep the existing binary PCM transport.

## Remaining Browser WebGPU Blockers

- Implement a browser verifier that consumes the published target and runs the
  actual model locally.
- Decide model packaging, preload, warm-up, cache, and version checks before
  shipping the large model.
- Include model/provider identity in session/provider negotiation if multiple
  verifier deployments are supported.
- Define client-side failure behavior for missing WebGPU or model-load failure;
  provider selection must happen at session creation, not as per-chunk fallback.
- Keep raw MIDI ground truth out of browser verifier inputs.

No ByteDance checkpoint, ONNX graph, WebGPU runtime, or production backend model
loading is wired by this spike.
