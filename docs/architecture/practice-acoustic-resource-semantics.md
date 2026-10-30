# Acoustic Resource and Liveness Semantics

## Ownership and failure

Resource admission is fail closed. Accepted source chronology and evidence are
retained through their owners; bounded diagnostics are presentation data rather
than the evidence store. Resource budgets express current safety behavior without
claiming universal browser/device headroom. See [parameter evidence](practice-acoustic-parameter-provenance.md).

| Owner | Current responsibility | Numerical qualification |
| --- | --- | --- |
| Source runtime | At most4 queued/active copied model inputs; reject before the fifth extraction |4 is unqualified workload policy |
| Capture bridge | At most8 scheduled source/performance boundaries; transactional failure propagation | Finite admission is necessary;8/representation unqualified |
| Worklet transport |32 unacknowledged2048-source-sample mono Float32 blocks |32 and2048 require independent workload/transport evidence |
| Target PCM ring |65536 target samples; extraction checks qualified real/retained range | Retention relationships are proved; full headroom unqualified |
| Source adapter | Ring length ceil(actual FIR taps/up) | Derived from convolution support |
| STEP domain |1..128 raw evidence entries before indexed reads |128 is an independent unqualified work budget |
| Acoustic domain admission | Nonempty primitive string, at most192 UTF-16 units at four gates |192 is unqualified raw-string budget |

## Model geometry and payload accounting

The model contract declares16000Hz and29120 input samples:1820ms. Owned600ms is
9600 samples; future170ms is2720. Full-window past is the checked identity relationship
1820−600−170=1050ms (16800 samples). A window advances by the owned stride, clips
its owned end to the region, constructs input end as Math.round(ownedEnd+2720), and
constructs start as end−29120. Worker validation repeats the same stored-operand
endpoint construction and fixed width. Partial final windows still use a full real
input tensor; the past extends as needed. Engine smoke uses the same model-owned
input/future/owned relationships.

ACOUSTIC_TARGET_SAMPLES_PER_MS derives once as sampleRateHz/1000. Consumers multiply
by this relationship with explicit operation order. Source durations use
sourceDelta/sourceRate*1000; one source sample has duration1000/sourceRate ms
(about0.02267573696 at44100 and0.02083333333 at48000).1000 defines milliseconds per
second; this is not a1000ms tolerance. The unit identity needs no device qualification;
ADC/clock accuracy and scheduling do. Float64 ordering and Math.round placement
belong to the current arithmetic contract.

Each copied input accounts for29120×Float32Array.BYTES_PER_ELEMENT=116480 bytes.
Outstanding payload accounting derives from maxOutstandingWindows×inputBytes,
currently465920 bytes. The target ring reports its actual Float32 byteLength,
262144 bytes. These figures exclude JS objects, message copies, ORT/GPU and GC costs.

## FIR realness and source storage

For tap count L, rational up U/down D, center C=(L−1)/2 and output m, convolution
uses q=mD+C and source support ceil((q−L+1)/U)..floor(q/U). The adapter drains ready
outputs after every received source sample. It emits only when the highest required
index is real. The first output with no negative-source dependency is ceil(C/D).

| Source rate | L | U / D | C | First fully real | Source ring ceil(L/U) | Conservative real lookahead ceil(C/U) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
|44100|8821|160 /441|4410|10|56|28 samples |
|48000|61|1 /3|30|10|61|30 samples |

Every rational phase is visited because gcd(U,D)=1; phase witnesses attain56/61.
At emission the highest needed index is the just-received sample, since ready
outputs are drained each step. The support span is at most ring capacity, so its
beginning remains in the retained suffix. Arbitrary partitioning and repeated
wrap-around therefore preserve needed source samples. Golden tests check exact
Float32 output lengths/digests and accumulation order.

The runtime gives the adapter-derived firstFullyRealOutputIndex to the PCM ring.
The ring's firstUsable=max(firstFullyRealOutputIndex,firstRetained) is the common
extraction/admission/preroll boundary. Preroll requires26400 real-context target
samples plus that usable boundary. This is structural FIR support, not recognition,
latency or learner timing qualification.

Adapter storage is coefficient bytes plus the derived Float32 source ring:
35284+56×4=35508 bytes at44100 and244+61×4=488 at48000. These diagnostic values are
consequences of assets/representation rather than admission thresholds.

## Decoder and gesture retention bounds

For F frames, k disjoint above-threshold regions require2k−1<=F, so k<=ceil(F/2).
With183 frames and88 model pitches, the decoder emits at most92×88=8096 events
before ownership filtering. The descriptor-derived admission maximum183×88=16104
is safe but loose. Arbitrary producer objects still pass integrity validation.

SourcePublicationSequence checks the publication bound before sorting or STEP
retention. A same-region successor requires a full600ms predecessor; a partial final
has no same-region successor. An H50 gesture can touch at most its anchor publication
and the successor, whose full coverage seals it before a third. A region crossing
while active fails coverage validation. Thus active gesture retention is at most
two accepted publications, bounded by2×16104 observations. This relationship is not
an additional production count policy. It does not qualify50ms or learner density.

H35/H50 represent finite score-blind chord aggregation. Independent per-event verdicts
can accept a subset too early; unbounded aggregation can merge answers. The chosen
35/50ms require learner/device evidence. STEP full accepted gesture evidence enters
exact key-set evaluation, with continuation excluded and missing/extra keys mismatching.
Dense malformed evidence preserves ANALYZING ownership for retry, as described by
[STEP evidence](practice-step-pitch-evidence-bounds.md).

## Pending planning lifetime and ring retention

regions[] owns pending planning rather than inference history. endAnalysisRegion
immediately removes its exact record when endTarget===originTarget. Region IDs and
started/drained counters preserve chronology. Positive records remain FIFO until
all windows can be copied; queued inference owns copied PCM independently.

Let N=absoluteSource−base, rate r, U/D=16000/r and FIR center C. The exact implementation
emission predicate is floor((mD+C)/U)<received. A final exclusive input end F needs
N_required(F)=floor(((F−1)D+C)/U)+1. With F=round(endTarget+2720), exact-arithmetic
phase enumeration gives worst additional source progress7524/8189 at44100/48000.

Safe-index Float64 reasoning must also cover translation/rounding error:

1. Relative source differences are exact integers. Multiplication by16000 stays
   below2^67 with at most8192 round-to-nearest error; subsequent division is below
   2^52 target samples with at most1/4 sample error.
2. End target adds two conversions, then future context and integer rounding.
   The resulting endpoint error is bounded by a_r=16384/r+3/2 target samples.
3. For44100, multiplication by441 and addition of4410 each have at most128 error;
   division by160 contributes at most1 source sample. Emission error is bounded by
   e_44100=256/160+1=2.6 source samples. For48000 the multiply/add errors give e=2.
4. H_r=ceil((2720+a_r−1)D/U+C/U+e_r+1) is a sufficient source-progress horizon:
   7531/8196 samples. These are proof bounds rather than production constants or
   measured latency. The claim requires representable subsequent source progress.

Every positive closed region consumes at least one discrete source sample; endpoints
are ordered and distinct. Once E<=N−H_r, all required windows are ready and FIFO
retires the region unless independent admission/integrity fails closed. Only a
finite H_r-sized suffix of positive endpoints plus at most one active record remains.
With no source progress positive regions cannot multiply, and empty records retire.

Each admitted append contains at most2048 source samples. The emission error bounds
give conservative output increment D_r=ceil((2048+2e_r)U/D)+1=746/685 target samples.
Rounded window-end ordering differs by at most ceil(2a_r)=4 samples. A newly closed
partial still requires2720 future samples, so cannot introduce deeply overdue work.
At first extraction opportunity L−G<=D_r+4, where L is ring end and G window end.
Capacity>=29120+D_r+4=29870/29809 therefore preserves uncopied input. Current65536
satisfies that condition. Copied inputs are independent of subsequent ring wrap.

This proof concerns admitted real-context append/planning and representable
coordinates. It does not authorize shrinking the ring or establish stall/heap/GPU
headroom. Fifth-input admission fails before extraction; source-ring, target-ring,
transport-credit and outstanding-input ownership remain distinct.

## Exact scheduled-boundary information

For accepted running interval [s_i,e_i), Performance Time maps as
P(s)=p_i+(s−s_i)×1000/r. Positive paused source gaps contribute no Performance Time.
Keeping only an envelope can include gap events and change later event coordinates;
keeping exact breakpoints preserves membership and affine mapping.

A concrete48000Hz history with runs[96000,96480) and[96960,97440) has20ms performance
duration and a10ms source gap. An event at96720 belongs to the gap. An envelope of
both runs owns30ms and either fails the segment-end invariant or incorrectly admits
the gap event. Omitting a run loses its evidence or changes the next run's anchor.

For an information lower bound, use N blocks with A10ms, gap g1, B10ms, gap g2 and
choose(g1,g2)=(20ms,30ms) or(30ms,20ms). Each block has identical70ms physical extent
and20ms Performance Time, yet an event30ms into the block has different membership.
The histories use an admitted short-meter scope with15.625ms Resume Count-In,
so both gaps can contain count-in and paused time. This is a conditional prefix
construction, not admission beyond the current cap or a claim about every meter.
The2^N distinguishable histories require at least N bits for lossless representation.
Regular histories can compress, but arbitrary accepted positive chronology cannot
generally be dropped or envelope-coalesced. This argument is within representable
coordinates, not an infinite-JS-coordinate or measured delivery-lag claim.

Resume schedules future BEGIN/TERMINAL. Pause before BEGIN may cancel that provisional
interval. Once positive RUNNING ownership is accepted, Pause retains BEGIN and its
closing PAUSE. Without source consumption each admitted positive cycle adds two
necessary breakpoints. The bridge admits up to8 and fails transactionally on overflow.
Controllers stop/freeze the affected owner and release/cancel resources through
existing terminal failure paths; already accepted truth is not silently truncated.

Clock segments and projection regions are separate growing/consumed histories;
Worklet credits retain PCM rather than topology. No current bridge spill owner
provides external lossless storage. Finite admission is necessary in principle,
but numeric8 and its representation remain unqualified.32 transport credits and
maxOutstandingWindows4 do not derive the boundary budget or total session memory.

## Liveness and availability

Worker RPC silence safety uses60000ms. Legal matching LOAD progress refreshes the
silence deadline, not total load duration. Stalled RPCs settle through existing
failure/cleanup ownership. Capture readiness uses10000ms; Continuous preroll/tail
readiness waits use15000/60000ms. Tail readiness and inference drain are distinct
waits. None is a guaranteed latency, complete watchdog coverage or device SLO.

Continuous readiness uses local snapshot/subscription/recheck observation with
one-shot settlement and cleanup. Analysis readiness/availability never adjusts
physical event time. The bridge/controller propagate terminal infrastructure failure
synchronously at the boundary and fence stale callbacks by current owner/token.
Analysis intervention, infrastructure failure and natural completion have distinct
application dispositions; natural completion wins late failures according to current
controller ownership.

## Qualification and diagnostic limits

Current implementation tests cover exact source mapping, partial windows, ring wrap,
source gaps, backpressure, cancellation, RPC silence and terminal cleanup. They do
not measure browser/ADC clock accuracy, physical latency, learner chord timing,
recognition precision/recall, device memory headroom or workload stall distributions.

Diagnostics have separate bounded histories/counters and may truncate presentation
strings. They do not define accepted evidence retention. Numeric4/8/32/65536,
readiness deadlines, raw128 and identity192 need their own workload evidence before
numerical changes. The [identity boundary](practice-acoustic-identity-boundary.md)
identifies configured evidence semantics rather than complete runtime outcome replay.
