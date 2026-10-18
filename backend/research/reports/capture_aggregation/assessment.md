# Bounded aggregation repair: Continuous parity reestablished

Disposition:
`PRACTICE_SHARED_ACOUSTIC_CAPTURE_TRANSPORT_STABILITY_REPAIRED_CONTINUOUS_PARITY_REESTABLISHED`.

Starting remote/local HEAD was freshly fetched and matched exactly
`15b8f0da94555af91c7d88eb28f151f566e75ff5` before modifications.

## Commit and freeze discipline

- Production/tooling: `64f5d20b3f41013c1ef377c488ab30ffbbd10b37`.
- Archive byte preservation: `4f1f7ac38c49aab77bf93101550cae7ff1679ee1`.
- v1 freeze: `5b13887c3904d87e3387799f63e56197fa2bd6b3`, explicitly INVALIDATED.
- Test-time-bound correction/invalidation: `bc9a463fc66e876d09648fb16de09666a97f7090`.
- Accepted v2 freeze: `a399051d4007b57144e0d06b0606df7c53f770a7`.
- Accepted freeze SHA256:
  `3f24728b4043be0eecba4ddc3774d1ff89fc5d068bf1a44bb09324106941326f`.

Every execution JSON stores its own exact remote freeze verification timestamp
before executionStartedAt. See accepted-v2/verification.json, transport-stress.json,
cold-start.json, browser.json, musical.json, parity.json and source-parity/.
Evidence/receipt-only commits follow; final remote HEAD is separately queried.
The full chain and pre-execution proofs are in final.json and github-receipt.json.

v1 completed static execution with1148 passed/2 failed (both heavy parity tasks
exceeding the default approximately5s task bound under full-suite concurrency).
Their later equality receipts were not accepted over the failed runner result.
Only the test execution bound changed to30000ms. All exact assertions and all
production bytes were retained. New freeze/full static rerun; v1 browser/neural=0.
No failed browser cell was retried and no model/candidate was tuned.

## One authoritative transport

The only active Worklet aggregates exactly2048 real mono source samples into
one transferable block. Input render quantum length is read at runtime; mixed
legal lengths including non-divisors are unit-tested. No resampling or recovery
padding exists. Channel averaging and Float32 sample values remain identical.

STABILIZING retains only one unpublished partial accumulator. An initial frame
gap retires only that provisional prefix and starts a new contiguous prefix.
The first complete block fixes origin and source sample0 and enters ACTIVE.
ACTIVE never resets chronology: gaps, invalid geometry/rate/message/ACK fail closed.
STOP discards an incomplete buffer without flushing or synthesizing samples.

BrowserAcousticCapture.connect resolves only after the first authoritative block
passes the synchronous consumer and its ACK is posted. Graph connection alone
is not readiness. Failure/cancellation/10s preparation timeout reject readiness
and clean resources. The borrowed session AudioContext is never closed by capture.
Transport-ready remains separate from the existing real acoustic preroll.
Consumer failure or a Promise-returning consumer cannot receive an early ACK.

Only production capture.ts, capture.worklet.js and the new transport contract
changed. SourceChronology, source adapters/FIR, source runtime/window planner,
Continuous controller/clock/projection/finalizer, STEP and MIDI source are unchanged.
Tests/tooling changed separately. The previous Worklet is byte-archived under
backend/research/history/capture-transport-128-quantum with source revision,
Git blob, bytes and SHA256; only test tooling reads it. No product import reaches it.

## Resource bounds

2048 samples/block;32 credits;262144 bytes maximum outstanding transport PCM;
8192 bytes separate Worklet accumulator. The target ring remains65536 float32,
outstanding model windows4, compact diagnostics32, Continuous boundaries8.
No full-session production PCM or second PCM queue exists. These are PCM/planning
bounds, not measured total JS/ORT/GPU heap bounds.

compatibilityLayer=false; fallbackPath=false; secondCapturePath=false;
zeroFillRecovery=false; postActiveChronologyReset=false.
One product Worklet, capture class, source chronology and model implementation remain.

## Frozen transport and cold-start gates

Exact production capture/bridge/chronology plus a bounded synchronous no-neural
sink ran in headed branded Chrome155.0.8059.39, both44100 and48000Hz.
All0/50/100/250/1000ms cells passed ACTIVE, once each. Peak credits at1000ms
were21/23. Zero chronology, sequence, ACK-order or payload-checksum violations.
The two1700ms cells deliberately fail closed at32 credits with
ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED. No silent loss or recovery occurs.
1700ms was frozen because it exceeds even worst-phase33-block emission at44100;
a borderline1500ms would not guarantee this at that rate.

Ten independent fresh Chrome/page/AudioContext cold starts passed (five/rate).
Two actual pre-ACTIVE discontinuities occurred, one/rate; each caused exactly one
provisional stabilization restart. Post-ACTIVE discontinuities=0. Every first
authoritative source sample=0. Time to ready measured65.525-77.820ms in these
trials, not a promised SLO. Raw process/frame witnesses and all trial states persist.

## Exact PCM, windows and Continuous parity

The frozen musical PCM prefix at each rate is processed through archived128
transport and current2048 transport. Concatenated source bytes/SHA256, first/last
coverage, source count and every model-window start/end/Float32 input SHA256 match.
Four model input windows/rate are audited, including BEGIN/PAUSE/resume/TERMINAL
strictly inside2048 blocks. Boundaries apply at exact source coordinates, never
quantized to transport blocks. The same publications and exact terminal-T result
follow. This uses deterministic fake inference solely to audit PCM/input semantics.

The independent real Worker/WebGPU suites all passed under the accepted freeze:
Continuous engineering8/8 (18 actual runs), musical replay8/8 (66 actual runs),
production-controller replay PASS (10 actual runs). Total94, complete accounting.
Transport stress/cold/unit DSP checks count0 neural runs. Invalidated v1 counts0.

Musical parity against the accepted baseline has diffs=[]. Publication ordering,
IDs, observation IDs/pitch/confidence/performance time/provenance, coverage,
ownership, verdicts and exact terminal frontier agree. Product counterfactual
scenarios through the unique existing evaluator also agree. Only existing
nonsemantic availabilityTimeMs/finalizedAtMs/finalizationTimeMs are excluded.
Live controller UUIDs/wall-clock schedules are independent session executions,
not falsely compared as byte-identical session IDs across runs.

Clock/recording/resource cleanup and expected analysis-only failure isolation
passed. Real fake-media acquisition is used in engineering, offline after assets.
Musical runtime replay and the existing injected controller replay retain their
previous distinct roles; they are not called physical microphone evidence.

## Availability and finalization measurements

Capture block fill is46.4399093ms/42.6666667ms at44100/48000. Compared with128
samples the theoretical maximum block-fill addition is43.53741497ms/40ms.
This delay is never added to event timestamps. In normal engineering cells,
maximum arrival-after-block-end graph-time proxy was8.707483ms/8ms;
maximum full receive callbacks3.805ms/4.195ms; ACK-after-arrival maxima3.985ms/4.245ms.
Stress deliberately increases delivery latency:1000ms cells reach approximately
960.726ms/968ms arrival-after-block-end while preserving source identity.
These same-AudioContext graph deltas are not physical hardware input latency.

Normal terminal finalization durations (FINALIZING -> COMPLETE, including real
tail/inference/cleanup) were339.155-457.345ms across the six normal engineering
cells. Expected analysis-failure cells measured1.31/4.48ms with evaluation UNAVAILABLE.
There is no equivalent historical lifecycle timing instrument to isolate a causal
end-to-end terminal delta; the fill contribution and current total are reported
separately, not mislabeled as a measured performance improvement.

Backpressured musical replay availability changes are fully retained in parity.json.
Across74 publications, current-minus-baseline processing availability delta ranges
-1985.280 to-369.220ms (median-1021.950ms). Current event-to-availability across230
observations: median1684.047ms, p952304.119ms, maximum2499.312ms.
This is offline backpressured processing timing with different execution/cache
conditions, not causal live batching latency, physical latency, or a UX SLO claim.

## Static verification and warnings

Accepted v2:154 Vitest files,1150 tests passed,0 failed. Focused transport/domain/
architecture/parity tests are included. Node research/accounting4 passed.
TypeScript noEmit and Next webpack production build PASS. Docker asset unittest4
and route tests3 PASS. ESLint errors0/warnings1; full messages are preserved:
scripts/step-boundary/prepare-tooling.mjs:3:6, prefer-const, severity1,
"'text' is never reassigned. Use 'const' instead."
Docker route output retains PytestConfigWarning: Unknown config option: asyncio_mode.
Existing jsdom navigation/media not-implemented stderr is retained in vitest.stderr.txt.
No warning is hidden or represented as a zero-message result.

## Identity and limits of this result

Model practice-acoustic-robust-browser@v1 remains98689283 bytes, SHA256
4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3;
ORT1.20.1/WebGPU/automaticFallback=false; decoder.30/.05;
16k mono29120 input, owned/past/future600/1050/170ms.
Qualified FIR identities remain
32e39d991c47f5dbe1f13d2f77cf2a652d6a5da34cb5051ff43c0155b91edca5
and6003b89c69965259baf9b329be6faec19128e6e5743be952c23069fb8673da17.

No acoustic science, STEP H tuning or fresh-strike work occurred. Previous blocked
diagnostic/STEP evidence remains historical and untouched. STEP was not executed.
H=50ms candidate, NOT_QUALIFIED. Continuous=MODEL_NOT_VALIDATED;
STEP=ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.
No real-device, physical latency, commercial or microphone enablement claim.
Finite stress/cold trials do not promise survival of arbitrary OS stalls or future
post-ACTIVE device gaps; those remain explicit fail-closed conditions.

GitHub truth is queried after evidence push and again at final receipt HEAD.
Local qualification is not CI PASS. Stop here; no STEP qualification/integration.
