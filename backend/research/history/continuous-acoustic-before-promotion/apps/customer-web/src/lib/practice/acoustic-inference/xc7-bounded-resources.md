# XC7 Disabled Resource Policy

This is not production enablement or a change to the XC4 acoustic identity. The
XC6 bridge explicitly requests `XC7_BOUNDED`; generic `PerformancePcmTimeline`
and its extraction/default retention behavior are unchanged. Historical direct
XC5 runtime callers retain their explicit old mode; new capture uses the bounded
mode. There is one acoustic segment per runtime instance. Its ledger retains
only scalar source/performance/tail boundaries, no Float32 payload or extraction
API. Target context remains in the existing 65536-sample ring.

`MAX_OUTSTANDING_ACOUSTIC_WINDOWS=4` includes active and waiting windows. It is
twice the maximum depth2 observed in the referenced finite R4/R1/XC6 sessions;
not an optimized parameter, UX SLO or acceptance of four-window user latency.
The fifth ready window fails before extracting its input. No skip, eviction,
merging, clock changes, backend execution or automatic provider fallback occurs.
Failure suppresses even a subsequently resolved active result and every pending
run. Drain/seal propagate the error. If cancellation is unavailable, disposal
waits for the active computation then releases the worker; it does not pretend
to cancel a hung device. Capture orchestration disconnects input/nodes and stops
tracks immediately through `onFailure`, even for asynchronous worker/sink errors.

Publications are delivered synchronously and exactly once to the optional
`onAcousticPublication` sink. A sink receives recursively immutable scalar/event
objects in window order, with original source coordinates and both identities.
Reentrant mutation, throwing sinks and promise-returning sinks explicitly fail
the session; there is no retry. A consumer that stores every publication is
responsible for its own memory; the runtime stores only its last32 publications
and32 timings, plus scalar totals.32 windows represent19.2seconds of diagnostics,
not a finalization width or SLO. Uniqueness checks use a per-window set (window IDs
are strictly increasing), not an ever-growing session set. Worker output has a
conservative shape-derived maximum183*88 events/window and bounded pitch labels.

The XC7 worklet additionally allows only32 unacknowledged transferred PCM blocks
of at most2048 samples each (normal browser quantum128). ACKs are strictly
ordered. Overflow explicitly fails capture instead of leaving an unbounded
MessagePort PCM queue. Mixing, real-source sample coordinates and sampling rate
are identical to XC6. Capture histograms have at most32 keys plus OTHER; context
transition diagnostics retain32 bounded labels. No microphone PCM is persisted.

## Typed PCM Storage Bounds

- Session timeline:0 PCM bytes, one metadata segment (44.1k and48k alike).
- Target ring:65536*4=262144 bytes.
- FIR source ring:128*4=512 bytes at either source rate.
- Main outstanding inputs:at most4*29120*4=465920 bytes, active included.
- Worker transport input clone:one116480-byte input. Provider preparation may
  clone one additional116480-byte input; ORT CPU/GPU staging is implementation-
  dependent fixed-shape memory, not a claimed total browser heap upper bound.
- Worklet in-transit PCM:at most32*2048*4=262144 bytes (16384 bytes at128quantum),
  plus at most one currently handled block8192bytes. The incoming buffer is not
  retained by the bridge. An adapter push has at most2048source samples and an
  output bounded by2048target samples (conservative); the core feeds<=2048 slices.
- Immutable coefficient data:44.1k core retains35284coefficient bytes plus35284
  identity-option bytes;48k adapter retains244coefficient bytes. They are constant.
- Core per-window PCM/ring/transport subtotal:262144+512+465920+2*116480=961536
  bytes, excluding capture buffers, coefficients, transient filter output,
  model weights, tensors, GPU/session/OPFS caches and JavaScript metadata.

Diagnostic objects are finite, not exact byte-addressable JS heap allocations:
at most32*16104=515328 recent observations,32 publication/window records and32
timing records. A deliberately conservative1KiB/event planning estimate is
527695872bytes plus object headers/arrays/strings/timings; actual publication
counts are normally much smaller. This is not a measured heap ceiling. Snapshots
are caller-owned copies and are not retained by the runtime. Temporary projection
and a current callback may coexist with the ring; all are fixed-size. Improving
this conservative diagnostic bound can be a separate engineering decision, not
a claim of product memory readiness. No privacy-policy conclusion is implied.

Acoustic model, decoderA thresholds.30/.05, FIR math/coefficients, ORT1.20.1,
WebGPU-only policy,600/170 half-open geometry and all historical science remain
unchanged. Product capability remains MODEL_NOT_VALIDATED; R2 is not connected.
