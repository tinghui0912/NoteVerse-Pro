# Acoustic Domain Identity Bounds — Round47 Audit / Round48 Implementation

This audit describes branch `refactor/practice-foundation-v2` at approved HEAD
`78ad1b365bd9f8c2b1e0b77594a6dd5d96e2a79c`, parent
`1c9df071bcb0a2160a9ac24968394f6c38d2cac1`. Round47 changed documentation only.
The [parameter ledger](practice-acoustic-parameter-provenance.md) retains S17 as
UNQUALIFIED_RESOURCE_SAFETY_POLICY. Round48 implements candidate2 below from approved
HEAD `9844ede6c43e6d07d35e3e4a0310c3ade51eab1e`; the audit tables retain baseline
characterization. The implementation preserves the admitted primitive-string set.

## Round48 current state — single selected-source owner, four defensive gates

[isAcousticDomainIdentity](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts)
now owns Boolean(value) && value.length<=192. It lives in the already-selected
publicationSource, not an unattested helper. Every existing gate in the table below
calls it at the same position on the same field, preserving its error owner. Source
runtime and Continuous projection still validate field shape first; assembler still
checks source before local/mapping fields; STEP setup still checks abort/context/
rate/local ID before source admission and acquires no inference/FIR/capture on failure.
No gate was removed and no semantic grammar or typeof hardening was added.

Focused regressions cover empty/1/192/193,96 emoji (192 UTF-16 code units),97 emoji,
192 non-ASCII code units with a larger UTF-8 encoding, separators, whitespace,
newline and NUL. Direct projection session192/source192 remains accepted; invalid
session never reaches the source factory, whereas valid session/invalid source does.
The real Continuous microphone path retains184→192 acceptance and185→193 source-gate
rejection. Product generators, prefixes, :capture and observation/publication/terminal
formats are byte-unchanged; source/evidence/timing semantics remain unchanged.

Duplicate-predicate ownership is **KEEP SINGLE OWNER**. Numeric192 remains an
unqualified resource-safety budget in QUALIFY, not an identity grammar or a bound
derived from generated lengths. S17 leaves DELETE/REDESIGN for the completed
predicate cleanup, remains numerically unqualified, and does not enter DERIVE.
All93 primary rows/classifications/counts remain unchanged.

The existing selected executor import/use bytes and publicationSource predicate
bytes change, requiring normalized CRLF→LF-only file attestations and a mechanical
canonical core/both adapter composite cascade. No new selected anchor, transitive
digest or provenance field is introduced. Model/FIR/decoder/planner/adapter source
bytes and geometry are unchanged. Result6, STEP8/runtimeVersion and provenance
shape remain unchanged; configured identity values advance through the existing
selected-byte contract. See [identity boundary](practice-acoustic-identity-boundary.md).

## Four current admission sites

Round47's exact `192` search found four inline identity owners, including the STEP
microphone site omitted from the earlier ledger source list. Round48 retains these
four admission gates but their numeric predicate now has one selected-source owner.
The tested contract is a declared primitive string: nonempty and at most192 UTF-16
code units (`String.length`), not Unicode scalar values or UTF-8 bytes. The current
guards do not assert `typeof value === 'string'`; this audit does not extend their
claims to arbitrary JavaScript objects that violate their TypeScript types.

| Owner / field | Shipped caller and upstream validation | Position / failure ownership | Direct call status |
| --- | --- | --- | --- |
| [SourceAnalysisRuntime.create](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts): `options.sourceDomainId` | ContinuousAcousticProjection.create or StepMicrophoneInput.setup; STEP already checked the same source string; Continuous checked a different session field | After option-key validation, before identity assertion, adapter coefficient validation/allocation and runtime/ring construction; rejects with AcousticAnalysisError `INVALID_ACOUSTIC_DOMAIN`; startup caller handles rejection, not runtime onFailure | Public factory; directly callable with arbitrary typed strings |
| [ContinuousAcousticProjection.create](../../apps/customer-web/src/lib/practice/acoustic/continuous/continuous-projection.ts): `options.sessionDomainId` | ContinuousMicrophoneInput.connect; normally the session/timebase ID, with no upstream192 admission | Before projection/runtime construction; `INVALID_ACOUSTIC_DOMAIN`; subsequently delegates its separate sourceDomainId to runtime.create | Public factory; session and source fields need not obey the product suffix relationship |
| [StepAcousticAttemptAssembler constructor](../../apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts): `options.sourceDomainId` | StepMicrophoneInput.captured; setup and runtime already accepted this same source ID | Before sequence/timebase/active-observation retention; ordinary Error `STEP_ACOUSTIC_SOURCE_MAPPING_INVALID`; also checks local ID nonempty and mapping | Public constructor; independent direct tests/internal callers |
| [StepMicrophoneInput.setup](../../apps/customer-web/src/lib/practice/step/step-microphone-input.ts): `connection.sourceDomainId` | StepPracticeController.prepareMicrophone via public input.start; generated source has not passed another192 check | Before inference acquisition, FIR loading, source runtime, bridge and capture; Error `STEP_MICROPHONE_CONNECTION_INVALID` reaches existing fail/rejectReady/dispose/sink.failure path | Setup is private, start is public and directly callable |

The last guard is not before *all* retention: start has already entered PREPARING,
shallow-frozen/retained the connection and attached abort/context listeners; the
input already owns its readiness Promise. Rejection disposes those owners. Continuous connect also
acquires its inference lease and loads coefficients before projection admission;
invalid domain admission prevents capture startup but is not a zero-allocation path.

The STEP assembler check is redundant on every current shipped caller after setup
and runtime succeed, yet defends an independently callable constructor with its own
mapping failure owner. The source runtime recheck is likewise redundant on the
shipped STEP path, but is the first source-ID gate on Continuous and its direct API.
The projection session check is not a duplicate source-ID check. The STEP input
check preserves early connection failure before expensive setup. None of these
facts justifies deleting checks solely because the literals match.

## Generated identity paths and lengths

[createLocalSessionId](../../apps/customer-web/src/lib/practice/kernel/session.ts)
returns `<prefix>:<random>`. The default prefix is `local-practice` (14 code units);
STEP supplies `step` (4). The generator accepts any prefix string without length
or grammar validation. Its production callers are both controllers and the fallback
session creation in ContinuousPracticeSession and StepPracticeRuntime. Controllers
normally supply their generated ID to those session/domain owners, rather than
using the fallback to generate a second identity.

Continuous microphone path:

1. createLocalSessionId() → ContinuousPracticeSession.localSessionId and timebase.domainId.
2. [ContinuousPracticeController](../../apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts) passes connection.sessionDomainId to [ContinuousMicrophoneInput.connect](../../apps/customer-web/src/lib/practice/continuous/continuous-microphone-input.ts).
3. Input constructs sourceDomainId = sessionDomainId + `:capture` (8 extra code units).
4. Projection.create checks session ID; SourceAnalysisRuntime.create checks source ID.
5. SourcePublicationSequence validates exact source identity/affine mapping and observations; projection makes Continuous observations/publications, then session.publishAnalysis retains evidence and terminal coverage.

STEP microphone path:

1. createLocalSessionId('step') → [StepPracticeController](../../apps/customer-web/src/lib/practice/step/step-practice-controller.ts) localSessionId and domain session.
2. Controller passes localSessionId and localSessionId + `:capture` to StepMicrophoneInput.start/setup.
3. Setup checks source ID and creates SourceAnalysisRuntime; the first captured PCM creates StepAcousticAttemptAssembler in captured(), checking the same source ID again.
4. Validated source publications feed the assembler's current H50 gesture; projection to StepPitchEvidence keeps pitch/confidence/captureEndSessionTime, not source observation IDs or sourceDomainId.
5. Controller sink completes the source-neutral STEP domain attempt. SessionTime.domainId and attempt identity still identify the local session.

Let P be prefix length, T the Date.now() string length and R the Math.random()
string length. The native UUID branch has36 characters; fallback is
`<prefix>:<Date.now()>-<Math.random()>` with no padding or fixed decimal width.

| Generator branch | Session length S | Source length D=S+8 | Continuous S / D | STEP S / D |
| --- | --- | --- | --- | --- |
| Canonical native crypto.randomUUID() | P+37 | P+45 | 51 /59 | 41 /49 |
| Fallback, exact expression | P+2+T+R | P+10+T+R | Depends on native number strings | Depends on native number strings |
| Fallback, conservative native-number bound | At most P+43 | At most P+51 | At most57 /65 | At most47 /55 |
| Fallback with a positive13-digit timestamp | At most P+39 | At most P+47 | At most53 /61 | At most43 /51 |

The conservative bounds assume native APIs: an integral valid Date time value has
at most17 decimal characters including a negative sign; shortest binary64 decimal
formatting for a nonnegative Math.random() value below1 needs at most24 characters
(17 significant digits with fixed-format leading zeros; exponent formatting fits
within that bound). See the [ECMAScript time/random definitions](https://tc39.es/ecma262/multipage/numbers-and-dates.html)
and [Number string conversion](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring).
These are conditional generator characterizations, not supported-device evidence
or an API bound. Arbitrary prefixes and unvalidated replacement API providers
prevent a universal generator limit: a300-character prefix plus native-shaped UUID
already produces337 characters. Current short product prefixes do not derive192.

## Direct-call characterization, unchanged

Read-only execution of the existing TypeScript modules used real shipped48000 FIR
bytes, source runtime/bridges, deterministic PCM and fake inference/device ports.
No source/test files were rewritten. Tests used strings up to4096 code units, not
hostile-memory stress. Valid public microphone inputs reached readiness and were
disposed. For projection probes, the other domain field was separately valid.

| Boundary and checked field | Empty | Length1 | Length192 | Length193 /4096 |
| --- | --- | --- | --- | --- |
| Source runtime sourceDomainId | INVALID_ACOUSTIC_DOMAIN | Accept | Accept | INVALID_ACOUSTIC_DOMAIN |
| Projection sessionDomainId | INVALID_ACOUSTIC_DOMAIN before source factory | Accept | Accept | INVALID_ACOUSTIC_DOMAIN before source factory |
| Projection sourceDomainId, valid session | INVALID_ACOUSTIC_DOMAIN in source factory | Accept | Accept | INVALID_ACOUSTIC_DOMAIN in source factory |
| STEP assembler sourceDomainId | STEP_ACOUSTIC_SOURCE_MAPPING_INVALID | Accept | Accept | STEP_ACOUSTIC_SOURCE_MAPPING_INVALID |
| STEP input.start sourceDomainId | STEP_MICROPHONE_CONNECTION_INVALID | Ready | Ready | STEP_MICROPHONE_CONNECTION_INVALID |

Rejected STEP starts acquired no inference lease, loaded no FIR, created no capture
and delivered one failure-sink notification. Accepted starts reached those stages.
The product Continuous composition is different from testing each field independently:

| Continuous input session S | Derived source D | First applicable outcome |
| --- | --- | --- |
| 1 | 9 | Ready |
| 184 | 192 | Ready |
| 185 | 193 | Runtime source gate rejects |
| 192 | 200 | Runtime source gate rejects |
| 193 | 201 | Projection session gate rejects before source factory |

Thus184 is a consequence of this suffix composition, not a new declared policy.
Inference/FIR setup had already occurred before these Continuous rejections; capture
had not. Direct projection with unrelated session192/source192 accepts. Direct STEP
assembler with localSessionId193/source1 and matching SessionTime accepts: the local
field is checked nonempty, not capped192. STEP input likewise does not cap local ID
itself; product source suffix admission normally constrains it first.

No semantic grammar beyond nonempty/length is enforced at these four string gates.
Space, colon, `a:r0:w0:p60:f1`, `a:terminal`, Chinese text, emoji, NUL and newline
pass the applicable ID checks. There is no trimming, normalization or reserved
delimiter rule. Publication consumers compare opaque identities, recompute expected
IDs and use Map/Set keys (and deterministic ordering); no reverse parser of these
concatenated IDs was found. Caller reuse of a domain is not made globally unique
by its length gate; duplicate evidence within one store still fails. The audit does
not invent delimiter restrictions or prove a global namespace from string syntax.

## Payload amplification and distinct length concepts

Generated session/source lengths above, direct API admission, and derived ID lengths
are different quantities. The resource question is how a direct long string scales
work in accepted publication structures; it is not whether the generator is short.

[sourceObservationId](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts)
constructs `<D>:r<region>:w<window>:p<pitch>:f<target>`. Its suffix length is8 plus
the four numeric string lengths; with accepted safe nonnegative integer coordinates
and MIDI pitch, at most59 characters beyond D. This is conditional on the accepted
source contract, not validation performed by that pure formatting function itself.
Raw SourceAcousticPublication has no publicationId field.

| Current object/owner | Domain-bearing structure / consequence |
| --- | --- |
| Source publication with N observations | Header sourceDomainId once; each observation has sourceDomainId and a source-prefixed observationId: **2N+1 string fields**, with domain-character contribution (2N+1)D plus suffixes |
| Source generation/validation | Observation-ID Set and transient expected-ID reconstruction/Set repeat hashing/comparison work; SourcePublicationSequence retains only its own domain and previous numeric summary, not a session-wide observation ledger |
| Continuous projection with M retained observations, M≤N | Header publicationId=`<D>:window:<job>` and sessionDomainId S; each observation has `<D>:s<segment>:w<window>:p<pitch>:f<target>` plus provenance.sourceDomainId: **2M+1 source-prefix fields plus one session field**, contribution (2M+1)D+S plus suffixes |
| Continuous terminal | `<D>:terminal` is D+9 characters, plus header sessionDomainId; no observations |
| Continuous evidence store | structuredClone for immutable publication, publications Map key, receipt session ID, canonical headerIdentity containing publication/session IDs, observationIds receipt array and observations Map keys. Time/pitch indexes reference observations; they are not extra independent event ledgers |
| STEP H50 assembler | Retained Map keyed by observationId; frozen shallow observation copies, sealed gesture header sourceDomainId plus K observations with sourceDomainId/ID: 2K+1 domain-bearing fields, with additional key references |
| Result schema6 | localSessionId and COMPLETE assignment.sessionDomainId; accepted Continuous observations with per-observation source provenance and IDs survive flat/nested assignment projection and Result cloning/serialization. Configured stack evidenceProvenance does not itself contain source/session IDs |
| STEP shared domain evidence | Pitch/confidence and captureEndSessionTime(local domain); no sourceDomainId/observationId payload. Current attempt identity includes local session; no accumulation across attempts |

N is already bounded by maxEventsPerWindow=183×88=16104; K is bounded by the
existing accepted H50/two-publication topology (at most2×16104), not a new count
policy. Raw and projected publication objects can coexist. These counts describe
fields and character relationships, not exact JavaScript heap allocations: strings
may share references/rope storage, shallow copies do not prove deep string copies,
and runtime/index/object overhead is not measured. Session totals depend on other
ownership rules; no total-memory qualification follows from one publication bound.

Source runtime options/sequence and STEP connection/latest retirement boundary hold
O(1) domain references. Source runtime, projection, capture, input and assembler
engineering snapshots expose counts/geometry/identities rather than repeating the
domain in every diagnostic window. Model worker PCM/window messages do not carry
sourceDomainId (worker lease token identity is separate). Do not multiply a bounded
diagnostic window count by D and call it an authoritative retained history.

Character admission is not byte admission. At192 UTF-16 code units: ASCII gives192
UTF-8 bytes; repeated U+0800 gives576;96 emoji give384. Repeated NUL gives192 UTF-8
bytes but JSON string encoding occupies1154 characters including quotes, versus194
for unescaped ASCII. Result string validation requires nonempty strings, not a
universal192 cap. Comparisons, hashing, concatenation, cloning and serialization
therefore have meaningful domain-length amplification, but none of these facts
selects192 as adequate/optimal headroom or derives it from generated ID lengths.

## Candidate decision matrix

All rows concern future work; Round47 implements none. Preserving provenance shape
does not remove the existing rule that editing a selected source anchor mechanically
changes its attestation/core/composite identity values.

| Candidate | Accepted-set change | Failure owner / code | Resource effect | Valid Continuous | Valid STEP | Direct/internal callers | Result / provenance / schema | Required evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Keep all literals/checks; document | None | None | Current bounded per-ID admission, duplicated predicate ownership;192 unqualified | Unchanged | Unchanged | Same four defensive gates | No change | This audit describes roles; numerical qualification still missing |
| 2. One identity helper, all four checks retained | None for current declared primitive strings | Preserve existing locations and caller-specific codes | One admission owner, same finite string budget; no qualification | Unchanged | Unchanged | Preserve independent APIs and early failure timing | No shape/version change; future selected runtime byte edit mechanically advances identity values | Equivalence tests at0/1/192/193, Unicode/opaque grammar, ordering, both product paths and attestation checks |
| 3. Root-only validation; delete nested checks | Broadens direct lower APIs | Failures disappear or move downstream | Removes local defense unless APIs become intentionally trusted | Possibly unchanged for generated path only | Same caveat | Intentional contract/ownership change needed; not justified now | No automatic schema need, but broader evidence identities enter | Prove direct admission is deliberately outside each API, audit every caller; current public APIs contradict assuming this |
| 4. Structurally trusted generated path plus separate raw defense | Depends on new trusted/raw split | Must define distinct routes and errors | Could avoid duplicate checks, adds trust distinction; generator alone accepts arbitrary prefixes | Could remain unchanged with proof | Could remain unchanged with proof | New capability/API boundary required | No inherent shape change; provenance ownership must stay exact | Enforced generator/prefix/provider trust and preserved direct-call defense, not just short sample IDs |
| 5. Byte/payload-oriented admission | Changes Unicode/escaping and potentially ASCII admission | New accounting/failure timing may differ | More direct work budget, but requires encoding and amplification scope | Must qualify | Must qualify | Different accepted strings/cost model | Schema need not change; payload/replay compatibility must be reviewed | Explicit budget/product decision, encoding, workload/heap/headroom data and composed publication cost |
| 6. Remove cap because generated IDs are short | Accepts long nonempty direct strings | Length failures disappear | Removes finite per-string resource defense; short generator is not proof for direct APIs | Ordinary generated path unchanged | Ordinary generated path unchanged | Long strings amplify evidence work with no S17 admission budget | Shape may stay same, much larger payloads possible | Intentional exclusion of raw-call defense or replacement bounded owner; neither established |

## Round47 recommendation — implemented by Round48 above

Recommend **candidate2 only**: a pure, narrow acoustic identity-admission predicate
under the existing acoustic/runtime contract ownership, shared by all four current
checks. It must preserve the existing nonempty/length predicate, declared primitive
string accepted set, field selection, call order and boundary-specific error codes.
It must not import controllers, introduce a universal coordinator, normalize IDs,
add grammar/type hardening or delete independently callable gates. Runtime is already
the lower shared source/publication owner consumed by Continuous and STEP.

Semantic identity validity remains with session/timebase equality and source/
publication mapping/identity owners; the proposed helper owns only common admission.
The finite raw-string budget stays a resource-safety policy, not a semantic grammar:

- **192 remains**, centralized once and still unqualified; direct193-character IDs remain rejected at the same applicable fields.
- Generated IDs, suffixes, observation/publication IDs and failure codes remain unchanged.
- All four independently callable/early-failure checks remain; generated length does not replace direct API defense.
- No Result/provenance/schema/runtime-version change is required. A future selected executor source edit requires the existing mechanical byte-attestation cascade, without expanding scope.

Round48 removes duplicated admission ownership and does not qualify numeric192.
Real legitimate ID-envelope, Unicode/serialization cost, workload and
memory/headroom evidence is still absent. S17 remains UNQUALIFIED_RESOURCE_SAFETY_POLICY
in QUALIFY (numeric192); repeated ownership leaves DELETE/REDESIGN after centralization.
S17 is not numerically resolved or qualified.
Future DERIVE stays empty. Ledger remains93 rows: structural24, verified18,
empirical2, algorithm19, resource11, diagnostic7, redundant12, semantic-unresolved0.
R01/R03/R04/T15 are untouched; S09 KEEP DERIVED STORAGE, S10 KEEP DERIVED/SINGLE
OWNER and S15 KEEP EXACT CONSTRUCTION are not reopened. No recognition, learner,
clock, device, latency or memory-headroom qualification is claimed.

Round47 leaves selected source bytes, canonical/core/composite identities, Result
schema6, STEP schema8/runtimeVersion, provenance shape, timing and runtime behavior
unchanged. Identity-scope or production changes are not part of this audit.

## Round47 validation scope (historical)

The read-only module probes above are audit characterization, not added unit tests
or device qualification. The unchanged focused suite passed252 tests in10 files:
dependency boundaries, source runtime/publication, Continuous microphone input,
STEP microphone integration/assembler, timebase, core identity/attestation and
Result performance/provenance. Documentation guards passed11 tests plus structure
and link checks. Independent ledger checks verify93 stable row IDs, only S17 row
wording changed, every primary class/count/membership unchanged and DERIVE empty.
The three-document-only diff proves production/test/schema/identity bytes unchanged;
git diff --check passes. No full suite, typecheck, lint, E2E, backend, build or hosted
workflow success is inferred from this documentation audit.

## Round48 validation

The narrow boundary/identity/architecture/Result suite passed333 tests in10 files;
the broader practice suite passed1674 tests in90 files. Full Customer Web unit
validation passed2604 tests in211 files. Typecheck and lint with zero warnings pass.
Docs guards pass11 tests plus structure/links; ledger checks retain93 stable IDs,
all primary classes/counts/memberships, empty DERIVE and S17 only in QUALIFY rather
than DELETE/REDESIGN. Independent Node canonical/file verification agrees with the
Python-computed selected-source/core/composite values using CRLF→LF-only text
normalization and raw binary coefficients. Existing identity guards are unchanged.
git diff --check passes. No hosted workflow is rerun.
