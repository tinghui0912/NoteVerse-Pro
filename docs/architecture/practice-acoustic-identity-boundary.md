# Acoustic Evidence Identity Boundary

## Identity concerns

| Concern | Owner | Evidence meaning |
| --- | --- | --- |
| Model asset | runtime-contract.json and generated verified delivery | Exact ONNX bytes, descriptor and runtime configuration |
| Decoder | robust-piano-decoder and runtime decoder configuration | Qualified piano pitch/onset semantics |
| Geometry, FIR and source mapping | planner, source adapter and FIR assets | Tensor context, half-open ownership and physical source coordinates |
| Source publication | source runtime/publication | Immutable all-pitch observations and analyzed-through coverage |
| Timing | Session timebase and segmented clock | Event-time mapping and explicit no-calibration policy |
| Admission/liveness | resource policy, capture/worker/engine/controllers | Resource retention, readiness, failure and intervention behavior |

The acoustic model, decoder and source-adapter identities belong to their algorithm
and loading owners. Their hashes and characterization tests identify the configured
evidence-producing stack. A transient Continuous Result references evaluation and
its completed session; it carries no evidence-stack transport payload.

## Selected source and asset attestation

[runtime-contract.json](../../contracts/practice/acoustic/runtime-contract.json) owns configured
acoustic runtime truth: model bytes and locator, ORT/provider, tensor descriptors,
decoder configuration, sample geometry and qualified source adapters.
[evidence-attestation.json](../../contracts/practice/acoustic/evidence-attestation.json)
owns selected implementation attestations and scoped references to the exact runtime
FIR assets. Binary identity is declared once in the runtime contract.

The [generator](../../scripts/generate_practice_acoustic_contract.py) validates both
contracts and derives immutable [TS](../../apps/customer-web/src/lib/practice/acoustic/generated/runtime-contract.ts)
and [Python](../../backend/app/modules/model_assets/generated/practice_acoustic_contract.py)
projections. Delivery, verification, inference, decoder and source adapters consume
those projections. `--check` rejects declaration, byte-attestation or projection drift.
Evidence attestation is build/repository evidence and is validated by the generator
and repository tests. It is not shipped as browser runtime data. The browser carries
the runtime contract and generated runtime, evidence and composite digests needed
to identify the configured analysis stack. The identity label derives from the
model asset ID and version.

Selected repository anchors are:

- source-analysis-runtime.ts;
- source-publication.ts, including acoustic domain identity admission;
- robust-piano-decoder.ts, including canonical piano MIDI-to-name mapping;
- window-planner.ts;
- source-adapter.ts;
- both shipped FIR coefficient assets.

Node-side [file attestation tests](../../apps/customer-web/src/lib/practice/acoustic/identity.test.ts)
verify declared paths, bytes and SHA256. Text normalization is CRLF→LF only, followed
by UTF-8 encoding; FIR assets use exact binary bytes. Canonical JSON sorts object
keys recursively and hashes its UTF-8 representation. The analysis identity hashes the canonical runtime and evidence digests. Adapter
identities bind that analysis identity, rate-specific geometry and coefficient facts.
Model delivery separately verifies model byte length and SHA256.
`assertAcousticRuntimeIdentity` verifies the runtime declaration hash and its
composite binding to the generator-produced evidence digest. Repository file bytes
and evidence contents are validated by generator/Node tests.

Selected source hashing is deliberate rather than transitive dependency attestation.
Engine, worker/client, capture transport, input/controller, resource-policy and
intervention implementations have their own runtime ownership and tests. They are
outside the declared selected evidence scope. A selected file can contain
resource checks whose bytes are still covered by its file attestation.

Source byte identity and semantic equivalence answer different questions. Any byte
edit to a selected text source changes its attestation and mechanically propagates
through evidence/composite hashes. Equal publication contents do not establish equal
hashes. Conversely equal analysis hashes do not establish identical execution outcomes
for dependencies outside the selected scope. Evidence-semantic review must consider
the relevant declaration, selected sources and timing policy as well as hash guards.

## Evidence owners and timing

`ACOUSTIC_ANALYSIS_IDENTITY` identifies the configured runtime and selected evidence. Each
qualified source rate selects its source-adapter identity. `ContinuousMidiEvidence`
owns its physical MIDI policy identity. Source analysis remains score/target/verdict
blind, and source publication enforces canonical pitch/midiPitch identity before
Practice consumes the numeric key.

Session Time, Performance Time, physical Source Time and evidence Availability Time
remain distinct. Event mapping applies no hardware compensation inferred from
processing delay or availability. Timebase and publication tests characterize the
actual mappings at their owners.

## Integrity limits and change responsibilities

Successful evidence semantics require correct source mapping, chronology, decoder
behavior, immutable observation identity and half-open ownership. Relevant changes
require review of analysis/adapter/timing identities. Artifact identity describes score
content; it is independent of acoustic model identity.

Admission budgets, Worklet credits, worker silence/readiness deadlines, engine lease
retirement and application interventions own availability. The evidence and
source-adapter declarations attest their selected algorithm sources and assets;
they do not describe every runtime policy or availability outcome.
Hash validation establishes drift resistance, not the reasonableness, optimality or
qualification of any parameter. See the [parameter evidence](practice-acoustic-parameter-provenance.md).

## Failure Representation

The source executor preserves an Error cause directly and wraps a non-Error cause in
`AcousticAnalysisError` with the closed `ACOUSTIC_INTERNAL_FAILURE` code. Adapter
boundaries project known acoustic preparation and inference codes into typed causes.
The selected-source bytes attest that executor behavior; analysis identity and source-adapter
identities bind those bytes without changing model or FIR identities. Diagnostic source
summaries carry no authority to classify application failures. See
[failure boundaries](practice-failures.md).
