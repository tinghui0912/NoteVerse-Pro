# Capture transport stability: NOT ESTABLISHED

Disposition: `PRACTICE_SHARED_ACOUSTIC_CAPTURE_TRANSPORT_STABILITY_NOT_ESTABLISHED`.

No production repair or acceptance freeze was made. Product source under
`apps/customer-web/src`, `apps/customer-web/public`, and `backend/app` is unchanged
from starting HEAD `b3468c3938d0074163605360f84bb47af3eb899d`.
This is a blocked diagnostic result, not a successful capture promotion.

## Prospective execution chain

1. `056f312c`: bounded research instrumentation and fixed diagnostic matrix.
2. `b8e642b9a81db6fde7c3ee8dad1e18b6f2d24a26`: diagnostic v1 freeze, SHA256
   `1cd9711fbe6ee7c3395a227aa722acd3df2d66b0245c1d504276f4d6c58493d9`.
3. Execute v1 static verification, stress and canonical Continuous engineering.
4. `00076db9`: preserve v1 evidence, add process-call metadata and fixed 500ms
   pre-capture preparation to distinguish startup from steady-state stress.
5. `eca53e21dc1c5481486455cb66db69e6492f5262`: diagnostic v2 freeze, SHA256
   `766d1521051c3860dee3cb39dcd14b94b554327c53c0bec3241dbb85cde2d9e7`.
6. Execute v2 fixed diagnostic matrix once and static verification. No source
   edits after execution; evidence/receipt commits follow separately.

Each JSON execution artifact stores its own freezeCommit, remoteHead,
freezeSha256, remoteVerifiedAt and executionStartedAt. Remote proof precedes
execution; it is not replaced with a later final-report remote check.
The follow-up is a new diagnostic experiment with an explicit startup hypothesis,
not a retry of failed acceptance cells. V1 failures remain intact.

## Established credit-exhaustion mechanism

The production path is Worklet PCM postMessage -> BrowserAcousticCapture callback
-> synchronous ContinuousCaptureBridge.receive -> SourceChronology -> synchronous
source adapter/ring/window planner -> ACK postMessage. Sequential neural work
runs in a separate Worker and ACK does not await neural completion.

Actual transport blocks are 128 source samples. At 44100/48000Hz this is
344.53125/375 PCM messages and ACKs per second. The unchanged 32-credit guard
therefore covers only 92.8798186/85.3333333ms of unacknowledged source audio.

In the canonical run, 44100 all four cells passed. 48000 natural passed, then
count-in/multiple-pause/manual-stop failed with the same credit code. The
instrumented Worklet shows nextAck frozen at 1103, sequence rising to 1135,
32 unacknowledged contiguous chunks, then fail-closed at frame145280.
Main-thread message arrival gap was 1244.1399999856949ms. Maximum whole capture
callback (including receive and ACK) was only 1.2000000476837158ms. Chronology
failures=0, ACK order violations=0. AudioContext remained running, root track live.
One inference was outstanding, no publication had returned. Exact run count is
unknown: 11 completed model runs are confirmed, plus an unresolved request.

The v2 trivial bounded consumer reproduces overflow under a fixed 100ms stall
at BOTH source rates. Peak=32; callback maxima approximately0.265/0.285ms;
arrival gaps100.735/100.505ms. Both 50ms cells pass with peak20/21.
This isolates credit fragility from model inference and synchronous FIR work.
No ACK reordering, message loss recovery, PCM queue or credit-limit change exists.

The immediate causal chain is established: render-quantum messages consume the
credit budget while delivery/ACK scheduling is unavailable. The browser/OS/native
cause of the canonical 1.24s scheduling gap remains UNRESOLVED. No long-task
entries were reported; that is not proof of no native/browser starvation.
Worker INFER overlaps the gap, but temporal overlap is not proof that inference
caused it. Harness console serialization/offline/polling causality is not proven.
The failed v1 phase's explicit user pause remains historically separate from
analysis ownership. This phase does not reinterpret it as inference pausing transport.

## Independent callback discontinuity blocker

The transport-only diagnostic also exposes nonconsecutive actual Worklet process
calls during graph startup. Example, v2 44100/0ms:

```
first process:  frame23936, channels2, samples128, source[0,128)
second process: frame24448, channels2, samples128, source[512,640)
```

The process-call metadata contains only those two calls, not intervening empty
input callbacks. No main-thread message was dropped or sequence skipped:
sequence0 then1 arrived, and strict SourceChronology rejected the source gap.
This happens BEFORE the declared stress stall. Fixed pre-capture preparation
does not reliably eliminate it, so the initial startup hypothesis is NOT proven.
We do not label the root cause a production Worklet bug or a harness bug without
further browser graph/render lifecycle evidence.

V2 matrix (one execution/cell, no rerun-until-pass):

| Rate | 0ms | 50ms | 100ms | 250ms |
| --- | --- | --- | --- | --- |
| 44100 | startup chronology failure | PASS | credit overflow | startup chronology failure |
| 48000 | PASS | PASS | credit overflow | startup chronology failure |

These are DIAGNOSTIC outcomes, not an accepted supported stress envelope.
The 250ms stress was not meaningfully reached in its failed capture cells.

## Why no speculative repair was promoted

Batching can increase credit coverage without increasing the ceiling. However,
1024-sample blocks cover only about0.683s at48000, less than the observed1.244s
gap. Even a larger fixed block cannot reconstruct source frames for which the
Worklet callback never supplied PCM. A conforming aggregator must fail closed on
that discontinuity; filling zeros, deleting an early owned block, shifting origin,
or retrying until a clean run would not establish the required exact PCM parity.

We therefore did not choose a batching size based on a partial PASS, change ACK
ownership, or modify production while browser graph startup/scheduling attribution
remains unresolved. A clean accepted repair and exact source/model/Continuous
parity have NOT been established. No fallback or second capture path was added.

## Verification and unexecuted gates

See diagnostic-v1/verification.json and diagnostic-v2/verification.json for exact
test counts, individual lint messages, command exits, Docker output and proofs.
V1: 151 files /1131 Vitest passed/0 failed, tsc/build PASS, Node4 PASS,
Docker asset4 PASS/routes3 PASS. Original prefer-const warning and Docker pytest
asyncio_mode warning are disclosed, not suppressed.

Continuous diagnostic engineering is PARTIAL_EXECUTION_BLOCKED:5 cells PASS,
1 FAILED,2 NOT_STARTED. No accepted8/8 result is claimed. Musical8/controller
replay/model-input SHA parity/final semantic parity are NOT_EXECUTED for acceptance.
No repaired production implementation exists to qualify. No old PASS is inherited.
All transport-only cells use zero neural runs. No STEP acoustic/model execution
occurred. Neural accounting is11 confirmed runs, unresolved pending request,
modelRunCountComplete=false. Loading/graph compilation/DSP are not neural runs.

## Frozen identities and resource state

The one active model remains practice-acoustic-robust-browser@v1,
98689283 bytes, SHA256
4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3.
ORT1.20.1/WebGPU/automaticFallback=false, decoder.30/.05,
owned/past/future600/1050/170ms unchanged. Adapter identities remain
32e39d991c47f5dbe1f13d2f77cf2a652d6a5da34cb5051ff43c0155b91edca5
(44100) and
6003b89c69965259baf9b329be6faec19128e6e5743be952c23069fb8673da17 (48000).

32 credits, max source block2048, target ring65536 float32,4 outstanding model
windows,32 compact runtime diagnostics and8 Continuous boundaries remain unchanged.
Actual128-sample transport outstanding PCM ceiling=16384 bytes. Policy's maximum
possible transport PCM=262144 bytes. No batching accumulator was introduced.
Product compact diagnostic planning estimate remains32*512=16384 bytes.
Research-only rings:256 main rows,64 Worklet send rows,64 process rows,
32 Worker rows,32 long-task rows; metadata only, never PCM. Object overhead and
JS/ORT/GPU total heap are not claimed to have a measured exact bound.

secondActiveAcousticPath=false; compatibilityLayer=false; fallbackPath=false.
Exactly one product capture Worklet, capture class and ONNX model implementation
remain. Research wrappers call the exact product class and strip metadata before
product validation; contract tests check identical original fields and PCM.

STEP source/behavior unchanged. H=50ms, NOT_QUALIFIED, fresh-strike candidate=none.
Continuous=MODEL_NOT_VALIDATED; STEP=ATTEMPT_ANALYZER_NOT_VALIDATED;
productionMicrophone=false; D4=false. No hardware/device/commercial/acoustic-science
claim. Previous blocked reports/f1/f2 invalidations are untouched.

GitHub receipt is stored separately. Local verification is not CI PASS.
No STEP V4 execution or controller/microphone integration may proceed from this
blocked result. Stop at this diagnostic boundary.
