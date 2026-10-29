# Practice Acoustic and Timing Parameter Provenance

Round 22 records current owners at approved baseline
`adf43ba6b8860a96bc21de249768c4469334011d`. This is an audit-only reference,
not parameter approval, a tuning result, a migration plan or authorization to change
runtime behavior. Only this document changes. Current production sources, tests,
assets, identities, schemas and workflows remain unchanged.

Round 27 updates R14 and its summary membership to the implemented worker-RPC
silence safety fuse. Finite silent-service liveness is now required; 60000ms remains
an unqualified resource-safety policy, not a latency/device qualification. The
ledger remains 93 rows. Round28 then removes R18's 5ms polling mechanism, replacing
it with local event-driven observation in the non-core Continuous bridge/input.
R18 is now REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC; R16/R17 deadlines remain
unqualified resource-safety policies. Other parameter values/classifications are unchanged.

Round29 removes R02's arbitrary cap4 after the linked structural lifecycle/ring
proof: zero-duration records retire immediately and positive pending retention has
a finite source-progress bound. R02 becomes REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC;
selected executor byte changes mechanically advance core/composite values only.
The inventory remains93 rows; R01 and R03 numeric policies are unchanged.

Round30 resolves R03 mechanism necessity: exact accepted positive source/performance
breakpoints cannot generally be silently dropped/coalesced, so finite fail-closed
admission is required without an alternate lossless spill owner. Numeric8 remains
unqualified. R03 becomes UNQUALIFIED_RESOURCE_SAFETY_POLICY; the inventory stays93
rows and no production behavior/value changes in that round.

Round31 deletes R05's dead transport-credit alias and its stale runtime-test
assertion. R04 remains the sole authoritative transport-credit policy, with its
standalone Worklet declaration checked at the transport owner. Runtime behavior,
93 rows and all evidence classifications/counts remain unchanged.

Round32 derives R11's snapshot maximum from R01's owner instead of a repeated
literal4. The diagnostic remains465920 bytes; R01=4 and inputBytes=116480 are
unchanged. Selected executor byte attestation mechanically advances core/composite
identity values, without changing evidence meaning, Result shape or runtime behavior.
The ledger retains93 rows and every primary evidence classification/count.

Round33 derives R07's source/runtime maximum directly from R06's transport contract
and removes the historical resource-policy alias. Production capture paths pass or
slice accepted blocks without expansion. The maximum stays2048, comparisons stay
upper-bound checks, and R06 remains unqualified. Selected executor bytes again
mechanically advance core/composite values; all93 audit classifications stay unchanged.

Round34 deletes T14's redundant STEP gesture observation cap. The accepted source
contract bounds each publication and its same-region topology; active H50 cannot
cross regions. Proof3 below establishes the deleted guard's unreachability, including
partial finals. No replacement count/byte/time limit is installed. Accepted-contract
runtime/product behavior, identities and all93 audit classifications remain unchanged.

Round35 derives R09 input PCM payload bytes directly from model inputSamples and
Float32Array.BYTES_PER_ELEMENT, retaining116480 and the465920 R01 diagnostic maximum.
This scalar is accounting, not allocation/admission or total inference memory.
R12's other byte/unit literals remain derivation debt for separate rounds. No
selected byte anchor, identity, numeric policy or ledger classification changes.

Round36 derives only the snapshot target-ring payload report from targetRingSamples
and Float32Array.BYTES_PER_ELEMENT. Allocation stays65536 Float32 samples and the
reported payload stays262144 bytes, excluding object/allocator/runtime overhead.
R08 remains unqualified; R09 stays derived and R12 still has sample/ms/time-rate
derivation debt. Selected executor byte sensitivity mechanically advances identities,
without evidence semantics, Result shape or any ledger classification changing.

The decision order is **semantic necessity → remove unnecessary behavior/dataflow →
optimize the remaining algorithm → qualify the remaining parameters**. Every row
first states purpose and removal consequences. A cap does not become necessary
merely because removing its current implementation would leave an unbounded queue.
An alternative ownership/dataflow may eliminate the queue itself.

**Identity/hash proves drift resistance, not reasonableness, optimality, latency
qualification or device qualification.** Existing unit tests, synthetic cases,
scale results, old age, powers of two, absence of bug reports and apparently
conservative values are not substitutes for real-world qualification.

## Reading the ledger

Each parameter/behavior has one primary evidence class, selected from the eight
classes counted in the summary. A row classified structural proves only its stated
relationship under the current contracts. It does not upgrade the empirical status
of an input constant. A verified contract means the shipped/declaratively pinned
asset/interface is identified and checked; it does not mean this audit downloaded
or ran the real ONNX model, validated its training assumptions, or qualified a GPU.
`EMPIRICALLY_CHARACTERIZED` here includes numerical golden/synthetic characterization
only where explicitly stated; it never means learner/hardware qualification.

Production source links identify executable owners or explicitly named declaration
owners. Repeated literals are recorded as consumers/debt, not independent policy.

`Release blocker?` uses **Yes** for an integrity/correctness condition that must
fail closed if violated, **Deferred** for unresolved qualification/product decisions
before the corresponding release claim, and **No** for established relationships,
explicit conventions or nonblocking diagnostic/derivation debt. A Yes row does not
mean its check is currently failing. Deferred work does not block current architecture
development, but passing tests cannot authorize the corresponding quality claim.

Qualification methods (future work only):

- **Q-CONTRACT:** verify exact asset bytes/descriptors/runtime profile and upstream
  model/exporter semantic documentation; exercise actual integration on the intended
  device. File attestation and semantic suitability remain distinct.
- **Q-MATH:** prove invariants including discrete phase, rounding, ownership and
  all admitted transitions; exhaustive finite witnesses can support, not replace,
  the proof. Do not choose a new policy from a synthetic sweep.
- **Q-NECESSITY:** identify a real consumer/failure requirement; explore deletion,
  immediate retirement, coalescing or bounded-by-construction ownership without
  silently discarding accepted evidence or required boundaries.
- **Q-RECOGNITION:** labeled real piano/learner microphone recordings, chords,
  repeated notes, pedaling, noise/instruments and input devices; predeclare error
  measures and prioritize avoiding false-positive STEP progression. Evaluate
  source evidence separately from target assignment.
- **Q-TIMING:** real learner attack distributions plus device/input timestamp,
  capture/model mapping and delivery observations, across tempo/subdivision/source;
  distinguish event time from knowledge availability. No automatic calibration.
- **Q-RESOURCE:** real workload/device heap, GC, main-thread/Worklet stalls, GPU
  inference scheduling, control churn and cancellation; measure headroom and fault
  effects after unnecessary queues/dataflow have been eliminated.
- **Q-DEVICE:** representative browsers/OS/audio rates/GPU/low-end hardware, actual
  startup/mute/recovery/finalization and scheduling. No universal support claim.
- **Q-DIAGNOSTIC:** establish diagnostic consumers/useful history and measured
  retention cost; no recognition/timing correctness inference.

## Current parameter ledger

### Model and descriptor contracts

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M01 Identity / asset naming | practice-acoustic-robust-browser@v1; asset practice-acoustic-robust-browser / v1 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.identityName`; [acoustic-model-manifest.ts](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts) `practiceAcousticModelManifest.asset` | Engine, loader, evidence provenance | Bind the selected recognizer/asset, not learner accuracy | Lose exact provenance/admission checks | Select a different contract; not a cosmetic rename | VERIFIED_MODEL_OR_ASSET_CONTRACT | Manifest, core declaration and exact runtime checks agree | No recognition quality follows from naming | Q-CONTRACT | Yes: a mismatch blocks admission | KEEP exact current identity; no bump in this audit |
| M02 ONNX byte size | 98,689,283 bytes | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.modelBytes` | Verified asset loader; verifyAcousticModel | Reject truncated/wrong assets | Integrity check weakened | Different accepted asset | VERIFIED_MODEL_OR_ASSET_CONTRACT | model-inference verifies length and SHA; manifest/backend descriptor repeat it | No new ONNX download/inference on hardware in this audit | Q-CONTRACT | Yes: integrity mismatch | KEEP; consolidate duplicates only in a future behavior-neutral change |
| M03 ONNX SHA-256 | 4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.modelSha256` | Loader/OPFS verification, model session, Result | Content authenticity/integrity of chosen bytes | Wrong bytes could be admitted | Different model identity | VERIFIED_MODEL_OR_ASSET_CONTRACT | verifyAcousticModel checks exact bytes; API asset contract agrees | Hash does not establish suitability or latency | Q-CONTRACT | Yes: integrity mismatch | KEEP; never substitute performance testing for hash verification |
| M04 ORT Web | 1.20.1 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.ortVersion`; package.json onnxruntime-web | AcousticModelSession.load | Pin execution stack and reject version drift | Untracked runtime variation | May change kernels/numerics/device support | VERIFIED_MODEL_OR_ASSET_CONTRACT | package pin and ort.env.versions.web equality check | Cross-device runtime stability/performance | Q-DEVICE | Deferred: supported-device release claims | KEEP pin; QUALIFY runtime/device matrix separately |
| M05 Execution provider | webgpu | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.provider` | AcousticModelSession.load / InferenceSession.create | Explicit provider admission | Unspecified provider choice | Different execution/performance/numerical behavior | VERIFIED_MODEL_OR_ASSET_CONTRACT | navigator.gpu gate and executionProviders=[provider] | No universal browser/GPU support or latency proof | Q-DEVICE | Deferred: device support claims | KEEP current profile; qualify actual GPUs |
| M06 Automatic fallback | false | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.automaticFallback`; [model-inference.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts) `AcousticModelSession.load` | Manifest, capability/admission, provenance | Avoid silently changing recognizer execution profile | Implicit provider changes could escape provenance | New fallback product semantics | UNQUALIFIED_ALGORITHM_POLICY | Explicit webgpu-only construction; failures fail closed | Whether another provider should be offered explicitly | Q-NECESSITY | No: explicit fail-closed policy already specified | KEEP current behavior; no speculative fallback |
| M07 Graph optimization | disabled | [model-inference.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts) `AcousticModelSession.load`; [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `runtime.graphOptimizationLevel` | ORT session construction | Freeze graph execution configuration | ORT defaults become implicit | Potential numerical/compile/device differences | VERIFIED_MODEL_OR_ASSET_CONTRACT | Code and frozen runtime declaration agree | Why disabled is preferable on target GPUs | Q-DEVICE | Deferred: execution qualification | KEEP integration contract; qualify alternatives only independently |
| M08 Input name / dtype / shape | audio / float32 / [1,29120] | [acoustic-model-manifest.ts](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts) `practiceAcousticModelManifest.input`; [model-inference.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts) `AcousticModelSession.run` | assertModelNames; ort.Tensor | Exact model I/O compatibility | Cannot safely construct input | Different model descriptor or invalid input | VERIFIED_MODEL_OR_ASSET_CONTRACT | Runtime name/type/length checks and tensor construction | Model recognition suitability is separate | Q-CONTRACT | Yes: descriptor mismatch | KEEP descriptor; DERIVE duplicated literals later |
| M09 Target sample rate | 16000 Hz | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.sampleRateHz` | Adapter, planner, decoder, projection | Define model PCM/time domain | Time/sample mappings undefined | Resampling and event geometry change | VERIFIED_MODEL_OR_ASSET_CONTRACT | Core input contract; matching runtime consumers | Upstream model training/time-alignment evidence not recreated here | Q-CONTRACT | Yes: model input incompatibility | KEEP model contract; no rate tuning |
| M10 Input sample count | 29120 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.inputSamples` | Model input, ring extraction, smoke inference | Supply full fixed input tensor | Wrong-size input | Changes model/geometry contract | VERIFIED_MODEL_OR_ASSET_CONTRACT | Manifest and runtime tensor validation | No proof model should have another duration | Q-CONTRACT | Yes: descriptor mismatch | KEEP; DERIVE repeated dimensions/byte estimates |
| M11 Input duration relationship | 29120 / 16000 × 1000 = 1820ms | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.inputMs` | Planner, preroll, identity validation | Represent sample duration consistently | Duplicate duration can drift if unchecked | If inconsistent, geometry invalid | PROVEN_STRUCTURAL_INVARIANT | Unit conversion from M09/M10 (Proof 1) | Does not prove 1820ms optimal recognition context | Q-MATH | No: relationship established | DERIVE duration from authoritative input shape/rate eventually |
| M12 Output names / dtype / shape | reg_onset_output and frame_output; float32; each [1,183,88] | [model-validation.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-validation.ts) `assertModelNames / checkedOutput`; [acoustic-model-manifest.ts](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts) `outputs` | Model session, decoder | Reject incompatible tensor descriptors | Malformed output could be decoded | Different model/decoder integration | VERIFIED_MODEL_OR_ASSET_CONTRACT | Both names/order, dims, type, finite values checked at runtime | No new real ONNX output run in this documentation audit | Q-CONTRACT | Yes: descriptor mismatch | KEEP; DERIVE repeated 183/88 from one descriptor owner later |
| M13 Piano output vocabulary | 88 pitches; MIDI 21..108 inclusive | [raw-output-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/raw-output-contract.ts) `PIANO_PITCH_COUNT`; [robust-piano-decoder.ts](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) `midiPitch = 21 + pitchIndex` | Decoder, sourcePublication / sequence validators | Map output columns to piano pitches | Pitch identities become ambiguous | Changes supported output vocabulary | VERIFIED_MODEL_OR_ASSET_CONTRACT | Descriptor width 88; 108−21+1=88; source range checks | Does not qualify acoustic pitch accuracy | Q-CONTRACT | Yes: output/pitch contract mismatch | KEEP contract; DERIVE range/count duplicates |
| M14 Frame-time semantic contract | 100 Hz | [raw-output-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/raw-output-contract.ts) `PIANO_OUTPUT_FRAME_RATE_HZ`; [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `decoder.outputFrameRateHz` | Decoder peak→sample mapping | Give model frame index its declared time | Event time cannot be interpreted | Moves every decoded event | VERIFIED_MODEL_OR_ASSET_CONTRACT | Verified as the current declared model semantic identity, not inferred from tensor shape | Independent upstream exporter/training alignment provenance and real onset validation; 183/1820 is NOT its derivation | Q-CONTRACT + Q-TIMING | Deferred: calibrated timing/recognition claims | KEEP declared contract; obtain upstream temporal provenance before broader claims |

### Decoder semantic policies

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D01 Onset threshold | 0.30 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.onsetThreshold` | decodeRobustPiano onset-region predicate | Select decoder-qualified onset regions | No same recognition semantics without a selection rule | Changes detections/chord sets/progression | UNQUALIFIED_ALGORITHM_POLICY | Decoder fixtures verify implementation; frozen hash prevents drift | Labeled piano/learner microphone corpus, device/noise strata | Q-RECOGNITION | Deferred: recognition-quality release qualification | QUALIFY only after necessity review; no synthetic tuning |
| D02 Frame threshold | 0.05 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.frameThreshold` | decodeRobustPiano selected-peak gate | Reject unsupported onset peaks | More peaks admitted | Changes evidence and false progression risk | UNQUALIFIED_ALGORITHM_POLICY | Peak-gate unit fixtures; identity binding | Real precision/recall and false-positive progression evidence | Q-RECOGNITION | Deferred: recognition quality | QUALIFY with D01, never treat tests as calibration |
| D03 Contiguous onset regions | One event per maximal contiguous >=threshold region per pitch | [robust-piano-decoder.ts](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) `decodeRobustPiano` | Source publication, STEP/Continuous evidence | Avoid one event per sustained positive cell | Repeated frame evidence becomes repeated attacks | Changes retrigger/legato interpretation | UNQUALIFIED_ALGORITHM_POLICY | Loop semantics and decoder tests | Necessity/behavior on real repeated notes and sustained attacks | Q-NECESSITY + Q-RECOGNITION | Deferred: recognition semantics | Review necessary event abstraction before threshold optimization |
| D04 Peak tie convention | Earliest maximum (strict > updates peak) | [robust-piano-decoder.ts](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) `decodeRobustPiano peak selection` | Event timestamp, downstream matching | Deterministic plateau timestamp | Plateau timing becomes unspecified | Moves evidence timing; not merely diagnostics | UNQUALIFIED_ALGORITHM_POLICY | Tie fixture and exact code path | Whether plateau convention fits real attacks | Q-RECOGNITION + Q-TIMING | No: deterministic convention is explicit, quality claims deferred | KEEP current convention; do not call it learner-accuracy proof |
| D05 Frame support location | Gate at the selected onset peak | [robust-piano-decoder.ts](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) `frame.value(peak,pitchIndex)` | Decoder event admission | Require support at that exact frame | Different evidence admission | Different region/peak recognition semantics | UNQUALIFIED_ALGORITHM_POLICY | Synthetic peak/frame tests | Labeled acoustic data comparing alternative necessities | Q-RECOGNITION | Deferred: recognition quality | Review necessity; no alternate decoder this round |
| D06 Confidence aggregation | min(onsetScore, frameScore) | [robust-piano-decoder.ts](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) `confidence` | Publication [0,1] checks; STEP evidence confidence; retained evidence | Conservative score summary, not calibrated probability | Lose recorded confidence or need another contract | Can change validity and diagnostics; current target verdicts do not threshold it again | UNQUALIFIED_ALGORITHM_POLICY | Source/event records and tests; STEP pitch-set equality ignores score magnitude | Calibration and actual consumer necessity | Q-NECESSITY + Q-RECOGNITION | Deferred: confidence/probability claims | Review unused/derived data before calibrating; never claim probability |
| D07 Event sample mapping | inputStartSample + round(peak / 100 × 16000) | [robust-piano-decoder.ts](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) `sampleOffset / targetSample` | Source observation identity; performance projection | Map declared frame coordinates to target sample lattice | Lose event time | Changes timing/ownership | PROVEN_STRUCTURAL_INVARIANT | Algebra conditional on declared frame-rate contract; current step is 160 samples =10ms | Frame-grid semantics and physical input latency are not proved by algebra | Q-MATH + Q-TIMING | No: mapping relationship; physical claims deferred | KEEP exact mapping; qualify source/decoder latency separately |

### Window and source geometry

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 Ownership cadence | 600ms = 9600 target samples | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.ownedMs`; [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `planWindow` | Runtime queue, half-open publication | Partition evidence exactly once with contextual windows | Need another ownership/cadence contract | Changes batching, context placement and recognition availability | UNQUALIFIED_ALGORITHM_POLICY | Planner/publication tests and identity; sample conversion is structural | Why 600 rather than 400/800; corpus/device scheduling evidence | Q-RECOGNITION + Q-RESOURCE | Deferred: recognition/latency claims | Review ownership necessity; QUALIFY remaining cadence |
| G02 Future context | 170ms = 2720 target samples | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.futureMs` | planWindow, source publication, tail | Provide future PCM before evidence becomes available | Different model context/edge behavior | Changes recognition and decision availability, not timestamp calibration | UNQUALIFIED_ALGORITHM_POLICY | Frozen geometry and real-tail tests | Why 170 rather than 100/250; upstream model/context evidence | Q-RECOGNITION + Q-TIMING | Deferred: recognition/latency | QUALIFY context after model/ownership necessity review |
| G03 Full-window past declaration | 1050ms = 1820−600−170 | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.pastMs`; [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `ownership.fullWindowPastMs` | assertAcousticIdentity; planner derives start without reading pastMs | Describe full-window geometry | Removing declaration requires identity change, not necessarily different planner | Independent tuning would conflict with the derived width | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | planWindow uses inputSamples/future/owned; past is derived, not an independent scheduling input | No recognition qualification of the parent choices | Q-MATH | No: duplication debt | DERIVE; do not promote 1050 to an independent proven-optimal parameter |
| G04 Geometry / unit relationships | 1050+600+170=1820; 16 target samples/ms; 600×16=9600 | [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `planWindow`; [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL` | Runtime, validators, projection duplicate 16/16000/1000 | Maintain consistent coordinates | Geometry becomes inconsistent | Change requires corresponding rate/shape contract | PROVEN_STRUCTURAL_INVARIANT | Proof 1; identities and existing window tests | No empirical optimum follows | Q-MATH | No: established relationship | DERIVE conversion literals; KEEP relationship |
| G05 Actual endpoints / partial tail | ownedStart=origin+index×9600; ownedEnd=min(start+9600, regionEnd); inputEnd=round(ownedEnd+2720); inputStart=inputEnd−29120 | [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `planWindow` | SourceAnalysisRuntime.planAvailable; worker validators | Full real input around each half-open owned region | Unspecified coverage/duplicate ownership | Changes accepted regions/context; partial tail shifts the full input | PROVEN_STRUCTURAL_INVARIANT | Direct formulas; partial-window tests; Proof 1 | Not proof of recognition quality at boundaries | Q-MATH + Q-RECOGNITION | No: structural formula; edge quality deferred | KEEP current geometry; do not use note duration as acceptance cutoff |
| S01 Supported source-rate set | 44100 / 48000 Hz only | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `SourceRate / sourceRate`; [capture.worklet.js](../../apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js) `process rate gate` | Adapter, Worklet, admission/controllers | Admit only implemented frozen adapters | Unsupported conversions could enter | Expands/restricts browser/device admission | EMPIRICALLY_CHARACTERIZED | Numerical golden/partition tests at both rates and browser capability probes; support-policy characterization only | Representative real device/browser/input latency qualification | Q-DEVICE + Q-TIMING | Deferred: advertised device support | KEEP support policy; not a fact that all browsers emit these rates |
| S02 44.1k FIR asset | fir-160-441.f32; 35284 bytes; SHA d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620 | [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `resampler.coefficients`; [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `QualifiedSourceAdapter.create` | Coefficient loader / resampler | Bind shipped float32 coefficients | Untracked filter change | Different frequency/time response | VERIFIED_MODEL_OR_ASSET_CONTRACT | Exact raw-byte attestation; create verifies bytes/SHA | Recognition/device latency not established by checksum | Q-CONTRACT | Yes: coefficient mismatch | KEEP shipped asset; no redesign |
| S03 48k FIR asset | fir-1-3.f32; 244 bytes; SHA 0edd2896f0923a575a7f01fb2460b529409899e9ba187f213a36037f3ef9218f | [source-adapter-identities.json](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json) `48000.identity.coefficients`; [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `QualifiedSourceAdapter.create` | Coefficient loader / resampler | Bind shipped coefficient set | Lose exact filter identity | Different filter response | VERIFIED_MODEL_OR_ASSET_CONTRACT | Raw-byte attestation and numerical golden | No physical-latency qualification | Q-CONTRACT | Yes: coefficient mismatch | KEEP asset and its recorded firwin generation metadata |
| S04 Rational rate ratios | 44100→16000: up160/down441; 48000→16000: up1/down3 | [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `constructor up / down` | push convolution and source mapping | Exact conversion ratio | Wrong target sample rate | Time/rate drift | PROVEN_STRUCTURAL_INVARIANT | 16000/44100=160/441 and 16000/48000=1/3 (gcd reduction) | Does not establish audible/recognition quality | Q-MATH | No: ratio proved | DERIVE ratio duplication from rate contract eventually |
| S05 Tap counts / coefficient generation | 8821 and 61 float32 taps; 48k metadata firwin cutoff1/3, fs2, Kaiser beta5, scale=true | [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `resampler.tapCount`; [source-adapter-identities.json](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json) `48000.identity.firwin` | QualifiedSourceAdapter convolution | Define current shipped filter support | Cannot reproduce current FIR contract | Different filter and real-context requirements | VERIFIED_MODEL_OR_ASSET_CONTRACT | Byte lengths / sizeof(float32); frozen coefficients and generation metadata | Why these designs meet learner audio requirements | Q-CONTRACT + Q-RECOGNITION | Deferred: filter-quality claims; mismatch blocks integrity | KEEP asset facts; generation metadata is not runtime tuning |
| S06 44.1k real lookahead | center=4410; center/up=27.5625 source samples; conservative ceil=28 (~0.634921ms) | [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `center / push readiness`; [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `resampler.lookaheadSourceSamples` | Adapter emission; readiness geometry | Wait for actual required input samples | Would use not-yet-real input | Changes alignment/support if filter changes | PROVEN_STRUCTURAL_INVARIANT | Proof 2 from tap support and rational phase | No keyboard-to-browser/recognition latency claim | Q-MATH | No: filter support relationship | DERIVE duplicated conservative value from coefficient support |
| S07 48k real lookahead | center=30; up1; 30 source samples =0.625ms | [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `center / push readiness`; [source-adapter-identities.json](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json) `48000.identity.realSourceLookaheadSamples` | Adapter emission | Real future filter support | Would fabricate input context | Different filter timing | PROVEN_STRUCTURAL_INVARIANT | Proof 2 from 61 taps | Not an end-to-end latency measurement | Q-MATH | No: relationship proved | DERIVE from tap count/rate |
| S08 First fully-real output | index10 for both rates | [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `firstFullyRealOutputIndex` | Runtime/ring literal10 gates | Exclude origin outputs requiring pre-stream samples | Could admit origin-zero context | Changes initial eligible PCM | PROVEN_STRUCTURAL_INVARIANT | ceil(center/down): ceil(4410/441)=10; ceil(30/3)=10 (Proof 2) | No origin padding recognition experiment | Q-MATH | No: support boundary established | DERIVE class field from filter support instead of independent magic later |
| S09 Adapter source ring | 128 float32 samples | [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `ring / push modulo128` | Streaming FIR | Retain input needed by convolution | Unbounded history or missing samples unless replaced | Too short aliases still-needed samples; larger adds memory | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Proof 2: implementation reads at most 56/61 consecutive source positions | No reason for 128 specifically beyond sufficient slack | Q-MATH | No: current storage sufficient; minimalization deferred | DERIVE storage bound; do not change this round |
| S10 Repeated real-origin boundary | Math.max(10, firstRetained) | [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `AcousticPcmRing.extract`; [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `prerollReady / beginAnalysisRegion` | PCM admission/extraction | Repeat S08 origin-realness rule | Cannot simply drop real-context check | Divergence from adapter can accept/reject wrong context | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Same 10 is derivable for both shipped FIRs; runtime does not read adapter field | Future single-owner relationship proof after refactor | Q-MATH | No: duplication debt | DERIVE from authoritative adapter support; no generic shared policy |
| S11 Source/target affine coordinates | target=(source−base)×16000/rate; source=base+target×rate/16000 | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `beginAnalysisRegion`; [source-publication.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) `sourceEventSample` | Projection, event provenance, STEP timebase | Preserve source identity independently of availability | Lose a consistent event domain | Moves all evidence | PROVEN_STRUCTURAL_INVARIANT | Exact rational coordinate relation; safe-integer intermediate checks | No measured ADC/decoder bias or hardware offset | Q-MATH + Q-TIMING | No: mapping algebra; physical claims deferred | KEEP mapping; do not disguise FIR lookahead as calibration |
| S12 Real-context / no padded finish | Exactly29120 real samples; origin outputs excluded; partial tail shifts full input | [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `AcousticPcmRing.extract`; [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `prerollReady / tailReady` | Both microphone modes | Avoid claiming evidence from fabricated future/history | Would change recognizer boundary inputs | Changes edge detection and availability | UNQUALIFIED_ALGORITHM_POLICY | Current planner/capture tests; fail REAL_ACOUSTIC_CONTEXT_UNAVAILABLE | Whether all retained context/no-padding behavior is necessary to model quality | Q-NECESSITY + Q-RECOGNITION | Deferred: edge-recognition qualification | KEEP conservative behavior; review necessity before geometry optimization |
| S13 FIR arithmetic / partition parity | Float32 inputs/coefficients/product/each accumulation; persistent streaming state | [source-adapter.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts) `push / Math.fround` | SourceAnalysisRuntime | Deterministic shipped numerical feed | Different quantization or chunk-dependent result | Can change decoder evidence | EMPIRICALLY_CHARACTERIZED | Existing seeded golden hashes across arbitrary input partitions at both rates | Golden parity is not real-device/recognition qualification | Q-CONTRACT + Q-RECOGNITION | No: characterized parity; quality deferred | KEEP current arithmetic; qualify only after explicit model integration decision |
| S14 Capture timestamp consistency slack | 1e−5 seconds | [source-chronology.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-chronology.ts) `SourceChronology.accept captureTimeSeconds check` | Capture bridge / runtime abort | Reject inconsistent duplicated frame/time metadata | Weaker chronology validation | Different infrastructure acceptance boundary | UNQUALIFIED_ALGORITHM_POLICY | Worklet computes frame/rate; tests cover chronology | Numerical-error budget proving why 10µs is necessary | Q-MATH + Q-DEVICE | Deferred: numerical-bound review | DERIVE or delete duplicate time field/check after necessity analysis; no guessed replacement |
| S15 Worker endpoint tolerance | <=1 target sample vs ownedEnd+future | [model-validation.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-validation.ts) `assertWindowGeometry` | Model worker run | Accommodate endpoint construction/rounding | Might reject rounding if tightened blindly | Can admit/reject malformed geometry | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | planWindow uses Math.round, giving <=0.5 sample in exact arithmetic; producer sequence checks exact constructed endpoints | Full floating-point large-coordinate error budget; minimal safe validation | Q-MATH | Deferred: derive exact numerical contract | DERIVE redundant slack/validation; do not call 1 sample a learner tolerance |
| S16 Performance segment end slack | <=1000/sourceRate ms (one source sample) | [continuous-projection.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/continuous-projection.ts) `endSegment actualEnd check` | Continuous source/performance boundary | Validate rounded clock/sample boundary | Weaker mapping validation | Changes infrastructure acceptance | UNQUALIFIED_ALGORITHM_POLICY | Context frame rounding and segment tests | Rigorous combined rounding/float bound across session lengths | Q-MATH + Q-DEVICE | Deferred: mapping qualification | Prove numerical budget separately; no timing-window change |
| S17 Acoustic domain identity length | 192 characters | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `create sourceDomainId validation`; [continuous-projection.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/continuous-projection.ts) `create sessionDomainId validation`; [step-acoustic-attempt-assembler.ts](../../apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts) `constructor` | Source/runtime/STEP admission | Bound identity payloads | Long IDs accepted; data remains otherwise valid | Can turn an otherwise valid attempt into failure | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Repeated literal and bounded generated IDs; no device/workload headroom study | Necessity and legitimate identity-length envelope | Q-NECESSITY + Q-RESOURCE | Deferred: admission-cap review | DELETE/REDESIGN candidate before increasing count |

### Continuous and STEP timing semantics

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 V4 ordered objective / non-crossing theorem | CONTINUOUS_EXACT_PITCH_ORDERED_ASSIGNMENT_FINALITY_V4; max cardinality, then min total absolute error | [finalization-policy.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/finalization-policy.ts) `CONTINUOUS_ASSIGNMENT_POLICY_ID`; [same-pitch-matching.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/same-pitch-matching.ts) `matchOrderedSamePitchEvidence` | Finalizer direct cohort; completed assignment | Resolve overlapping legal same-pitch evidence with unique ownership | Nearest greedy can lose cardinality | Changes which targets match | PROVEN_STRUCTURAL_INVARIANT | Common-radius uncrossing proof; independent exhaustive/generated oracle; research record | No theorem that this objective models human intent or whole-session batch optimality | Q-MATH | No: conditional solver correctness established | KEEP proof scope; optimize only after necessity, without changing locality |
| T02 Equal-objective chronological tie | Lexicographically earliest non-crossing (targetIndex,eventIndex); earlier unresolved onset wins exact midpoint | [same-pitch-matching.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/same-pitch-matching.ts) `canonical sorts / reconstruction` | Finalized target color and evidence ownership | Remove opaque-ID influence on ordinary different-onset ties | Equal-cost visible ownership unspecified | Which target turns green can change | UNQUALIFIED_ALGORITHM_POLICY | Production midpoint/ID-renaming/permutation tests; exact equal-time fallback uses canonical order/IDs | Chronology is a declared product convention, not learner-intent evidence | Q-NECESSITY | No: explicit deterministic convention | KEEP convention; never claim improved learner accuracy from proof |
| T03 Continuous acceptance locality | W=250ms; abs(event−target)<=W inclusive | [finalization-policy.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/finalization-policy.ts) `CONTINUOUS_ASSIGNMENT_WINDOW_MS / withinContinuousWindow` | Matcher, indexes, claimant reservation, finality | Reject same-pitch attacks too far from an onset | Midpoint-only geometry can absorb arbitrarily distant attacks | Changes candidate graph and visible target truth | UNQUALIFIED_ALGORITHM_POLICY | Current deterministic cases characterize policy, not tolerance quality | Real learner timing plus device/input event timing observations | Q-TIMING | Deferred: learner-tolerance release qualification | QUALIFY only after timing semantic-necessity work; no synthetic optimum |
| T04 Direct same-pitch cohort | Same pitch and onset distance<=2W (currently500ms); no transitive closure | [finalization-policy.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/finalization-policy.ts) `directStrikeCohort` | Finalizer reservations/claimants | Wait for directly overlapping legal windows | Early ownership could conflict with a legal claimant | Different waiting/ownership policy | PROVEN_STRUCTURAL_INVARIANT | Two radius-W intervals overlap iff distance<=2W; direct-membership implementation | No proof current streaming cohort equals arbitrary batch-global matcher | Q-MATH | No: direct-overlap relationship established | KEEP derived relationship; do not freeze independent500ms constant |
| T05 Direct strike frontier bound | max(cohort onset+W)<=anchor onset+3W (currently750ms) | [finalization-policy.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/finalization-policy.ts) `directStrikeFrontier` | Frontier-ready work selection | Close all direct claimant windows before committing | Can finalize while a legal claimant remains open | Changes finality policy | PROVEN_STRUCTURAL_INVARIANT | Each direct member<=anchor+2W, then +W; Proof 5 | Not musical tolerance evidence; not a recursive connected-component frontier | Q-MATH | No: conditional bound proved | DERIVE only from W; no independent750/1250/1500 policy |
| T06 Group frontier / natural terminal clamp | Group=max child unclamped frontier; terminal clamps to reached performance coordinate | [assignment-finalizer.ts](../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/assignment-finalizer.ts) `finishGroup / finality / closeCompletion` | Completed assignment validator; NOT_REACHED state | Preserve group structure and truthful completion coordinates | Incomplete/invalid finality or fabricated reached targets | Changes finality/ownership truth | PROVEN_STRUCTURAL_INVARIANT | Finalizer/validator tests; direct-strike formula and max aggregation | No independent group-latency constant required | Q-MATH | No: relationship tests pass | KEEP structure and finality; no group outcome taxonomy |
| T07 MIDI publication coverage grace | 250ms; delivery strictly before capture+grace; equality is late | [midi-evidence.ts](../../apps/customer-web/src/lib/practice/continuous/input/midi-evidence.ts) `DEFAULT_MIDI_COVERAGE_GRACE_MS / observe / nextDeadline` | Clock evidence, finalizer deadlines | Allow delayed MIDI delivery before coverage closes | Different late-evidence acceptance/frontier availability | Changes which physical NOTE_ONs enter evaluation | UNQUALIFIED_ALGORITHM_POLICY | Exact deadline/order tests and evidence policy MIDI_NOTE_ON_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V2 | Real event-delivery stalls/device data; independent of W despite equal value | Q-TIMING + Q-DEVICE | Deferred: evidence-delivery qualification | QUALIFY separately from assignment W; do not merge constants |
| T08 MIDI event mapping identity | MIDI_EVENT_TIMESTAMP_TO_PERFORMANCE_TIME_V1; native event.timeStamp → session → performance | [timing-provenance.ts](../../apps/customer-web/src/lib/practice/continuous/timing/timing-provenance.ts) `MIDI_EVENT_TIME_MAPPING_POLICY_ID`; [browser-midi-controller.ts](../../apps/customer-web/src/lib/practice/midi/browser-midi-controller.ts) `dispatchMidiData`; [timebase.ts](../../apps/customer-web/src/lib/practice/kernel/timebase.ts) `runtimeToSessionTime` | ContinuousMidiInput/session clock | Use capture event coordinate, not publication arrival | Event ordering/time becomes delivery-dependent | Moves event eligibility and ownership | PROVEN_STRUCTURAL_INVARIANT | Affine origin transform; clock tests; timestamp fallback uses current runtime clock when absent | Native timestamp quality/physical device latency not proved | Q-TIMING | Deferred: physical latency claims | KEEP coordinate mapping; measure hardware separately |
| T09 Acoustic event mapping identity | ACOUSTIC_SOURCE_EVENT_SAMPLE_TO_PERFORMANCE_TIME_V1 | [timing-provenance.ts](../../apps/customer-web/src/lib/practice/continuous/timing/timing-provenance.ts) `ACOUSTIC_EVENT_TIME_MAPPING_POLICY_ID`; [publication.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/publication.ts) `projectContinuousEvidence` | Continuous observation performanceTimeMs/provenance | Map source event into active performance segment | Pause/analysis availability could corrupt event timing | Moves events and eligibility | PROVEN_STRUCTURAL_INVARIANT | Source affine mapping + per-segment anchor; not arrival time | Model frame alignment and input latency qualification | Q-MATH + Q-TIMING | Deferred: physical timing claims | KEEP no fitted shift; preserve all source coordinates |
| T10 No-input-calibration policy | CONTINUOUS_NO_INPUT_TIMING_CALIBRATION_V1; calibrationApplied=false; no fitted offset | [timing-provenance.ts](../../apps/customer-web/src/lib/practice/continuous/timing/timing-provenance.ts) `continuousTimingProvenance` | Result exact timing provenance | State honestly that no measured compensation is applied | Hidden/ambiguous timing assumptions | Applying offset changes learner matching semantics | UNQUALIFIED_ALGORITHM_POLICY | Exact provenance validation and no-offset implementation | Hardware/learner measurements supporting any calibration or need for it | Q-NECESSITY + Q-TIMING | No: honesty contract; latency claims remain blocked | KEEP explicit no-calibration; no automatic calibration in this audit |
| T11 Four coordinate domains | Session includes pauses/count-in; Performance excludes them; Source is physical samples; availability is knowledge time | [timebase.ts](../../apps/customer-web/src/lib/practice/kernel/timebase.ts) `PracticeTimebase`; [performance-clock.ts](../../apps/customer-web/src/lib/practice/continuous/domain/performance-clock.ts) `PerformanceClockRuntime`; [source-publication.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) `SourceAcousticPublication` | Controllers, projections, finalizer timestamps | Separate event identity from processing latency/progression | Inference delay/pause could be mistaken for learner timing | Changes completion/ownership domain semantics | PROVEN_STRUCTURAL_INVARIANT | Domain-tagged affine/sample and segmented-clock formulas; pause/finality tests | Real clock/ADC accuracy still needs measurement | Q-MATH + Q-DEVICE | No: coordinate contract; clock health remains prerequisite | KEEP domain separation, never turn stalls into timing corrections |
| T12 STEP MIDI gesture | H35=35ms; fixed first NOTE_ON window, no target-based extension or early close | [step-midi-attempt-input.ts](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts) `STEP_MIDI_CHORD_COHERENCE_MS / note` | STEP exact pitch-set evidence | Aggregate chord attacks without waiting indefinitely | Per-note answers can reject chords or accept a subset before an extra attack | Changes grouping, subset/superset and false-positive progression | UNQUALIFIED_ALGORITHM_POLICY | Timer/boundary fixtures; exact pitch-set equality | Real human chord asynchrony/device delivery evidence | Q-RECOGNITION + Q-TIMING | Deferred: learner progression qualification | QUALIFY after gesture necessity; no value change |
| T13 STEP acoustic gesture | H50=50ms; [first fresh source event, first+50ms), seal only at source coverage frontier | [step-acoustic-attempt-assembler.ts](../../apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts) `STEP_ACOUSTIC_GESTURE_MS / accept` | StepMicrophoneInput → domain pitch-set equality | Finite score-blind attack aggregation before verdict | A subset could prematurely advance; sustained/unbounded bag also wrong | Changes chord sets/false-positive progression | UNQUALIFIED_ALGORITHM_POLICY | Source frontier/rearm/mute tests; false-negative preference is a product principle | No structural derivation of50; real learner acoustic data | Q-RECOGNITION + Q-TIMING | Deferred: progression safety/recognition qualification | KEEP false negative over false-positive progression; that principle does not derive50 |
| T14 STEP acoustic gesture observation cap — DELETED | DELETED; no independent gesture observation-count cap | [step-acoustic-attempt-assembler.ts](../../apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts) `accept`; historical MAX_GESTURE_OBSERVATIONS/STEP_ACOUSTIC_GESTURE_LIMIT removed in Round34 | Current H50 Map; no consumer of the deleted internal failure | Remove a guard unreachable under the upstream accepted contract | Deletion preserves accepted-contract outcomes; upstream/topology guards still fail closed | No replacement limit; H50/ordering/copy/freeze/region behavior unchanged | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Proof3: publication<=16104 before retention; H50=50ms<owned600ms; full predecessor required for same-region successor; partial final has none; active region crossing rejected; at most2 publications and32208 observations, below historical32768 | No learner-density qualification follows; H50's product/algorithm choice and all other qualification states remain independent | Upstream-bound rejection and real cross-window/partial-final/region/long-run regressions | No: unreachable guard removed; upstream integrity remains required | KEEP DELETED; retain upstream publication bound and H50/window topology regressions |
| T15 STEP distinct-pitch / evidence-array bounds | 128; input throws before129th distinct pitch; runtime rejects raw array length>128 before dedup | [step-midi-attempt-input.ts](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts) `note pitch-limit guard`; [runtime.ts](../../apps/customer-web/src/lib/practice/step/domain/runtime.ts) `completeAttempt` | MIDI assembler and source-neutral evidence validation | Bound evidence and reject malformed inputs | Valid parser has only128 MIDI note numbers; microphone has88 | Changes malformed/direct-call admission; valid producers already dedup | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | 7-bit0..127 injective pitch mapping; both valid assemblers deduplicate | Do not assume arbitrary direct caller raw arrays are already deduplicated | Q-MATH + Q-NECESSITY | No: valid producer bound; boundary design review deferred | DERIVE wire bound / review duplicate array guard before adjusting |
| T16 MIDI wire acceptance / presence confidence | NOTE_ON0x90 with velocity1..127; velocity0→NOTE_OFF; minimum3 bytes; note/velocity<=127; confidence1 | [browser-midi-controller.ts](../../apps/customer-web/src/lib/practice/midi/browser-midi-controller.ts) `parseMidiMessage / handleNoteOn` | Both MIDI modes | Represent physical attack presence, not calibrated probability | Malformed/status messages could become attacks | Changes evidence vocabulary/event admission | PROVEN_STRUCTURAL_INVARIANT | MIDI byte interpretation and finite7-bit domain; parser tests | No proof of learner intent; confidence1 is a fact sentinel, no downstream threshold | Q-CONTRACT | No: wire semantics established; malformed bytes rejected | KEEP format semantics; never call confidence1 acoustic-style calibration |
| T17 Continuous refresh cadence | setInterval(refresh,10ms) | [continuous-practice-controller.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts) `prepareAndStart timer` | Transport refresh, MIDI deadline processing, presentation | Schedule observation of clock/finality/completion | No periodic progression without another notification source | Changes notification/finality availability latency, not W or source event time | UNQUALIFIED_ALGORITHM_POLICY | Manual-clock/controller tests; real timers may be delayed | Main-thread scheduling/GC impact and whether event-driven scheduling can remove polling | Q-NECESSITY + Q-DEVICE | Deferred: UI/availability latency claims | Review scheduler necessity before timer tuning; not a10ms input-latency promise |
| T18 Exclusive analyzed-through frontier | previousFloat(end), one representable Float64 step below exclusive endpoint; terminal publishes exactT | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `previousFloat`; [publication.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/publication.ts) `projectContinuousEvidence` | Evaluator inclusive coverage / half-open source region | Represent exclusive source coverage without epsilon-ms policy | Could finalize events at an unprocessed exclusive endpoint | Different boundary correctness | PROVEN_STRUCTURAL_INVARIANT | IEEE positive finite previous representation and exact terminal handshake | No new acoustic timing parameter | Q-MATH | No: structural boundary contract | KEEP representable predecessor, not magic epsilon timing |

### Resource, transport and liveness policies

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 Outstanding model-input cap | maxOutstandingWindows=4 | [resource-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts) `ACOUSTIC_RESOURCES.maxOutstandingWindows`; [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `planAvailable` | Queued/active copied PCM inputs; serialized chain | Bound backlog allocations; fifth ready window throws before extraction | Unbounded queue/PCM if arrival outruns inference; serialized correctness itself does not require4 | Changes terminal-failure frequency and memory ceiling | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Deterministic backpressure tests;4×116480=465920 input bytes | No real workload/heap/GC/GPU inference headroom evidence for4 | Q-NECESSITY + Q-RESOURCE | Deferred: supported-workload release qualification | Review admission/scheduling/ownership first; no blind4→8 and no silent evidence dropping |
| R02 Pending source-region count cap — DELETED; positive retention structurally bounded | No explicit count cap or replacement numeric policy; exact empty-region immediate retirement | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `endAnalysisRegion / planAvailable`; [structural proof](practice-acoustic-resource-semantics.md#r02--explicit-region-cap-deleted-with-structural-lifecycle-bounds) | Pending source planning and projection region ownership; copied PCM remains R01-owned | Retire empty records without FIFO starvation; retain positive history only within finite source-context horizon | Reintroducing empty retention permits no-progress growth; literal cap4 is unnecessary with corrected lifecycle | No positive coalescing/drop; source-discrete/model/FIR horizon bounds retention independently of session length | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Both-rate analytic horizon/ring proof; blocked-positive+128zero and64positive real-runtime regressions;32segment projection mapping; fifth-region public workload accepted | Real-device/memory qualification of remaining R01/R08 policies is separate; no bound is a workload SLO | Q-MATH | No: structural deletion proven; lifecycle/integrity regressions remain required | KEEP exact empty retirement/FIFO real-PCM planning; no replacement cap; R01 and R03 unchanged |
| R03 Scheduled boundary cap | maxScheduledBoundaries=8 | [resource-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts) `ACOUSTIC_RESOURCES.maxScheduledBoundaries`; [capture-bridge.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/capture-bridge.ts) `schedule` | Pending exact BEGIN/PAUSE/TERMINAL chronology and IDs | Finite explicit admission of controls not yet consumed by source PCM; numeric8 is a temporary defensive safety fuse | Without another finite owner/spill, exact positive history can grow with admitted cycles;8 itself is not necessary | Changes intentional fail-closed CAPTURE_BOUNDARY_LIMIT_EXCEEDED admission/failure envelope; not successful evidence semantics | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Round30 real projection deletion/envelope counterexamples, information-retention lower bound and public-controller2k positive-history growth; current mechanism bounds ownership without silent loss | Why8; real learner churn, capture/main-thread scheduling, memory/headroom and whether boundary-array count is the best owner | Q-RESOURCE + Q-DEVICE; mechanism proof in companion | Deferred: numeric/representation supported-workload qualification; accepted-history integrity is required | KEEP finite fail-closed admission in principle; REDESIGN/QUALIFY exact representation and numeric8 before supported-workload claims; no silent positive coalescing/drop |
| R04 Transport credit cap | CAPTURE_TRANSPORT_MAX_UNACKED=32 | [capture-transport-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/source/capture-transport-contract.ts) `CAPTURE_TRANSPORT_MAX_UNACKED`; [capture.worklet.js](../../apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js) `process / nextAck` | Worklet→main-thread PCM transport | Bound outstanding transferred blocks; fail rather than silently drop source PCM | Unbounded transport messages/heap under main-thread stall | Changes transport terminal-failure and memory/stall envelope | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Exact producer/ACK ordering tests; no hardware stall qualification | Real main-thread stall/GC/Worklet/load/device pressure | Q-NECESSITY + Q-RESOURCE | Deferred: transport-supported workload claims | Review backpressure design and safety tradeoff; QUALIFY remaining bound, not arbitrary32→64 |
| R05 Dead duplicate unacked policy — DELETED | DELETED; no duplicate ACOUSTIC_RESOURCES transport-credit field | Round31 removed historical `resource-policy.ts.maxUnacknowledgedBlocks` from baseline4d096be1; current R04 owners: [capture-transport-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/source/capture-transport-contract.ts) `CAPTURE_TRANSPORT_MAX_UNACKED` and [capture.worklet.js](../../apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js) | No executable reader of old alias; stale assertion removed | Remove duplicate ownership without changing admission | Deletion changes no runtime behavior; R04 remains enforced | Editing the old alias alone never changed transport admission; restoring it would recreate dead ownership | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Pre-deletion exact search found only declaration/assertion in code; R04 standalone declaration,32-block overflow, ACK credit/order tests remain authoritative | No numeric qualification needed for a deleted alias; R04 qualification remains separate | Exact-reference audit + transport behavior/drift regressions | No: dead alias deleted | KEEP DELETED; transport credit qualification belongs only to R04 |
| R06 PCM transport block selection / exact format | CAPTURE_TRANSPORT_BLOCK_SAMPLES=2048; producer emits exact-sized mono float32 blocks | [capture-transport-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/source/capture-transport-contract.ts) `CAPTURE_TRANSPORT_BLOCK_SAMPLES`; [capture.worklet.js](../../apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js) `accumulator / process` | BrowserAcousticCapture exact check; SourceChronology | Fixed transfer/ACK format; cadence vs allocation tradeoff | Need another explicit producer/consumer format | Changes batching, latency, allocation and transport admission | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Producer and consumer agree; standalone JS literals checked by existing tests | Why2048 is good on target devices; no numerical/structural necessity for selected size | Q-RESOURCE + Q-DEVICE | Deferred: capture latency/resource qualification | KEEP current exact wire contract; QUALIFY choice; relation agreement does not qualify2048 |
| R07 Repeated source block maximum — DERIVED | DERIVED: SourceChronology / SourceAnalysisRuntime maximum = CAPTURE_TRANSPORT_BLOCK_SAMPLES (=2048); historical maxSourceBlockSamples alias deleted | [capture-transport-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/source/capture-transport-contract.ts) `CAPTURE_TRANSPORT_BLOCK_SAMPLES`; [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `append`; [source-chronology.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-chronology.ts) `accept` | Runtime/sub-block defensive validation | Derive maximum from the actual producer; preserve smaller valid chunks | Removing validation weakens malformed-input rejection; restoring a duplicate owner permits drift | Current derivation changes no accepted/rejected set; future producer-format changes must preserve the relationship and review R06 | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Browser capture enforces exact R06 block; STEP passes the same array; Continuous only slices; no other production source producer; >2048 stays fail closed and smaller chunks stay legal | No independent R07 numeric qualification; R06 device/latency/allocation qualification remains separate | Production call-path audit + real chronology/runtime/split/pass-through regressions | No: duplicate owner eliminated; R06 qualification is separate | KEEP DERIVED; numeric transport-block qualification belongs only to R06 |
| R08 Target PCM ring | targetRingSamples=65536 =262144 bytes =4.096s at16k | [resource-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts) `targetRingSamples`; [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `AcousticPcmRing` | Adapter output retention before input extraction | Keep real window context while bounding raw PCM retention | Cannot extract prior context without another bounded representation | Too small loses real context; extra capacity adds headroom | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Proof 4: necessary>=29120; conditional steady-handoff sufficient bounds29863/29802, not65536 | Whole65536 choice/minimum across all legal control schedules and real scheduling/GC evidence | Q-MATH + Q-RESOURCE | Deferred: memory/control workload qualification | Separate correctness minimum from unqualified headroom; DERIVE then QUALIFY; no power-of-two rationale |
| R09 Input PCM byte relationship — DERIVED | DERIVED: ACOUSTIC_MODEL.inputSamples × Float32Array.BYTES_PER_ELEMENT =29120×4=116480 | [resource-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts) `inputBytes`, directly importing model geometry | Copied model-input payload accounting in R01 engineering snapshot only | Report Float32 PCM payload bytes from authoritative geometry/representation | Lose truthful accounting, not recognition/allocation/admission | Numeric output remains116480; authoritative geometry/width changes would propagate without independent literal drift | PROVEN_STRUCTURAL_INVARIANT | Model contract owns29120; Float32Array owns width4; resource policy owns neither literal independently; real R01 regression checks the relationship and unchanged value | Scalar excludes JS object, worker/message, ORT/GPU allocation, GC and total-heap costs | Q-MATH + real R01 relationship regression | No: scalar relationship derived | KEEP DERIVED; total resource qualification belongs to relevant runtime policies, not this scalar |
| R10 Model-event safe upper bound | maxEventsPerWindow=183×88=16104 | [resource-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts) `maxEventsPerWindow`; [source-publication.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) `sourcePublication / SourcePublicationSequence.accept` | Raw result and publication validation | Reject impossible/oversized output before retained evidence | Removes defensive malformed-producer bound; actual decoder remains finite | Too small can create terminal failure; current loose bound cannot bind a valid decoder | PROVEN_STRUCTURAL_INVARIANT | Proof3: every event consumes a distinct onset region; <=ceil(183/2)×88=8096<=16104 before ownership filtering | No reason to tighten to a new product cap; raw tensor-cell count alone is not the proof | Q-MATH | No: current bound safely model-derived | DERIVE descriptor upper bound later; do not describe16104 as empirically qualified event density |
| R11 Snapshot outstanding multiplier — DERIVED | DERIVED: R.maxOutstandingWindows × R.inputBytes | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `snapshot.resources.maximumOutstandingInputBytes` | Engineering resource snapshot only; no persisted/API contract | Report R01's copied-input maximum from its authoritative owner | Replacing the derivation with an independent multiplier can recreate diagnostic drift; admission is separate | R01 changes now automatically update the diagnostic maximum consistently; this expression does not change admission | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Historical literal4 duplicated R01; current real four-outstanding witness checks both byte relationships and fifth failure before extraction;4×116480 remains465920 | No R11 numeric qualification needed; R01 value4 heap/GC/GPU/workload/device qualification remains separate | Authoritative-relationship regression at the real R01 owner | No: derivation completed; R01 qualification is separate | KEEP DERIVED; qualification belongs to R01 and the byte relationship to R09 |
| R12 Repeated bytes/unit literals | Remaining16 samples/ms,16000 and1000 across runtime/planner/projection; input/ring Float32 payload reporting derived | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `snapshot / coordinate formulas`; [window-planner.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts) `planWindow`; [publication.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/publication.ts) `samplesPerMs` | Buffer/accounting/time transforms | Encode model rate and element width | Need equivalent derived conversion | Inconsistent changes corrupt times or diagnostics | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Round35 derives R09 inputBytes; Round36 derives targetRingBytes from actual Float32 representation, retaining262144 payload bytes; sample/ms/time-rate literals remain for later subrounds | No numeric tuning evidence needed for a relationship | Q-MATH | No: derivation debt | STILL PARTIALLY UNRESOLVED DERIVATION DEBT; derive remaining sample/ms/time-rate expressions in separate subrounds, without a generic shared policy module |
| R13 Exclusive inference ownership | One engine lease; one worker/model transaction at a time | [acoustic-engine.ts](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-engine.ts) `acquire / retire`; [worker-client.ts](../../apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts) `busy / send`; [model-inference.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts) `busy / activeSession` | Source runtime chain; workspace warm engine | Prevent cross-session jobs/state/concurrent transaction confusion | Break current sequential session/job invariants unless architecture changes | New concurrency/ownership contract | PROVEN_STRUCTURAL_INVARIANT | Explicit state/sequence guards; retirement/requalification tests | Not proof of total heap/throughput or optimal number of workers | Q-MATH | No: current ownership invariant | KEEP current lifecycle; do not turn it into a tunable arbitrary cohort cap |
| R14 Worker RPC silence safety deadline | ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS=60000ms; legal matching LOAD progress refreshes silence, not total elapsed load | [worker-liveness-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/model/worker-liveness-policy.ts) `ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS`; [worker-client.ts](../../apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts) `send / watchSilence / terminate` | LOAD/BEGIN_SESSION/INFER/END_SESSION/DISPOSE; engine leases; Setup; STEP/Continuous | Bound pending silent-service ownership while the main-thread event loop can execute | Unanswered RPC can again retain preparation/drain/retirement/cleanup indefinitely | Changes availability/failure disposition, not evidence/event timing; browser scheduling may delay callback | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Fake-clock real client/engine regressions cover five RPCs, LOAD progress, first cause/timer cleanup and application disposition; finite liveness is an explicit product requirement | Real supported-device/workload silence distributions, legitimate slow operations, browser throttling and failure incidence; numeric60s is not empirically qualified | Q-RESOURCE + Q-DEVICE | Yes: missing/broken silence mechanism; numeric qualification deferred before SLO/device claims | Mechanism KEEP; numeric deadline NEEDS REAL DEVICE/WORKLOAD QUALIFICATION; temporary defensive silence safety fuse, no retry/fallback |
| R15 Capture readiness timeout | 10000ms | [capture-transport-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/source/capture-transport-contract.ts) `CAPTURE_TRANSPORT_READY_TIMEOUT_MS`; [capture.ts](../../apps/customer-web/src/lib/practice/acoustic/source/capture.ts) `connect readyTimer` | First real accepted block admission | Avoid indefinite capture preparation wait | Preparation can hang without another liveness mechanism | Changes slow startup failure rate, not musical timing | UNQUALIFIED_RESOURCE_SAFETY_POLICY | Fails ACOUSTIC_CAPTURE_READINESS_TIMEOUT; first accepted block settles timer | Actual device startup/permission/audio/GC distribution; why10s | Q-NECESSITY + Q-DEVICE | Deferred: preparation liveness qualification | Review timeout necessity/ownership then QUALIFY remaining deadline |
| R16 Continuous acoustic preroll wait | 15000ms after capture connection | [continuous-microphone-input.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-microphone-input.ts) `connect acousticPreroll / wait` | Preparing microphone Continuous attempt | Bound wait for real context readiness | Unbounded preroll preparation wait | Changes preparation rejection on slow/stalled devices | UNQUALIFIED_RESOURCE_SAFETY_POLICY | One-shot 15000ms setTimeout deadline; callback rechecks committed readiness, which wins if ready before delayed delivery, otherwise CONTINUOUS_ANALYSIS_TIMEOUT; browser throttling/scheduling may delay delivery, so no exact wall-clock SLO; no periodic observation timer | Real cold/warm/device/stall distribution; not input-latency evidence | Q-DEVICE + Q-RESOURCE | Deferred: startup liveness | QUALIFY independently of H50/W250; no new timeout chosen |
| R17 Continuous tail-ready wait | 60000ms; only tailReady predicate wait, then seal awaits drain separately | [continuous-microphone-input.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-microphone-input.ts) `finish / wait` | Natural FINALIZING acoustic tail | Bound missing real-tail/region-planning wait | That phase can hang | Changes finalization availability failures; not a60s bound on all inference/finalization | UNQUALIFIED_RESOURCE_SAFETY_POLICY | On timeout finalizing controller produces natural UNAVAILABLE evaluation with healthy recording | Actual tail/stall/device evidence; separate RPC silence fuse (R14) is not a total-finalization SLO | Q-NECESSITY + Q-RESOURCE | Deferred: completion liveness | Review event-driven completion/timeout coverage before qualifying deadline |
| R18 Continuous readiness polling — DELETED; local event-driven readiness observation | No5ms interval or polling loop; one-shot readiness subscription with existing15000/60000ms deadlines | [capture-bridge.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/capture-bridge.ts) `subscribeReadiness / notifyReadiness`; [continuous-microphone-input.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-microphone-input.ts) `wait / readinessWaits` | Continuous preroll/tail readiness observation only | Observe committed predicate truth without periodic wakeup; failure/abort/dispose settle pending waits | Removing obsolete5ms poll changes no event/geometry semantics; removing its replacement without another observer would miss readiness | Notification discovery can occur sooner; does not timestamp evidence or qualify recognition/latency | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | Round23 same-geometry timer-delay proof; Round28 real PCM/TERMINAL, snapshot-subscribe-recheck, delayed deadline and cancellation/leak regressions | R16/R17 numeric deadline qualification remains separate; no event-driven accuracy/SLO claim | Q-MATH + Q-RESOURCE | No: polling removed; broken readiness/cancellation ownership remains a correctness concern | KEEP local observer and cleanup; deleted5ms magic stays deleted; QUALIFY remaining R16/R17 deadlines separately |

### Diagnostics and bounded presentation data

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N01 Source window diagnostics | diagnosticWindows=32 | [resource-policy.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts) `diagnosticWindows / retainCompact` | SourceAnalysisRuntime.diagnostics | Keep recent compact timing metadata | Lose diagnostics only | Changes history length/heap, not evidence retention | DIAGNOSTIC_PRESENTATION_POLICY | Shifts oldest metadata; no event arrays retained here | Engineering usefulness/heap estimate, not learner qualification | Q-DIAGNOSTIC | No | KEEP local ownership; adjust only if real diagnostic consumer needs it |
| N02 Continuous controller diagnostics | DIAGNOSTIC_LIMIT=32 | [continuous-practice-controller.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts) `record / diagnosticSnapshot` | Controller diagnostics | Retain recent application transitions | No learner correctness change | Changes debug history only | DIAGNOSTIC_PRESENTATION_POLICY | Oldest transition shifted after32 | Useful history depth and telemetry footprint | Q-DIAGNOSTIC | No | KEEP independent owner, not a shared32 policy |
| N03 Capture boundary diagnostics | 32 records | [capture-bridge.ts](../../apps/customer-web/src/lib/practice/acoustic/continuous/capture-bridge.ts) `recordBoundary` | Capture bridge snapshot | Recent schedule/apply/cancel evidence | Lose debug chronology only; actual pending boundary queue distinct | Does not change pending-boundary acceptance cap8 | DIAGNOSTIC_PRESENTATION_POLICY | Old diagnostic records shifted; live boundary IDs/queue independent | Debug utility, not recognition evidence | Q-DIAGNOSTIC | No | KEEP distinction from R03; do not share constants merely because both use32 |
| N04 Source chunk-size buckets | At most32 named distinct-size buckets plus OTHER aggregation | [source-chronology.ts](../../apps/customer-web/src/lib/practice/acoustic/source/source-chronology.ts) `sizes / accept` | Source chronology snapshot | Bound diagnostic key cardinality | Unbounded diagnostic categories or no size report | Changes aggregation, not PCM acceptance | DIAGNOSTIC_PRESENTATION_POLICY | After named-key limit, counts merge into OTHER; may have33 keys total | Diagnostic utility only | Q-DIAGNOSTIC | No | KEEP explicit32+OTHER semantics; no evidence is discarded by this aggregation |
| N05 Diagnostic planning byte estimates | R.diagnosticWindows×512; DIAGNOSTIC_LIMIT×1024 | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `snapshot.compactDiagnosticsPlanningBytes`; [continuous-practice-controller.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts) `diagnosticSnapshot.diagnosticPlanningBytes` | Engineering snapshots | Coarse debug planning values | No correctness effect | Changes reported estimate; not actual measured JS heap | DIAGNOSTIC_PRESENTATION_POLICY | Literal estimates only; exclude object/string/GC/GPU overhead | Measured heap/profile if these estimates are used for decisions | Q-DIAGNOSTIC | No | Label estimates; DELETE if no consumer; never use as safety proof |
| N06 Diagnostic error/detail truncation | 256 characters | [continuous-practice-controller.ts](../../apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts) `prepareAndStart / record` | Bounded engineering error and action detail | Bound diagnostic string retention | Longer diagnostics retained | Does not drop accepted evaluation observations or determine state via truncated text | DIAGNOSTIC_PRESENTATION_POLICY | Explicit slice(0,256) paths; coded error classification separate | Useful diagnostic completeness/consumer need | Q-DIAGNOSTIC | No | KEEP diagnostic scope; no learner capacity/identity limit inferred |
| N07 STEP ignored-note counter saturation | Number.MAX_SAFE_INTEGER | [step-midi-attempt-input.ts](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts) `ignore / snapshot` | Ignored note diagnostics | Keep counter exactly representable | Eventually inaccurate count if unbounded number increment | Changes diagnostics only | DIAGNOSTIC_PRESENTATION_POLICY | Math.min safe integer saturation | No learner qualification required | Q-DIAGNOSTIC | No | KEEP bounded diagnostic counter, separate from accepted evidence |

### Identity, attestation and Result binding

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I01 Canonical core declaration digest | db6f04cedc9639daa86e7cc93f2c07aa615fc9251156f9250dbe09460f333c9f | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `ACOUSTIC_MODEL.identitySha256 / assertAcousticIdentity` | Engine preparation, analysis identity, Result | Detect declaration drift | Declaration changes could go untracked | Mechanically changes current provenance; no intrinsic behavior proof | VERIFIED_MODEL_OR_ASSET_CONTRACT | canonicalJson UTF-8 SHA matches declaration; repaired in approved adf43ba6 | Does not qualify any number inside JSON | Q-CONTRACT | Yes: integrity mismatch | KEEP canonical binding distinct from parameter reasonableness |
| I02 Repository file attestations | path + normalized-text/exact-binary bytes + SHA for7 unique files (11 entries across core/adapters) | [acoustic-core-identity.json](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json) `acousticPublication / decoder / ownership / resampler`; [source-adapter-identities.json](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json) `implementation / coefficients` | Repository Node attestation guard, not browser fs | Bind declared implementation/assets to actual current files | Canonical JSON alone can silently attest stale file facts | Attestation repair cascades identity values; implementation may remain identical | VERIFIED_MODEL_OR_ASSET_CONTRACT | Existing acoustic-core-identity.test recursively checks files and altered byte/SHA negatives | No recognition/latency/device justification from matching bytes | Q-CONTRACT | Yes: stale/mismatched current attestation | KEEP Node-side guard; no runtime source fetch |
| I03 Source adapter composite digests | 44100:876ccd5944414f9063b4f261e77d75ada6c1ff8f728e4393bf901969760b1ec1;48000:d36e017b6056542fc9b490067fbd7504862a0de2f0a4f447401b4dd1128aa8f9 | [source-adapter-identities.json](../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json) `identity.acousticCoreIdentitySha256 / identitySha256` | QualifiedSourceAdapter.create; Result provenance | Bind source-rate/filter/core composition | Lose exact source provenance | Core repair mechanically propagates even without filter change | VERIFIED_MODEL_OR_ASSET_CONTRACT | canonicalJson of each nested identity matches digest | Not a device/input latency calibration identity | Q-CONTRACT | Yes: composite mismatch | KEEP current exact identity; no old/new dual acceptance |
| I04 Result provenance projection | Schema6; exact current core/model/decoder/source adapter + source rate + timing policy fields | [analysis-identity.ts](../../apps/customer-web/src/lib/practice/acoustic/model/analysis-identity.ts) `ACOUSTIC_ANALYSIS_IDENTITY`; [continuous-result-provenance.ts](../../apps/customer-web/src/lib/practice/result/continuous-result-provenance.ts) `microphoneEvidenceProvenance / assertContinuousEvidenceProvenance` | Current COMPLETE/UNAVAILABLE microphone Results | Persist which contracts produced evidence | Lose reproducibility/identity validation | Value updates may reject old transient provenance; shape changes require separate schema decision | PROVEN_STRUCTURAL_INVARIANT | Current exact projection/validation; parsed Result rejects retired hashes | No parameter qualification follows from serialized provenance | Q-CONTRACT | Yes: exact current shape/provenance mismatch | KEEP schema6 and existing fail-closed current-only reader; no migration |

### Additional scoped numeric findings

| Parameter | Current value | Production source | Consumers | Semantic purpose | Effect if removed | Effect if changed | Evidence class | Current evidence | Missing evidence | Qualification method | Release blocker? | Future action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X01 Numeric representability / validity | Finite nonnegative sample identities; safe integer indices/numerators <=Number.MAX_SAFE_INTEGER | [model-contract.ts](../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts) `safeIndex`; [source-publication.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) `sourceCoordinate / sourceEventSample` | Source chronology/publication/STEP identity | Preserve exact integer coordinate/identity arithmetic | Floating-point alias/overflow may pass silently | Changes accepted coordinate range | PROVEN_STRUCTURAL_INVARIANT | IEEE754 exact integer range; producer checks base×16000+target×rate before division | Very-long-coordinate proof over all transforms; not a wall-clock duration qualification | Q-MATH | Yes: invalid/overflowed identity cannot be accepted | KEEP exactness guards; do not present as a tuned attempt-duration cap |
| X02 Engine smoke-window geometry literals | 29120 PCM; ownedStart16800; ownedEnd26400; input[0,29120] | [acoustic-engine.ts](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-engine.ts) `prepare smoke.run` | Explicit Setup engine smoke inference | Exercise model/worker contract before admission | Lose smoke admission evidence if removed blindly | Could fail geometry without changing production recognition policy | REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | 16800=1050×16;26400=16800+600×16;29120=26400+170×16 | Need one authoritative geometry derivation; smoke is not real audio qualification | Q-MATH + Q-CONTRACT | No: duplicated fixture-like geometry | DERIVE from model/planner in a separate approved change |
| X03 Preroll readiness relationship | (inputMs−futureMs)×16=26400 target samples (1650ms), plus real-origin/retained boundary | [source-analysis-runtime.ts](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts) `prerollReady` | Continuous connect; source-region admission | Ensure enough preceding real PCM for possible short first region | Could admit a region whose partial input start lacks context | Changes start admission/context, not event timestamps | PROVEN_STRUCTURAL_INVARIANT | Full partial-window input start approaches origin−26400; Proof4 discusses obligations | Minimal global preroll/storage rule under all control schedules not proved here | Q-MATH + Q-NECESSITY | Deferred: edge/preroll behavior review | KEEP current rule; distinguish1650ms preroll from1050ms full-window past |

## Structural proofs and their limits

### Proof 1 — model units and endpoint geometry

Given the selected input contract, `29120 / 16000 × 1000 = 1820ms`,
`600 × 16000 / 1000 = 9600 samples`, and
`1050 + 600 + 170 = 1820`. Float32 input payload is
`29120 × Float32Array.BYTES_PER_ELEMENT = 116480 bytes`.
Round35 implements this exact R09 relationship from the two owners. It accounts
only for one copied PCM payload, excluding object/message/ORT/GPU/GC/total-heap costs.
These identities do not prove any context choice is optimal. `pastMs` is a
reported/checkable derived declaration; the planner computes input start from
end minus inputSamples rather than consuming an independently tunable pastMs.

For a region, owned start advances by exactly 9600 target samples. Owned end is
clipped to region end, input end is the rounded owned end plus 2720, and input start
is exactly 29120 earlier. A short final owned region still has a full input tensor:
its past extends further than the 1050ms full-window past. Notation/note duration
is not an attack acceptance deadline. Output shape 183 and duration 1820ms do not
mathematically derive 100Hz; the latter is a separately declared model-frame
semantic contract requiring upstream temporal provenance for any stronger claim.

### Proof 2 — FIR ratios, realness and source-ring requirement

Reduce `16000/sourceRate` to get 160/441 and1/3. Let tap count be L, upsampling
factor U, down factor D, center C=(L−1)/2 and output index m. The implementation
uses coordinate q=mD+C and source indices
`ceil((q−L+1)/U)..floor(q/U)`, restricted to nonnegative source indices at origin.
Every emitted output waits for its highest required source index to be real.
The first output with no negative-source dependency is `ceil(C/D)`:
10 at both rates. Conservative real lookahead is `ceil(C/U)`, giving 28 and 30.
It is filter support, not measured keyboard/acoustic/browser/model latency.

The index span is at most `ceil(L/U)`:56 at 44.1k and61 at 48k. The push loop drains
ready outputs after every source sample, so it does not need a ring as long as an
entire source block or an entire input window. A ring of at least 61 slots suffices
for these loops at both current rates; phase witnesses reach 56/61 index spans.
This proves 128 is sufficient, not necessary or empirically qualified headroom.
Changing convolution/filter support would require rederiving this result. The
class field10 and runtime `Math.max(10, firstRetained)` repeat the same derivable
origin-realness fact. They are not independently qualified policies.

### Proof 3 — decoder event bound and STEP retained-gesture bound

For one pitch with F finite frames, the decoder emits at most one event for each
maximal contiguous above-threshold region. Distinct regions require at least one
below-threshold frame between them. Hence if there are k regions,
`2k−1 <= F` and `k <= ceil(F/2)`. Frame support can only remove events. With
F=183 and P=88 the raw-decoder upper bound is `92×88=8096`, before ownership
filtering. The resource check `183×88=16104` is a looser safe descriptor-derived
bound, not a claim that every tensor cell can be an independent event. This proof
assumes the current contiguous-region decoder and verified descriptor; arbitrary
raw producer objects are still validated/fail closed.

The assembler first calls `SourcePublicationSequence.accept`, which rejects a
publication with more than16104 observations **before** sorting, opening or Map
retention. Within one accepted region, the sequence requires consecutive window
indices, the next start at the prior start+600ms, and the prior owned end equal to
that next start. Therefore every publication with a same-region successor has full
600ms ownership: partial finals cannot precede another accepted same-region window.
For H50,50ms<600ms. A half-open gesture anchored near a full window's end may touch
its successor, whose full frontier seals it before any third publication. A partial
final can supply enough frontier to seal; if not, it has no legal same-region
successor, and a new region still fails STEP_ACOUSTIC_GESTURE_COVERAGE_GAP while
active. Thus even an unsealed final gesture retains at most two publications.

The Map retains only observations inside H50, with copying/freezing/deduplication
unchanged. Consequently the accepted-stream upper bound is2×16104=32208, below the
historical32768 guard. Round34 uses this proof to **delete T14**, not to install32208
as another cap. The raw decoder bound above gives16192 for two publications, also
not a replacement policy. Tests cover cross-window sealing, rejection before
retention, partial finals with sufficient/insufficient frontier, rejected successors,
region crossing and thousands of retire/rearm cycles. Sparse malformed oversized
arrays test the upstream length gates without a dense heap benchmark. Neither this
structural proof nor its tests qualify learner density or H50's chosen duration.

H35/H50 are not structural consequences of pitch-set equality. Finite aggregation
is meaningful because independently verdicting every event can prematurely accept
a chord subset; unlimited aggregation can merge separate answers. Which finite
interval is appropriate remains empirical. False negatives being preferable to
false-positive progression does not derive 35ms or 50ms.

### Proof 4 — target-ring minimum versus scheduling headroom

A complete model input simultaneously needs N=29120 retained real target samples,
so ring capacity below N cannot implement the current extraction contract. The
runtime appends an entire resampled block before calling planAvailable. Streaming
phase permits at most `ceil(2048×160/441)=744` new target samples at 44.1k and
`ceil(2048/3)=683` at 48k per admitted block. FIR lookahead determines when outputs
exist; it is not added again as an invented target-sample allowance.

For the ordinary healthy append→plan path, after all previously ready windows have
been extracted, the earliest pending integer input end E is greater than old ring
end L. Next block adds at most B outputs, so extraction overshoot is at most B−1.
Thus `R >= N+B−1` suffices for that handoff:29863 or29802 samples respectively.
This is a conditional sufficient bound, not an independently proved global minimum
for every legal BEGIN/PAUSE/TERMINAL/preroll schedule. Partial regions, phase,
control scheduling and origin-realness remain explicit proof obligations before
shrinking any storage. Existing preroll readiness uses26400 preceding samples,
not merely the16800 samples of full-window past.

Each available window is extracted into its own copied Float32Array immediately;
queued/in-flight worker PCM no longer depends on the raw ring. A fifth ready window
fails the outstanding check **before** extract/allocation; it is not deferred in
the ring until worker capacity returns. Therefore multiplying ring minimum by 4 is
not justified. Main-thread stalling first accumulates Worklet transport backlog,
which has a separate credit cap; this is not proof that65536 target samples is
necessary or sufficient for every system stall. Capacity 65536 (4.096s) includes
unqualified headroom beyond the demonstrated input/block relationships. No memory,
GC, latency or hardware qualification of that whole value is asserted.

### Proof 5 — Continuous policy mathematics versus learner tolerance

Two radius-W same-pitch eligibility intervals overlap exactly when onsets differ
by at most 2W (inclusive). Every direct cohort member is at most anchor+2W, so its
right eligibility endpoint is at most anchor+3W. The implemented strike frontier
is the maximum of those direct endpoints, not a recursively expanded component.
The group's unclamped frontier is the maximum child frontier; completion clamps to
the terminal coordinate while preserving unclamped metadata. There is no independent
group 1250ms or residual 1500ms policy. Current 750ms is just3W, not another knob.

For common radius and absolute-error cost, crossing legal pairs can be uncrossed
without losing legality/cardinality or increasing cost (Monge exchange). The
ordered suffix solver implements maximum cardinality, minimum error and then
canonical chronological non-crossing ties. Existing independent exhaustive/generated
oracles support that implementation. The theorem is scoped to a solved same-pitch
cohort; it does not claim the streaming finalizer equals arbitrary whole-session
batch assignment. The [historical research](../engineering/guides/practice-timing-semantics.md)
remains labeled V3; the [current guide](../engineering/guides/practice-timing-research.md)
records V4 ties and independent regression evidence.

Nearest-target greedy can lose cardinality. Midpoint-only/IOI-only ownership can
accept an isolated attack arbitrarily far away; clipping current windows by midpoint
can also lose cardinality (targets1000/1250, events1100/1110). None supplies a proof
that W250 is a correct human tolerance. Equal-cost midpoint ownership changes which
note is green; choosing the earlier unresolved target is a product FIFO convention,
not a learner-intent finding. MIDI coverage grace250 is an independent event-delivery
policy, not derived from W, H35/H50, resampler lookahead or decoder frame timing.

## Failure effect and cap necessity

Resource bounds are not learner-error rules. `SourceAnalysisRuntime` failures stop
that source stream and reject further work; it cannot mutate transport. Higher
application owners decide intervention/completion. In an admitted active STEP
microphone attempt, terminal analysis vs infrastructure classification is owned by
`step-errors.ts`/controller; session truth remains retained behind its End-only
intervention. Continuous ACTIVE terminal analysis failure pauses and asks for an
explicit choice; capture/clock infrastructure failures use the distinct resource
owner. Continuous FINALIZING analysis failure yields natural UNAVAILABLE evaluation,
not a partial COMPLETE score. PREPARING failures remain admission failures. These
are existing behaviors, not redesigned by this audit.

- R01 counts queued and active model inputs. Serialization/identity correctness
  requires ordered ownership, not specifically 4 slots. Removing the cap alone
  permits backlog growth. Whether terminal failure rather than different producer
  admission/scheduling is necessary remains a product/resource design question.
- R02 counts pending planning, not copied inference/Result history. The literal
  cap4 is deleted in Round29: exact empty-region retirement closes the no-progress
  loophole; positive retained endpoints fit a finite derived source horizon. See
  the [both-rate lifecycle/ring proof](practice-acoustic-resource-semantics.md#r02--explicit-region-cap-deleted-with-structural-lifecycle-bounds).
  No positive interval is coalesced/dropped and R01 remains independently enforced.
- R03 counts pending physical boundaries; future terminal and control boundaries
  consume the queue too. Its failure aborts the capture bridge, so it is not a
  harmless UI overflow. Round30 proves finite explicit fail-closed admission of
  exact positive history necessary without a spill owner; deletion/envelope
  counterexamples and the information/growth proof are in the
  [R03 companion](practice-acoustic-resource-semantics.md#round30--finite-admission-necessity-independent-of-numeric8).
  No theorem supports8 as the permitted legal-control limit or boundary count as
  the best future representation.
- R04 bounds producer credits. Main-thread ACK occurs only after synchronous PCM
  acceptance, not after inference completes.32 blocks correspond to about 1.486s
  (44.1k) or 1.365s (48k) of block payload; these are conversions, not safe-stall SLOs.
  A stalled but otherwise legitimate device/application can hit a resource cap.
- R15/R16/R17 are liveness policies, not musical timing. The 10s capture timer ends
  at the first accepted real block.15s preroll begins after capture connection.
  60s tailReady does not cover the later awaited inference drain, nor every worker
  RPC. Round28 deletes the5ms polling interval; it never defined recognition context
  or event timestamps. Existing deadline values are unchanged.

Retaining a finite system alone does not prove a particular cap or terminal-failure
policy necessary. R03's stronger constraints above establish fail-closed admission
in principle, while leaving numeric8 unqualified. Eliminate unnecessary queues/dataflow,
prove bounded ownership where possible, then qualify the remaining headroom. Never
silently drop accepted observations, skip required PCM/windows, discard provenance,
or produce a partial score to remain under a resource budget. No new emergency cap,
quiet truncation, fallback, migration or calibration is proposed here.

## Identity layers and the approved attestation repair

1. The model asset SHA identifies actual ONNX bytes; length/hash verification checks
   downloaded/OPFS content, not usefulness or timing accuracy.
2. The acoustic-core canonical SHA binds a JSON declaration, including model,
   decoder, geometry and implementation-attestation facts. A self-consistent JSON
   can still contain stale file fingerprints.
3. Repository path/bytes/SHA attestation checks current source text (UTF-8 with
   CRLF→LF only) and exact raw FIR bytes in a Node-side test. It does not run inside
   browser assertAcousticIdentity or fetch repository source at runtime.
4. Source-adapter composite hashes include the core reference, filter/source
   implementation and rate geometry; mechanical core changes cascade them without
   implying a new filter response.
5. Result evidence provenance projects the current exact core/model/decoder/source
   identities and timing policies. It records contracts used; it is not a quality
   certificate. Input source/provenance explain MIDI vs acoustic epistemic limits.

Approved baseline `adf43ba6b8860a96bc21de249768c4469334011d` repaired the
**declaration ↔ current repository files** gap for executor/publication fingerprints,
added recursive source attestation and mechanically updated the core/adapter
composites. It did not qualify thresholds, windows, caps, source latency or devices.
The identityName remains `practice-acoustic-robust-browser@v1`, Result schema6 and assignmentV4; current-only provenance
validation has no compatibility reader. This audit does not change any identity.

## Scan coverage and exclusions

Read-only inspection covered acoustic/model, acoustic/source, acoustic/runtime,
acoustic/continuous, Continuous controller/microphone/evidence/finalization/solver,
STEP acoustic/MIDI assemblers and domain evidence validation, browser MIDI parsing,
timebase and segmented performance mapping. Repeated literals 29120/183/88 occur in
model-contract, manifest, model-inference, model-validation, raw-output vocabulary,
resource accounting and smoke setup: they are descriptor/relationship duplication,
not independently qualified policies. Transport Worklet literals duplicate the
transport contract by necessity of the standalone module and have existing drift
tests; Round31 deletes the historical resource-policy.maxUnacknowledgedBlocks
duplicate, which had no executable reader. Only R04 owns transport credit policy.

The scan also surfaced192-character domain caps,128 pitch bounds, numerical slacks,
10ms refresh, diagnostic estimates/truncation, safe-number guards and smoke/preroll
geometry, all covered above. Format rank/batch axes, exact field counts, integer
sequence increments, chromatic spelling arithmetic and state enum ordinals are
schema/coordinate mechanics, not additional free timing/resource parameters.
Normalized confidence range[0,1] is checked by publication/STEP evidence boundaries;
no second confidence threshold is used for target truth. That validation is not
empirical probability calibration. Capture mono averaging/zero output is the current
transport/audio-graph format, not a tuned learner pitch/latency value.

Tempo/count-in/metronome UX configuration, recording storage, backend/auth/network
limits and unrelated UI animation parameters are outside this acoustic/evidence
parameter inventory. Existing STEP multi-hour soak and Continuous recording chunk
retention are not reopened. No test/source/JSON/asset/workflow implementation is
changed; no new parameter-locking tests are introduced.

## Local validation (regression/attestation only)

Existing tests were run without modification: acoustic identity/attestation/model
session/decoder/window/source/capture/runtime, Continuous finalization/ordered solver/
MIDI coverage/timing provenance, STEP MIDI/acoustic gesture/exact verdict/timebase,
architecture boundaries and existing timing research. Result: **29 files,364 tests
passed**. They corroborate current code/contracts; none qualifies numerical policy.
The source-adapter tests use seeded numerical golden fixtures, not learner audio.
Repository documentation guards/structure/Markdown links and git diff --check are
required for this documentation change; their final execution is recorded in the
completion report. No E2E, production build, backend, full frontend/coverage or new
hardware/corpus study is claimed for this documentation-only audit.

## Summary and future-action matrix

**93 ledger rows**, one primary evidence class per row:

| Evidence class | Rows |
| --- | ---: |
| PROVEN_STRUCTURAL_INVARIANT | 24 |
| VERIFIED_MODEL_OR_ASSET_CONTRACT | 18 |
| EMPIRICALLY_CHARACTERIZED | 2 |
| UNQUALIFIED_ALGORITHM_POLICY | 19 |
| UNQUALIFIED_RESOURCE_SAFETY_POLICY | 10 |
| DIAGNOSTIC_PRESENTATION_POLICY | 7 |
| REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC | 13 |
| SEMANTIC_NECESSITY_UNRESOLVED | 0 |

Class membership (row IDs are stable within this audit):

- **PROVEN_STRUCTURAL_INVARIANT:** M11, D07, G04, G05, S04, S06, S07, S08, S11, T01, T04, T05, T06, T08, T09, T11, T16, T18, R09, R10, R13, I04, X01, X03.
- **VERIFIED_MODEL_OR_ASSET_CONTRACT:** M01, M02, M03, M04, M05, M07, M08, M09, M10, M12, M13, M14, S02, S03, S05, I01, I02, I03.
- **EMPIRICALLY_CHARACTERIZED:** S01, S13.
- **UNQUALIFIED_ALGORITHM_POLICY:** M06, D01, D02, D03, D04, D05, D06, G01, G02, S12, S14, S16, T02, T03, T07, T10, T12, T13, T17.
- **UNQUALIFIED_RESOURCE_SAFETY_POLICY:** S17, R01, R03, R04, R06, R08, R14, R15, R16, R17.
- **DIAGNOSTIC_PRESENTATION_POLICY:** N01, N02, N03, N04, N05, N06, N07.
- **REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC:** G03, S09, S10, S15, T14, T15, R02, R05, R07, R11, R12, R18, X02.
- **SEMANTIC_NECESSITY_UNRESOLVED:** None.

The structural results are the sample/byte/unit relationships, discrete FIR support,
conditional ring storage bounds, decoder region upper bound, direct 2W/3W relationships,
conditional ordered-matching theorem and explicit coordinate/provenance projection.
Verified facts identify the model/profile/descriptors, FIR assets and current identity
layers. Numerical golden parity and support-at-two-rates characterization do not
establish device or learner quality. All unqualified algorithm/resource rows remain
unqualified regardless of the successful regression suite.

| Future bucket | Scope | Type of possible later change | Order / release relevance |
| --- | --- | --- | --- |
| A. KEEP | Current verified asset/model/I/O identities, established structural relationships, exact ownership/coverage integrity and R03 finite fail-closed admission in principle | Preserve contract; R03 representation/numeric8 remain separate redesign/qualification questions; a genuinely different model/runtime requires its own explicit contract decision | Integrity mismatches/invalid geometry/source identity are actual fail-closed release blockers, not reasons to tune values |
| B. DERIVE | G03/S09/S10/S15/T15/R12/X02; input duration, remaining byte/unit expressions, ratios, descriptors and smoke/preroll relationships | Remove duplicated magic/dead ownership; isolate format derivation from product behavior; T14/R05 stay deleted and R07/R09/R11 stay derived; R12 is not complete | Can be independent narrow changes after proof; source edits must update attestations, not merely bypass guards |
| C. QUALIFY | D01–D06, G01/G02/S12, W250, MIDI grace250, H35/H50, remaining numerical slacks, selected runtime/source support, ring/outstanding/transport/timeouts after necessity review | Recognition/timing changes or resource-failure/admission changes; requires explicit product decision and real learner/device/workload evidence | Required before corresponding accuracy/latency/robustness/support claims; not a synthetic tuning contest |
| D. DELETE/REDESIGN CANDIDATE | R03 representation/counting unit, caps/dataflow in R01/R04/S17; unused duplicates and unconsumed diagnostics/confidence | Redesign exact positive-history representation while retaining finite admission; review other ownership/backpressure and retained derived data | Before raising caps/optimizing algorithms; R03 mechanism is KEEP, not a deletion candidate; no silent loss of accepted truth or new universal coordinator |

The semantic-necessity unresolved membership is empty. R03 now has a proven
finite-admission requirement and an unqualified numeric8/representation choice;
this does not qualify the cap. R02 count cap was
deleted with exact empty retirement and a finite positive-retention proof. R18 polling was deleted; its
local observer does not qualify the remaining R16/R17 safety deadlines. R14 now keeps a required
silence-liveness mechanism with an unqualified numeric deadline. The distinct numerical
headroom/deadline policies R01/R03/R04/R06/R08/R14/R15/R16/R17 and identity cap S17 have no real
workload/device qualification here. Diagnostic policies N01–N07 are not correctness
limits. R05's dead alias is deleted with no replacement; R11's historical repeated4
in maximumOutstandingInputBytes is now derived from R01, not another budget. T14 is
deleted using accepted-stream topology/upstream bounds; T15 retains its separate
valid-producer proof. Neither establishes learner-density qualification.

**Release blockers:** mismatched bytes/descriptors/current attestations, invalid
source chronology/clock ownership, or an implementation that silently discards accepted
evaluation truth are correctness blockers. Current focused checks observed no such
failing condition at this baseline. The missing labeled learner/acoustic onset and
chord evidence, device/input timing observations, and real workload/heap/GC/stall
headroom are blockers to claiming qualified recognition/progression safety, optimal
learner timing tolerance, calibrated latency or supported-device robustness. This
document grants none of those claims and sets no replacement threshold. Deferred
parameter studies, duplicate-constant cleanup and diagnostic retention choices do
not themselves block ongoing architecture development. A product release decision
must explicitly resolve the applicable qualification rows; this audit is not a
release approval or a new runtime gate.

Suggested order only: (1) semantic consumer/cap necessity and failure effects;
(2) deletion or bounded-by-construction dataflow and derivation of remaining magic;
(3) correctness proofs/optimization of remaining algorithms; (4) preregistered real
learner/device/workload qualification of remaining parameters. No subsequent round
is implemented or started by this document.
