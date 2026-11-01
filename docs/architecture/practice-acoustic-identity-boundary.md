# Acoustic Evidence Identity Boundary

## Identity concerns

| Concern | Owner | Persisted evidence meaning |
| --- | --- | --- |
| Model asset | model-contract and verified delivery | Exact ONNX bytes, descriptor and runtime configuration |
| Decoder | robust-piano-decoder and core declaration | Qualified piano pitch/onset semantics |
| Geometry, FIR and source mapping | planner, source adapter and FIR assets | Tensor context, half-open ownership and physical source coordinates |
| Source publication | source runtime/publication | Immutable all-pitch observations and analyzed-through coverage |
| Timing | Continuous timing provenance and segmented clock | Event-time mapping and explicit no-calibration policy |
| Admission/liveness | resource policy, capture/worker/engine/controllers | Resource retention, readiness, failure and intervention behavior |

Result schema8 evidenceProvenance identifies the configured evidence-producing stack.
It does not claim full execution replay, workload headroom, latency calibration or
physical-device recognition accuracy. COMPLETE identifies the stack that produced
accepted evidence, including possible silence. UNAVAILABLE identifies the stack
configured for the attempt; it does not assert successful publication.

## Selected source and asset attestation

The canonical acoustic core declaration binds model/decoder contracts, ownership,
resampling and source publication. Selected repository anchors are:

- source-analysis-runtime.ts;
- source-publication.ts, including acoustic domain identity admission;
- robust-piano-decoder.ts, including canonical piano MIDI-to-name mapping;
- window-planner.ts;
- source-adapter.ts;
- both shipped FIR coefficient assets.

Node-side [file attestation tests](../../apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.test.ts)
verify declared paths, bytes and SHA256. Text normalization is CRLF→LF only, followed
by UTF-8 encoding; FIR assets use exact binary bytes. Canonical JSON sorts object
keys recursively and hashes its UTF-8 representation. Adapter composite identities
bind that core hash, source-rate geometry, filter and implementation attestations.
Model delivery separately verifies model byte length and SHA256. Browser
assertAcousticIdentity validates declarations/composites without filesystem access.

Selected source hashing is deliberate rather than transitive dependency attestation.
Engine, worker/client, capture transport, input/controller, resource-policy and
intervention implementations have their own runtime ownership and tests. They are
outside the declared evidence-core provenance scope. A selected file can contain
resource checks whose bytes are still covered by its file attestation.

Source byte identity and semantic equivalence answer different questions. Any byte
edit to a selected text source changes its attestation and mechanically propagates
through core/composite hashes. Equal publication contents do not establish equal
hashes. Conversely equal core hashes do not establish identical execution outcomes
for dependencies outside the selected scope. Evidence-semantic review must consider
the relevant declaration, selected sources and timing policy as well as hash guards.

## Provenance shape

Microphone evidenceProvenance contains:

```text
inputSource
acousticIdentityName
acousticCoreIdentitySha256
modelSha256
decoderSourceSha256
sourceSampleRateHz
sourceAdapterIdentitySha256
timing { eventTimeMappingPolicyId, calibrationPolicyId, calibrationApplied }
```

MIDI provenance identifies physical MIDI event semantics and timing policy. Practice
artifact/schema and numeric piano-key projections belong to the separate
[Practice contract](practice-piano-key-contract.md). Source analysis remains
score/target/verdict-blind, and source publication independently enforces canonical
pitch/midiPitch identity before Practice projections consume the numeric key.

Session Time, Performance Time, physical Source Time and evidence Availability Time
remain distinct. Timing provenance explicitly states calibrationApplied=false;
no hardware offset is inferred from processing delay or availability.

## Integrity limits and change responsibilities

Successful evidence semantics require correct source mapping, chronology, decoder
behavior, immutable observation identity and half-open ownership. Relevant changes
require review of core/adapter/timing identities. Artifact identity describes score
content; it is independent of acoustic model identity.

Admission budgets, Worklet credits, worker silence/readiness deadlines, engine lease
retirement and application intervention govern availability and failures. Current
Result evidence provenance does not identify each of those policies or persist every
failure/hang. Thus two executions can have identical configured evidence provenance
and different availability outcomes without violating this evidence-only contract.

An execution-reproducibility requirement would need an explicit separate contract
covering policy and execution inputs. The current dependency and provenance tests
keep evidence identity separate from resource/transport/liveness implementations.
Hash validation establishes drift resistance, not the reasonableness, optimality or
qualification of any parameter. See the [parameter evidence](practice-acoustic-parameter-provenance.md).

## Failure Representation

The source executor preserves an Error cause directly and wraps a non-Error cause in
`AcousticAnalysisError` with the closed `ACOUSTIC_INTERNAL_FAILURE` code. Adapter
boundaries project known acoustic preparation and inference codes into typed causes.
The selected-source bytes attest that executor behavior; core and adapter composite
identities bind those bytes without changing model or FIR identities. Diagnostic source
summaries carry no authority to classify application failures. See
[failure boundaries](practice-failures.md).
