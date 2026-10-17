# AudioContext Render-Timeline Qualification

Qualification tooling only. No controller, hook, capability, STEP, finalizer, DSP,
decoder, or inference implementation changes are part of this protocol.

The failed output-timestamp protocol remains immutable historical evidence. Its
source, test and failed entry are archived byte-for-byte outside product source.
The old runner is historical tooling, not an executable fallback for this gate.

Sequence:

1. Commit implementation/tooling and exact v1 archive.
2. `node scripts/audio-context-clock/protocol.mjs freeze`; commit and push freeze.
3. `node scripts/audio-context-clock/protocol.mjs verify` independently checks remote.
4. `node scripts/audio-context-clock/verify.mjs` runs all pre-browser verification.
5. `node scripts/audio-context-clock/browser.mjs` runs Gate 1, then only on pass Gate 2.
6. `node scripts/audio-context-clock/report.mjs evidence`; commit/push evidence.
7. `node scripts/audio-context-clock/report.mjs github`; commit/push API receipt.

Gate 1 executes the existing formal entry against the CURRENT model-neutral
inference implementation, real Worker and exact ONNX, offline after assets ready.
The existing exact ORT diagnostic classifier is reused without relaxation.

Gate 2 uses a fake empty inference port and actual capture/Worklet/runtime/clock.
Every transition uses one currentTime read, held for the synchronous transaction.
Only that context's render time is used. Source index is round(C * rate) - origin.
Public boundary methods are instrumented in the harness to record exact application;
the underlying methods are unchanged. Closed segments retain the existing <=1 source
sample assertion. A failure stops the protocol without trying another mapper.

A and B register live transitions. C registers a future natural scope terminal
using a synthetic 600ms scope, then lets the unmodified clock reach it naturally.
D injects analysis failure and witnesses the independently owned AudioContext and
PerformanceClock continuing. Metronome scheduling is non-audible and uses the same
injected context. No physical input/output latency or UX qualification is claimed.
