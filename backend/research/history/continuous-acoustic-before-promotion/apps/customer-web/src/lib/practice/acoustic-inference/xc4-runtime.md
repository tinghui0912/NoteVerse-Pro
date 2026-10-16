# Disabled XC4 Engineering Runtime

This is an internal acoustic integration, not microphone availability or product
qualification. Nothing is exported from the Practice entry point or connected to
ContinuousEvaluationSession. The capability remains MODEL_NOT_VALIDATED. Do not
attach R2 or any other unresolved finalizer to user-visible feedback.

The identity is robust-browser-engineering-default-xc4-v1, SHA256
93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443.
Construction recomputes its canonical JSON hash and checks literal runtime
parameters. The copied identity is generated from committed XC4, not recreated
from an independently editable approximation.

## Construction

Create/load an Xc4 engineering Worker, then call
Xc4RobustAcousticRuntime.create with engineeringOnly:true, a unique sessionId,
sourceSampleRateHz:44100, mode:CAPTURE, verified coefficient bytes, the Worker
port and a read-only performanceClock.nowMs callback. That clock is elapsed
monotonic time on the performance-origin domain, continuing during context tail,
not a stopped cursor or score position. No acoustic code sets/advances the clock.

The only16k route is explicitly ALREADY_16K_TEST_INJECTION. Other capture rates
fail SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED; there is no LINEAR fallback. No48k
filter or real-device qualification is included.

Append chronological half-open source blocks, preserving AudioWorklet indices.
Accumulate real pre-roll, await READY_FOR_PERFORMANCE, and supply the exact next
source boundary to startPerformance. This anchors performance0 externally.
At least1050ms of real resampled past is required. Additionally the first10 FIR
outputs touching its origin zero boundary are excluded from qualified inputs.
Subsequent model input endpoints are rounded on the persistent16k sample grid;
fractional44.1k source coordinates are retained exactly as rational provenance.

Stop at the exact next source boundary. TAIL_CAPTURE calls the existing
PerformancePcmTimeline.appendContextTail and never extends performance ownership.
Capture real170ms future plus FIR lookahead, then seal. A short terminal owned
region shifts its full1820ms input earlier. If a very short performance lacks
that extra real past, it fails closed rather than padding. No padded FIR finish
exists in this runtime. Queued windows are immutable copies; no reorder/drop.

resetPreRoll is only for unstarted capture. A completed/failed run requires
dispose and a fresh runtime/loaded Worker. Source PCM retention currently follows
PerformancePcmTimeline session retention; production privacy/memory policy is
still separate engineering work. Acoustic publications/diagnostics expose event
time and actual availability separately, never product verdicts.

## Do Not Restore the Historical Path

| Historical primitive | XC4 layer |
|---|---|
| future220ms | future170ms, past1050ms |
| decoder defaults0.2/0.2 | explicit0.30/0.05 |
| fixed anchor1600ms | ordered600ms half-open ownership |
| startup padding allowed | real pre-roll only |
| no frozen live band-limited path | persistent160/441 float32 FIR |
| legacy capture assumptions |44.1k capture or explicit16k injection only |

The historical decoder itself and model loader/session primitives are reused,
not silently edited. The old worker protocol is NOT used to decode XC4 results.
Model bytes/SHA, runtime version, provider, names, shapes and finite outputs fail
closed. There is no backend audio inference, score input, score-following or
automatic provider fallback. This is not D4, a production winner, a global
optimum claim or commercial qualification.
