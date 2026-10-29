# STEP Domain Pitch Language and Raw-Work Contract

Approved baseline: `eb2fa7ad1513de3e3f44f9adb6dda6445cdc2c51` on
`refactor/practice-foundation-v2`. Round50 changed documentation only; the historical
findings below describe that baseline. Round51 implements only its comparison
recommendation from approved HEAD `c599cd0bb1b7831aab2fa4d3a011e9e15853a26e`.
The [T15 source audit](practice-step-pitch-evidence-bounds.md) records resolved
MIDI/acoustic identity boundaries. This companion addresses the remaining domain,
artifact compatibility and raw128 questions without assuming a new canonical universe.

## Round54 current audit — STEP target/evidence satisfiability

Approved baseline: `745365eb4660209d5d7f42bc537002255e240442`, branch
`refactor/practice-foundation-v2`. This is documentation/read-only characterization
only. STEP production/tests, schema8/runtime `step-exact-pitch-learning-v10`,
artifact schema1/admission, Result6/provenance, acoustic selected files/identities
and every resource/timing/language constant remain unchanged. Round53's completed
acoustic grammar deletion stays completed; its then-empty DERIVE bucket is history.

### Current owners and exact contract

| Owner | What current committed code proves | What it does not prove |
| --- | --- | --- |
| [kernel/artifact.ts](../../apps/customer-web/src/lib/practice/kernel/artifact.ts), assertPracticeScoreArtifact | Artifact schema1, identities/timeline checks, one step per group; nonempty primitive pitch strings when members exist; unique group/strike/attack sets; equality of those sets; notation/expected-note/render partitions | No D280 admission, no target128 limit, no nonempty attack-set requirement. assertTargetNotation requires notes for each existing target, not the existence of a target |
| [kernel/scope.ts](../../apps/customer-web/src/lib/practice/kernel/scope.ts), resolvePracticeScope | Reasserts the whole artifact; requires at least one expected group; FULL or ordered inclusive RANGE resolves startIndex/endIndex | Does not check that any resolved group's attack set is nonempty, D280, or satisfiable |
| [step/domain/target.ts](../../apps/customer-web/src/lib/practice/step/domain/target.ts), attackPitchesForStep | Copies step.attackTargets.map(target => target.pitch); continuation is separate | No canonicalization, filtering, grammar or cardinality validation |
| [step/domain/runtime.ts](../../apps/customer-web/src/lib/practice/step/domain/runtime.ts), constructor/currentTarget | Artifact assertion then scope resolution, index/session/timebase setup; currentTarget copies the current step's pitches | No STEP target/evidence compatibility check, even before an attempt opens |
| Same runtime, completeAttempt | Ownership/ANALYZING, capture time, confidence, Array.isArray, raw length1..128, dense own indices, primitive string and unchanged `/^[A-G]#?-?\d$/`, normalization, exact comparison, record retention | Source labels do not authenticate directly submitted evidence; no MIDI/acoustic universe is imposed on the domain |
| [step/domain/attempt.ts](../../apps/customer-web/src/lib/practice/step/domain/attempt.ts) | normalizePitchSet is Set+default sort; pitchSetsEqual compares normalized cardinality and every string by exact equality | No enharmonic conversion, delimiter serialization, empty-set exception or repair |
| [Browser MIDI](../../apps/customer-web/src/lib/practice/midi/browser-midi-controller.ts) / [STEP MIDI input](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts) | Canonical identities for integer MIDI0..127; fact consistency checked before retention; Set dedup | Source128 does not derive raw-entry128 or domain target validity |
| [acoustic decoder](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) / [source publication](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) | Canonical21..108 mapping and exact observation pair identity,88 spellings; STEP assembler deduplicates retained pitch evidence | Source88 is not the domain language or target compatibility limit |
| Backend generator / [source_schemas.py](../../backend/app/modules/practice/source_schemas.py) | Historical backend spelling/range findings below remain; typed artifact shape/physical partitions | Generated examples cannot establish browser direct-artifact admission. No repository-owned D280/128 target compatibility follows from generation |

The primitive-string domain language D280 has7 letters ×2 sharp choices ×2 sign
choices ×10 single digits =280 exact strings. It includes E#4, B#3, C-0 and G#9;
it excludes C10 and arbitrary nonempty text. Let M be the128 Browser MIDI canonical
names and A the88 acoustic names. A is a subset of M, and M a subset of D280.
Neither inclusion says every D280 target is source-reachable, nor derives a raw
array work budget. All claims below concern ordinary dense arrays/primitive strings
under the declared contract, not adversarial getters/proxies/mutated iteration.

### Necessary-and-sufficient theorem

Let T = normalizePitchSet(attackPitchesForStep(step)) for one artifact-admitted
STEP target. Fix ordinary valid ownership, clock/capture time and confidence.
There exists legal direct observedAttackPitches evidence whose normalized set
exactly equals T **iff T is nonempty, T is a subset of D280, and |T| <=128**.

Necessity: a legal dense evidence array E has1..128 entries and every entry is a
primitive D280 string. Set normalization cannot remove every entry from a nonempty
ordinary dense array, add a new string, or increase cardinality. Thus its normalized
set N(E) is nonempty, contained in D280, and has size at most128. Round51 structural
equality can MATCH T only when T has exactly those same members and cardinality.
This also rules out the old delimiter-collision escape; no serialization is involved.

Sufficiency is constructive: list T's distinct strings in an ordinary dense array,
one own entry per index, with no extras needed. The three conditions give legal
raw length1..128 and existing per-entry syntax. With an owned ANALYZING attempt,
confidence1 and a valid capture end after its start, completeAttempt accepts the
array; unchanged Set+sort normalizes it back to T; exact equality yields MATCH.
No physical MIDI/microphone fact is asserted by this direct domain construction.
Artifact admission already guarantees attack-target uniqueness, so on these valid
artifacts the raw attack-target count also equals |T|.

Consequences are conditional logic, not parameter qualification. If |T|=129, no
array of at most128 entries can have129 distinct members. If any t in T is outside
D280, no admitted array can contain it. If T is empty, no legal nonempty evidence
can normalize to it. These contradictions require no guess about learner intent,
MIDI cardinality, decoder88, physical hand size or whether128 is a good budget.
Explicit Skip can still advance a current target; that does not make an impossible
target exact-MATCHable and is not a counterexample to this theorem.

### Real artifact/runtime characterization

An external read-only Node script loads the actual TypeScript modules via the
repository TypeScript transpiler, using their real imports and the canonical
practice-score artifact fixture. It rebuilds all affected group.pitches,
strikeTargets/expectedNotes, step.attackTargets/notes, event/render identities and
aggregates consistently, then invokes assertPracticeScoreArtifact and the actual
StepPracticeRuntime constructor/open/analyze/complete/rearm path. No private target
injection, production/test edit, mock validator or proposed validator is used.
Synthetic opaque artifact IDs distinguish the probes; the browser does not
recompute a backend content digest. These are admitted browser-contract witnesses,
not claims that the backend normally generates these scores.

| Target | Browser artifact / current STEP construction | Legal direct exact MATCH? | Current MIDI identity support | Current acoustic identity support |
| --- | --- | --- | --- | --- |
| C4/E4, reordered/duplicate evidence | Both accept | Yes; duplicate/order normalization unchanged | Both identities supported | Both identities supported |
| E#4 | Both accept | Yes with direct E#4, for either inputSource label | Cannot emit E#4; F4 stays a different string | Cannot emit E#4; no enharmonic repair |
| C-1 | Both accept | Yes | MIDI0 can emit it | Below qualified21..108 |
| G#9 | Both accept | Yes | Outside0..127 mapping, which ends G9 | Outside qualified21..108 |
| C10 | Both accept | No; C10 evidence rejects with STEP_ATTEMPT_EVIDENCE_INVALID; legal C4 finalizes MISMATCH | Cannot emit it | Cannot emit it |
| Nonempty `opaque pitch` | Both accept | No; same evidence error; legal C4 yields MISMATCH | Cannot emit it | Cannot emit it |
|129 distinct D280 names: M plus E#4 | Both accept | No;129 raw entries reject, the128-member M subset yields MISMATCH | Cannot emit the complete set; E#4 is absent | Cannot emit the complete set |
|128 distinct D280 members | Both accept | Yes, densely submitted, for either label | Only if all members lie in M; probe includes non-M names | Only if all lie in A; probe does not |
| Empty attack/group set, retained step/group entry | Both accept | No; empty evidence rejects, nonempty legal C4 yields MISMATCH | No legal nonempty STEP evidence equals empty | Same |

Source columns describe identity support/obstruction, not guaranteed simultaneous
gesture recognition, physical playability, device qualification or a new source
admission rule. A normal1..128-member D280 target is directly satisfiable regardless
of whether its members belong to a physical producer's canonical set.

The empty witness removes the affected attack targets, strike targets, expected
notes and render/event aggregates consistently, retaining a real step/group with
its original finite onset/end. There is no remaining target whose notation must
be nonempty; partition and uniqueness checks hold vacuously. Other fixture groups
remain. Scope only requires at least one group, not at least one pitch per group.
Thus the whole-artifact assertion and STEP constructor accept this empty target.
This differs from **zero groups**: that artifact passes the browser assertion but
resolvePracticeScope rejects it with `Practice scope requires at least one expected
group.` No claim is made that a zero-group session can start.

Characterization also constructs each of280 singleton targets and each cardinality
1..128 through both runtime source labels:560 singleton MATCH executions and256
size-witness MATCH executions. These finite executions supplement the constructive
proof; they are not816 newly committed tests or an exhaustive powerset test.
Dense128 C4 entries still MATCH/normalize to one; a129-length array with a throwing
index0 getter rejects with zero indexed reads. No production evidence admission,
normalization/comparison, clock or state transition changes in Round54.

### Resolved scope is the future compatibility boundary

The same complete artifact has C4 at index0 and C10 at index1. At baseline, both
source labels construct all of the following:

- RANGE0..0: C4 MATCH then rearm completes the selected scope; C10 is never a target.
- RANGE1..1: C4 evidence yields MISMATCH; rearm leaves index1/generation unchanged.
- FULL: C4 MATCH/rearm exposes C10 as the next impossible target. There is no early
  target-compatibility rejection today.

Future STEP validation should cover **every attack step inside the resolved scope,
up front in the STEP constructor**, after artifact assertion and scope resolution
and before exposing interaction/session target state. A bad later selected step
must not survive until the learner reaches it. A D280/cardinality-incompatible step
outside the section must not block a section whose selected steps are satisfiable.
Whole-artifact structural validation still runs as today; out-of-scope corrupt
partitions are not excused. This distinction is STEP compatibility versus shared
artifact integrity, not target-aware source filtering. A new runtime constructed
for a different scope must check that new scope independently.

| Potential owner | Direct defense / fail-closed timing | Scope, reuse and architecture assessment |
| --- | --- | --- |
| Global assertPracticeScoreArtifact | Protects browser consumers but rejects the whole payload globally | Imposes today's STEP D280/raw-work consequences on Continuous/shared kernel and unrelated sections; no evidence authorizes that broader contract |
| Backend generation only | Can prevent some new generated targets, cannot defend direct/imported existing artifacts | Browser independently callable construction still accepts impossible targets; not sufficient and would not define browser compatibility |
| STEP constructor, entire artifact | Source-neutral and fail-closed before interaction | Rejects good selected sections due to an unused incompatible step; broader than the actual session's targets |
| STEP constructor, resolved scope | Independently callable, source-neutral; all selected targets checked before interaction | Preferred: mode-owned constraint over actual session targets; kernel/source APIs remain reusable and score-blind |
| Lazy currentTarget/openAttempt | Delays failure until exposure/open; later invalid targets may survive successful earlier interactions | Harder partial-session failure semantics, repeated reads/checks and no early assurance of selected scope; unnecessary |
| MIDI/acoustic checks | Source-dependent or bypassed by direct domain calls | Wrong owner: would leak score knowledge into aggregation/analysis and confuse source reachability with direct-domain satisfiability |

### Target-side work is separate

Artifact attack-target arrays have finite actual JS lengths but no STEP-specific
cardinality limit. On the artifact-admitted path, distinct target strings themselves
are not even bounded by D280. The browser assertion already maps/copies/sorts
physical sets, builds expected-note Maps/Sets and checks notation partitions over
the **entire** artifact. Constructor scope resolution reasserts the artifact. These
costs occur before any future STEP compatibility guard and are not bounded by
evidence raw128. Caller artifact allocation and other modes are also outside it.

currentTarget copies attack pitches and separately projects continuation. At
completion, pitchSetsEqual creates a target-side Set and sorted array in addition
to re-normalizing evidence. Current target work is governed by artifact size, not
raw evidence length; rejected evidence can short-circuit before comparison but
legal short evidence still compares against a large target. A scoped |T|<=128
compatibility check would incidentally bound subsequent selected **attack-set**
projection/Set/sort inputs to128 (artifact uniqueness is already asserted). It
would not bound total artifact/continuation/notation work, number of steps, earlier
validation, arbitrary JS object behavior or total heap. This logical relationship
does not qualify128 as a workload/device budget, and no new number is proposed.

### Candidate designs and compatibility

| Design | Correctness / product semantics | Source coupling | Work/resource consequence | Artifact compatibility / version consequence |
| --- | --- | --- | --- | --- |
| A. Keep impossible targets | Current starts/MISMATCH loops persist; an explicit product reason would be needed to retain provably unsatisfiable selected targets indefinitely | Source-neutral, no producer changes | Raw128 and unbounded target work remain | No change/version bump for no-op; no justification for intentional impossibility was found |
| B. Global D280/nonempty/128 artifact restriction | Makes all admitted targets satisfy current STEP contract, but changes shared artifact language | Couples kernel/other modes to STEP evidence/work policy | Bounds pitch sets after global admission, not prior artifact work | Rejects existing payloads even outside scope/STEP; shared compatibility contract and artifact version policy required; STEP runtime advance for changed starts; Result shape need not change |
| C. STEP compatibility of resolved scope | Rejects exactly impossible selected targets under current evidence semantics, preserving satisfiable D280 strings including E#4 | Source-neutral domain check; no source/target imports added below domain | Reuses raw128 as a compatibility parent, not a qualified/new cap; later selected target-set work bounded | Preferred narrow runtime behavior change: v10→v11, schema8 shape unchanged; artifact schema1/bytes/identity unchanged; incompatible selected scope rejects without rewriting payload; Result6 unchanged |
| D. STEP compatibility of entire artifact | Same theorem, but good selected sections fail for unused bad steps | Domain-owned, broader product rejection | Scans all steps and limits unused targets too | Runtime advance needed, schema8 can stay; no artifact rewrite/schema or Result6 change intrinsically required; no evidence favors this wider scope |
| E. Raise/remove raw128 | Could admit larger D280 targets only; empty and non-D280 targets still impossible | No source guarantee derives safe replacement | Weakens/changes raw-work protection,129 duplicates and target/evidence work; requires separate workload/API trust evidence | Changes domain evidence/start behavior, needs runtime advance; schema8/Result6 shapes may stay; no artifact rewrite by itself |
| F. Evidence accepts artifact arbitrary strings | Removes grammar obstruction, but empty and >128 targets still impossible; broadens domain semantics | Can remain domain-owned but does not prove physical producer reachability | Longer arbitrary evidence strings need separate work analysis;128 count alone is not a string-byte budget | Runtime advance and product language decision; no inherent schema8/Result6 migration; artifact bytes could stay |
| G. Canonical MIDI0..127 target/evidence universe | Removes valid direct D-minus-M identities, still requires nonempty/cardinality compatibility | Source-neutral only if independently domain-owned; cannot derive policy from Browser MIDI |128 distinct names do not derive raw iteration budget | Runtime advance, legacy target compatibility/re-encoding decision; artifact schema change only if shared contract/version changes; no automatic Result6 migration. Not justified by producer neatness |
| H. Piano21..108 target/evidence universe | Also disallows40 currently valid MIDI identities such as C-1 | Makes source-neutral STEP piano-model-specific without product evidence |88 distinct names still do not derive raw128 | Runtime and target compatibility changes; possible shared artifact version decision, no inherent Result shape change. No piano-only mandate found |

### Exactly one Round55 recommendation

Implement **candidate C only**: a STEP-owned resolved-scope target compatibility
guard implementing this theorem, with the existing D280 predicate and raw evidence
maximum as its parent contracts. Keep one domain owner of each existing relationship
when reusing them; do not copy128 or the regex into a second policy owner, choose
MIDI128/acoustic88, change evidence admission/order, or qualify the budget. After the
existing whole-artifact assertion and resolvePracticeScope, validate every selected
attack set for nonempty, D280 membership and compatible distinct count before the
runtime can expose targets/attempts. Existing asserted uniqueness can avoid an
unbounded second normalization solely to count target members.
E#4 and other directly satisfiable D280 identities remain compatible even when a
particular source cannot emit them; this is not a source-playability guarantee.

Use a distinct **STEP-domain `STEP_TARGET_INVALID`** for incompatibility, rather
than learner `STEP_ATTEMPT_EVIDENCE_INVALID`. The malformed object here is a selected
target/session contract, before any evidence. Existing artifact-structure and scope
errors keep their owners/order. The current application error projector would
otherwise mislabel an unknown constructor error as MIDI unavailable or microphone
preparation failed; the narrow future integration should map this domain error to
the existing `STEP_SCORE_UNAVAILABLE` application category and verify cleanup,
without adding source-aware target rules or redesigning acquisition. In the current
microphone controller, inference/context/start preparation precedes runtime
construction; constructor failure must use its existing cleanup path. An early
domain check guarantees before learner interaction, **not before all acquisition**.

That future change converts starts-with-impossible-target into fail-closed session
admission, so explicitly advance runtime `step-exact-pitch-learning-v10`→
`step-exact-pitch-learning-v11`.
SchemaVersion8 can remain: session/attempt record shape does not change. Keep
artifact schema1, payload/content identities and backend generation unchanged;
no rewrite of older artifacts is required, only rejection when the selected STEP
scope is incompatible. Compatible sections of the same artifact remain usable;
no dual-version hydration/migration is established. Result6 and acoustic provenance/
identity need no change. These are recommendations, not edits in Round54.

### Ledger and validation status

T15 remains primary UNQUALIFIED_RESOURCE_SAFETY_POLICY: source identities, structural
comparison, dense shape and redundant acoustic grammar cleanup remain resolved;
domain canonical-language choice and raw128 qualification remain open. Target/evidence
compatibility is now a **proved structural consequence of the current contract**
and the single future DERIVE action, not a new row or a derivation/qualification
of128 itself. DELETE/REDESIGN still covers remaining domain-language/raw-work policy;
raw128 stays QUALIFY. All93 primary rows/classes/counts stay unchanged. S17 keeps
KEEP SINGLE OWNER/NUMERIC UNQUALIFIED; R01/R03/R04 and resolved S09/S10/S15 stay intact.

Actual local validation:240 existing tests/12 files, including artifact/scope,
STEP domain/attempt/verdict/status, architecture/dependency, acoustic identity/
attestation/source adapter and Result provenance. Read-only real-module probes
cover the table, empty versus zero groups, both source labels, selected/excluded
bad steps, all280 singleton targets and sizes1..128. No production/test changes,
full-suite/typecheck/lint/backend claim or hosted rerun is part of this audit.
Documentation guards11, structure/links, independent ledger/count/membership and
all-current-attestation/canonical/composite checks pass; git diff --check passes.

## Round53 historical state — redundant acoustic grammar deleted, qualified admission equivalent

From approved HEAD `e6864c6486950d23c38a3f4d87890051b8860e50`, the only acoustic
behavior-source edit deletes SourcePublicationSequence's regex after canonical pair
equality. Integer/range21..108 and pitch===pianoMidiPitchToName(midiPitch) remain in
the same order, as do every coordinate/confidence/ID/duplicate/sequence check and
error. sourcePublication producer validation and the decoder helper are byte-unchanged.
The separate STEP domain regex is unchanged; no replacement grammar is introduced.

For each integer21..108, modulo12 selects one of the existing twelve unique natural/
sharp names, while floor(midi/12)−1 is a single digit0..8. These concatenations all
satisfy the deleted regex. Distinct pitch classes/octaves distinguish all88 inputs;
21→A0 and108→C8. Thus integer range plus exact mapping equality implies the old
regex. It had no independent rejection on qualified primitive-string observations;
deleting it neither widens nor narrows that accepted set. Exhaustive actual-helper
tests retain the old regex only as a local historical equivalence witness, not a
second production owner. This is a finite construction proof, not qualification.

All88 direct observations still accept at44100/48000, preserving values/order/IDs.
60/E4 direct mismatches retain ACOUSTIC_PUBLICATION_OBSERVATION_INVALID; worker
mismatches retain ACOUSTIC_EVENT_IDENTITY_MISMATCH. The historical280-spelling
forgery stays blocked before STEP retention. Publication errors remain fail-closed
before accepted summary advancement; no caller data is repaired. Invalid MIDI range/
integer, IDs/source coordinates/confidence, duplicates and ownership/sequence errors
remain covered independently of grammar.

Only selected publicationSource bytes/SHA change (CRLF→LF-only text normalization),
then canonical core, current model-contract core SHA and both adapter core references/
composite hashes advance mechanically. Executor/decoder/planner/adapter implementation,
model/FIR identities, STEP production code/schema8/runtime v10, D280/raw128, Round51
comparison, Round52 dense validation, artifact/source behavior and Result6/provenance
shape remain unchanged. No identity field, migration, dual acceptance or scope change.

The completed acoustic regex item leaves Future DERIVE, now **None**. T15 source
identities/comparison/dense shape and redundant grammar cleanup are resolved;
domain-language/raw-work policy remains DELETE/REDESIGN and raw128 QUALIFY. Primary
UNQUALIFIED_RESOURCE_SAFETY_POLICY and all93 row/class counts remain. S17 stays
KEEP SINGLE OWNER/numeric unqualified; R01/R03/R04 and S09/S10/S15 are unchanged.
References below to the still-present acoustic regex or its future cleanup describe
their historical rounds and are superseded by this Round53 state.

Round53 validation: focused337 tests/10 files; broader acoustic/STEP/Continuous1287/50;
broader practice1719/90; full Customer Web2649/211 passed. Typecheck, lint0 warnings,
architecture/dependency, identity/attestation and Result/schema/provenance guards
pass. Docs guards11 plus structure/links, ledger/count/membership and diff checks
pass. Independent normalized-source/canonical/composite verification agrees with
the declarations and preserves all non-publication anchors. No hosted workflow rerun.

## Round52 historical correction — dense own-index evidence, runtime v10 / schema8

From approved HEAD `aea17c1e8e7e1634d637d3050487b8d1ac093f05`, completeAttempt replaces
the hole-skipping some callback with an explicit indexed loop. After unchanged
ownership/time/confidence/Array.isArray/nonempty/raw128 checks, every index0 through
length−1 must be an own array property; its ordinarily indexed value must be a
primitive string passing the same D280 regex. Object.hasOwn runs before reading
that index. No copy/filter/fill/repair or new validation framework is introduced.

One-slot, partially sparse, leading-hole and sparse128 evidence reject with
STEP_ATTEMPT_EVIDENCE_INVALID before normalization or record construction. The
runtime remains ANALYZING with the same activeAttempt, target/index/generation and
null pendingPostVerdict; valid dense evidence can retry that same identity normally.
Dense128 duplicate C4 entries still normalize to one; length129 still rejects before
any indexed access, including a throwing index0 getter. Inherited numeric properties
cannot fill missing own entries. Extra non-index properties remain irrelevant;
ordinary own accessors can still supply valid strings. This is not a claim of
protection against hostile getters/proxies or arbitrary process resource use.

The observable malformed-direct-evidence change advances STEP runtimeVersion from
step-exact-pitch-learning-v9 to step-exact-pitch-learning-v10, retaining schema8.
Current snapshot/completion/status/microphone assertions and product documentation
use v10. No hydration/migration path is added. normalizePitchSet and Round51
pitchSetsEqual are byte-unchanged, as are D280, raw128/value/order, artifact/source
admission, backend mapping, H35/H50 and all acoustic selected sources/identity values.
Result6/provenance and session/record shape remain unchanged.

T15 source identities, exact comparison and sparse-array fail-closed shape are now
resolved. Domain pitch-language policy and raw128/target-work qualification remain
unresolved. Only domain language/raw-work policy remains DELETE/REDESIGN; raw128
stays QUALIFY. Primary resource-safety classification/all93 row counts remain;
Future DERIVE still contains only the separate acoustic post-canonical regex cleanup,
which remains in production. S17/R01/R03/R04 and resolved S09/S10/S15 are unchanged.

Round52 validation: focused324 tests/12 files, broader STEP402/15, practice1708/90
and full Customer Web2638/211 passed. Typecheck, lint0 warnings, architecture/
dependency, Result/schema and identity/attestation guards pass. Docs guards11 plus
structure/links, ledger/count/membership and diff checks pass. Independent selected
file/canonical/composite verification confirms acoustic identities unchanged. No
backend pytest or hosted workflow is rerun.

## Round51 historical correction — structurally exact comparison, runtime v9 / schema8

pitchSetsEqual now calls the unchanged normalizePitchSet on both sides, checks
equal normalized lengths and compares exact strings at each sorted index. U+001F
is an ordinary character within a member, not comparison syntax. No delimiter,
serialization/hash substitute, pitch canonicalization or source filtering remains
in equality. Duplicates and order still normalize through Set+sort. Identical opaque
strings remain equal to themselves, including strings with multiple U+001F characters.

The admitted one-target artifact C4<U+001F>E4 and admitted evidence C4/E4 now finalize
MISMATCH. Both MIDI- and MICROPHONE-labelled real runtime regressions pass the
existing artifact assertion with all physical event/notation/target references
consistent; the artifact and evidence are not repaired or rejected. The record
retains normalized C4/E4 in full. Rearm keeps index0/generation1/the same target,
matching ordinary MISMATCH progression. Normal exact-set MATCH still advances once.
This is verdict correction, not evidence or artifact admission tightening.

STEP_RUNTIME_VERSION keeps schemaVersion8 and advances runtimeVersion from
step-exact-pitch-learning-v8 to step-exact-pitch-learning-v9. Its sole owner is
attempt.ts; runtime.snapshot publishes that object. Current status/completion,
snapshot and microphone integration assertions use v9, as do the product contract
and STEP README. Source review found no multi-version STEP snapshot hydration or
restore path requiring compatibility code; none is added. Session/record shape,
artifact schema/payload admission and Result6/provenance shape are unchanged.

The evidence regex, raw128 position, normalizePitchSet, H35/H50, source fact
validation, target language and all acoustic source/identity declarations are
byte-unchanged. Sparse-hole/direct malformed-shape validation remains unresolved
and untouched. The redundant acoustic post-canonical regex remains present as the
separate Future DERIVE cleanup. T15 comparison integrity is structurally resolved;
domain language and raw-work qualification are not. Its primary class remains
UNQUALIFIED_RESOURCE_SAFETY_POLICY, with only domain language/raw work/direct shape
in DELETE/REDESIGN and raw128 in QUALIFY. All93 primary rows/classes/counts remain.

Round51 validation: focused316 tests/12 files, broader STEP394/15, practice1700/90
and full Customer Web2630/211 passed. Typecheck, lint0 warnings, architecture/
dependency, identity/attestation, Result and existing raw128/129 tests pass. Docs
guards11 plus structure/links and ledger/count/membership checks pass. Independent
file/canonical/composite verification confirms all acoustic identities unchanged;
git diff --check passes. No backend pytest or hosted workflow is rerun.

## Production owner map

| Owner | Actual responsibility | What it does not establish |
| --- | --- | --- |
| [score_loader.py](../../backend/app/processing/practice_score/score_loader.py), [Partitura adapter](../../backend/app/processing/practice_score/partitura_adapter.py) | Load prepared MusicXML, call score_part.note_array(), pass it to PracticeScoreTimeline.from_note_array | No repository-owned0..127 pitch-range assertion; disabling optional synthesis is not pitch validation |
| [score_timeline.py](../../backend/app/processing/practice_score/score_timeline.py): _midi_pitch_name | Generate sharp/natural pitch strings from an integer using a twelve-name table and octave formula | No range, canonical domain-language or resource-budget admission |
| Timeline _event_from_notes / expected notes / attack and strike targets | int(note['pitch']) then mapping; copy physical pitch into event/notation facts; group same physical strings into targets, consolidate unisons, preserve render-note ownership | Equality/grouping is not an independent musical range check; MusicXML display spelling is not used as the physical identity |
| [target_catalog.py](../../backend/app/processing/practice_score/target_catalog.py): _catalog_entry, and timeline stable target IDs | Check group/attack pitch Sets equal, copy targets; stable attack IDs hash the full pitch while _safe_id decorates the readable prefix | Neither Set agreement nor identifier sanitizing defines canonical pitch grammar or input-source range |
| [practice_score_artifact.py](../../backend/app/processing/practice_score/practice_score_artifact.py) | Serialize timeline dataclasses and camelCase pitch fields; content-derived artifact identity | Serialization/hash does not validate musical identity or supported input-source reachability |
| [source_schemas.py](../../backend/app/modules/practice/source_schemas.py) | Typed str/list[str], extra-field rejection, nonempty unique physical sets, target/notation and identity-partition consistency | No pitch regex, MIDI range, enharmonic normalization or acoustic-range limit |
| [generated API types](../../apps/customer-web/src/generated/api/types.gen.ts) | pitch:string and pitches:Array<string> transport typing | No runtime canonical-pitch admission |
| [kernel/artifact.ts](../../apps/customer-web/src/lib/practice/kernel/artifact.ts): assertPracticeScoreArtifact | Nonempty primitive physical strings, unique physical sets, equal group/attack/strike sets, note/render identity consistency, timeline structure | No canonical spelling, pitch range, target-count128 or recomputation of musical identity from notation; its variable named canonical is an expected-note identity lookup |
| [STEP target projection](../../apps/customer-web/src/lib/practice/step/domain/target.ts) | Copy attack target pitches; Set-deduplicate continuation pitches | No conversion, canonicalization or supported-source filtering |
| [StepPracticeRuntime](../../apps/customer-web/src/lib/practice/step/domain/runtime.ts): completeAttempt | Own attempt/time/confidence checks, raw1..128 admission, primitive-string syntax, normalization, target comparison, current record | No MIDI/acoustic note-number contract; inputSource labels do not authenticate directly supplied pitch evidence |
| [attempt.ts](../../apps/customer-web/src/lib/practice/step/domain/attempt.ts): normalizePitchSet / pitchSetsEqual | Exact-string Set+default sort; Round51 equality compares normalized length and each member directly | No enharmonic conversion/range check; historical Round50 join collision below is now rejected as unequal |
| [Browser MIDI](../../apps/customer-web/src/lib/practice/midi/browser-midi-controller.ts) and [STEP MIDI input](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts) | Wire NOTE_ON0..127 and canonical midiNoteToPitch; Round46 checks exact fact identity before retention | Does not own source-neutral domain language or derive domain raw128 |
| [acoustic decoder](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts) and [source publication](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts) | Qualified integer21..108 mapping through pianoMidiPitchToName; Round49 producer/direct-sequence pair integrity before STEP retention | Does not restrict MIDI to piano88 or define domain target language/raw budget |

The browser artifact is shared with Continuous. A future STEP-only language decision
must not silently tighten the shared artifact validator and thereby change another
mode. No source module may gain score/target imports to solve domain compatibility.

## Backend spelling, range evidence and its limits

_midi_pitch_name uses `C,C#,D,D#,E,F,F#,G,G#,A,A#,B`, selects `pitch % 12`, and appends
`pitch // 12 - 1`. For ordinary integer0..127 it produces128 unique strings C-1..G9.
The function itself has no0..127 check. The timeline first requires named fields
onset_beat/duration_beat/pitch/id; _event_from_notes calls int on each pitch but never
checks a MIDI range. Subsequent note/attack/strike construction copies that result.

Read-only calls through the actual timeline using the same note-array protocol as
existing tests accept -120→C-11, -12→C-2, -1→B-2,0→C-1,21→A0,60→C4,108→C8,
127→G9,128→G#9,132→C10 and1200→C99. Incoming60.9 and string '60' both become60
through int conversion. These are local callable-contract witnesses, not a claim
that Partitura normally emits those inputs or that such scores are supported.
Unconvertible values can fail conversion; int coercibility is not a range proof.

Repository-owned loader code delegates to Partitura; it does not establish a
universal range on note_array['pitch']. Any assertion that every external-parser
pitch is standard MIDI remains an external-library assumption here. No dependency
or parser validation is changed. Numeric pitch fixtures found across ten inspected
practice/metadata test files use48..81 (48,60,62,64,65,67,69,81), including the three
practice-score generation files. Static complete
MusicXML literals include C3 through A5 and ordinary naturals. These examples do
not cover0/127 or prove a maximum accepted score pitch. They are fixture evidence,
not successful local backend test execution or contract bounds. The standalone
score-domain metadata fixtures contain C4/D4/G4, adding no endpoint-range proof.

## Artifact admission and API compatibility

Read-only probes consistently replace C4 in the full artifact's pitch-bearing
event/group/expected-note/strike/attack/step structures. Artifact identities are
recomputed with the actual backend _artifact_id function before final probes.
Both the actual browser assertion and actual Pydantic PracticeScoreArtifactRead
accept the following internally consistent values:

| Physical string / structure | Browser and API artifact admission | Domain evidence syntax |
| --- | --- | --- |
| E#4, B#3, C-9, C-0, G#9 | Accept | Accept |
| C-1, C9 (canonical MIDI outside acoustic21..108) | Accept | Accept |
| C10 (canonical integer mapping outside MIDI0..127) | Accept | Reject |
| H4, whitespace, emoji | Accept | Reject |
| C4 followed by U+001F then E4, as one physical string | Accept | Reject as one evidence entry; comparison collision below |
| Empty physical pitch | Reject | Reject |
| Duplicate C4 in a physical pitch set | Browser rejects; API physical-set validator also requires uniqueness | Duplicate *evidence entries* are allowed within raw128 then deduplicated |
|129 distinct physical targets: all128 MIDI spellings plus E#4 | Accept; no target-count128 check |129 complete raw entries reject;128-entry subset cannot equal129 distinct target strings |

The129-target witness also updates playable-event pitches/render IDs, expected-note
partitions and step targets, not merely one isolated field. Multiple notation notes
with the same physical pitch can legitimately consolidate into one target; rejecting
duplicate physical targets is not rejecting unison notation. Equality of every
pitch-bearing reference establishes consistency, not a canonical musical spelling.

No stronger pitch grammar/range appears in these API string fields. Generic transport
or request-size limits are separate concerns and do not prove a pitch universe.
The probes demonstrate local admission, not occurrence in normal generated scores.

## Re-established language relationships

For primitive strings, the unchanged STEP regex `^[A-G]#?-?\d$` has exactly
7 letters ×2 sharp choices ×2 minus-sign choices ×10 ASCII digits = **280** distinct
spellings, at most4 UTF-16 code units each. Exhaustive enumeration and the real
runtime confirm representative members; trailing newline C4 followed by LF rejects.
It admits E#4/B#3, the literal spelling C-0, negative-octave C-9 and G#9. It admits
neither flats, plus signs, whitespace nor multi-digit octaves. It is not MIDI grammar.

Let D be these280 strings, M the128 canonical Browser MIDI strings and A the88
qualified acoustic strings. **A ⊂ M ⊂ D**, with |D minus M|=152 and |M minus A|=40.
The normal sources now enforce those canonical sets before shared domain evidence.
Neither Set normalization nor pitchSetsEqual changes E#4 into F4 or C-0 into C0.

For locally coercible integer backend inputs without an imposed range, backend
spelling has twelve canonical pitch classes and unbounded integer-octave notation;
it is broader than D in one direction and excludes D's E#/B# and negative-zero
spellings in another. Its intersection with D has12×19=228 strings: octaves -9..9
without a separate negative-zero spelling. The remaining52 D spellings are40 E#/B#
spellings plus12 negative-zero spellings. This is conditional mapping arithmetic,
not a proved external-score range. Browser artifact admission is broader still:
consistent nonempty strings are not restricted to D, M, A or that backend mapping.

## Round50 reachability and historical comparison gap (corrected in Round51)

| Target / evidence | Observed Round50 result | Interpretation |
| --- | --- | --- |
| Same E#4, B#3, C-9, C-0 or G#9 on both sides | MATCH through direct completeAttempt | Regex-valid identity can match without either physical producer emitting it |
| E#4 target / valid MIDI F4 | MISMATCH | No enharmonic normalization; normal MIDI can never emit E#4 |
| C9 target / valid MIDI120 C9 | MATCH | Canonical MIDI support is broader than acoustic piano88 |
| C9 target / valid acoustic C8 | MISMATCH | No acoustic event can exactly supply C9 under the current model range |
| C-1 target / direct MICROPHONE-labelled C-1 evidence | MATCH | Domain accepts direct source-neutral evidence; the label does not prove a physical microphone producer emitted it |
| G#9 target / maximum valid MIDI127 G9 | MISMATCH | G#9 is locally admissible and direct evidence can match, but no valid Browser MIDI fact emits it |
| C10 target / direct C10 evidence | STEP_ATTEMPT_EVIDENCE_INVALID | Artifact can admit a target outside current evidence language; direct evidence cannot reach comparison |
|129 ordinary regex-valid distinct targets /129 matching raw entries | STEP_ATTEMPT_EVIDENCE_INVALID | Raw admission blocks the complete set; a128-entry subset yields MISMATCH |

For these ordinary separator-free pitch identities, an exact target outside a
source's canonical set is unreachable from that source. No target-aware early
closure/filter is introduced. The following counterexample prevents extending that
statement to *all* artifact-admitted strings under the Round50 implementation:

At Round50, `pitchSetsEqual(['C4\u001fE4'], ['C4','E4'])` returned true. Both normalized arrays
join to the same string. A consistently constructed, hash-identified artifact with
that one target passes browser and API validators, and the actual domain reports
MATCH for valid canonical C4/E4 evidence. Round51 now returns MISMATCH for this same
individually admitted artifact/evidence. The target and evidence sets differ in
cardinality and members. This is a deterministic false-positive comparison gap,
not an enharmonic rule or normal physical-score example. No such broad target was
found in shipped examples. The historical audit did not fix it; Round51 corrects
only structural comparison. Changing the domain
grammar merely to hide it would mix two separate decisions.

## Raw128 evaluation order and work ownership

For an ordinary owned ANALYZING attempt, completeAttempt performs:

1. Ownership/state checks; stale calls return REJECTED before evidence processing.
2. Capture time/domain/start ordering and confidence validation.
3. Array shape, nonempty length and **length>128** short-circuit rejection.
4. Round52 dense indexed validation: Object.hasOwn at every position, then primitive-string and unchanged regex validation. Round50–51 used some, skipping holes.
5. normalizePitchSet: raw Set construction and default sorting; freeze normalized evidence.
6. currentTarget projection, then pitchSetsEqual, which normalizes both sides again and compares their lengths/elements (Round50 used join).
7. Frozen record creation/retention and transition to POST_VERDICT.

128 raw C4 entries are accepted and normalize to one C4;129 reject before step4.
A129-entry audit array with an index0 getter that would throw is rejected with
zero entry-getter reads. This small ordering probe does not promise protection from
arbitrary getters/proxies or dishonest length/iteration behavior.

The Round50–51 scan did not prove every malformed Array was a well-formed string
tuple: some skips holes. A one-slot sparse direct array historically passed it and finalized
MISMATCH with an undefined normalized entry (shown as null by JSON serialization
of the probe). Round52 now rejects that same sparse shape before normalization,
preserving active ownership and valid retry. No valid current producer emits it. D280 describes primitive
pitch strings, not a complete theorem about arbitrary JavaScript arrays. This is
a historical direct-input shape issue now resolved within T15, not a new numeric
policy or source-identity gap. Ordinary accessor/proxy behavior is not universally
qualified by that fix.

| Work / storage | What128 bounds |
| --- | --- |
| Caller's prior allocation, strings or message rate | Nothing; allocation happened before this API |
| Runtime raw-entry validation | At most128 ordinary entry visits on the admitted path; invalid data can short-circuit sooner |
| Raw Set/dedup and evidence sorting | At most128 raw iteration inputs and at most128 distinct normalized entries; algorithm/engine/heap costs are not device-qualified |
| Accepted primitive pitch payload | Each admitted D string has at most4 code units; this is not total JS memory or a raw-string defense for arbitrary malformed objects |
| Target projection and target-side normalization/sort/join | **Not bounded by raw128**; target cardinality T and continuation data come from artifact admission, which has no corresponding128 limit |
| Retained normalized current record | At most128 strings, not session/process memory; no cross-attempt accumulation is introduced |

Thus128 is a **raw-work admission budget with incidental semantic consequences**,
not a theorem about the domain pitch universe. It happens also to equal |M|, but
duplicates count before normalization. Acoustic88 derives no raw-entry bound.
Even a finite distinct universe permits arbitrarily many raw duplicate entries;
changing the check to distinct count alone would leave raw iteration work open.
D contains280 distinct strings and artifact targets can be larger/different. The
129-target witness shows a direct semantic ceiling as a consequence of a workload
policy, not a justified musical-universe limit. Why128 is an appropriate budget
remains unqualified; neither source cardinality nor these synthetic probes answers it.

## Acoustic post-mapping regex: historical redundancy proof, deleted in Round53

This was the regex in SourcePublicationSequence, **not** the domain runtime regex.
Round49 first validates integer21..108 and requires exact equality to the decoder's
pianoMidiPitchToName. Every output of that finite mapping is one of88 sharp/natural
strings A0..C8, all within D. Therefore any observation reaching the later regex
already necessarily passes it. Exhaustive actual-helper characterization confirms
all88; the implication follows from the mapping construction, not from tests alone.

The former later regex had no independently reachable rejection or extra integrity
guarantee on the current qualified mapping. It repeats a grammar that could conflict
with a future deliberate canonical-mapping change rather than validating that
future contract. Round50 recorded a narrow future deletion/DERIVE cleanup, without
a replacement bound or reopening source identity. Round53 implements only that
deletion, retains exact mapping checks and the domain regex, and mechanically
updates selected publication attestation/core/composites. The item is complete.

## Round50 candidate matrix and compatibility (historical alternatives)

| Candidate | Correctness / accepted-set effect | Work / boundedness | Architecture and valid sources | Version / artifact / Result implications | Evidence needed |
| --- | --- | --- | --- | --- | --- |
|1. Keep D and raw128 | No admission change; odd direct identities can intentionally be broader than producers. Does not fix the independent join collision | Current raw budget stays unqualified; target-side work remains separate | Source-neutral, no valid MIDI/acoustic changes; require genuinely exact set comparison for broad targets | No version/shape change for no-op; no canonicalization migration | Explicit product decision that broader direct identity is intended, target compatibility and workload evidence; producer canonicality alone is not a reason to reject it |
|2. Domain-owned canonical MIDI0..127 plus separate raw budget | Rejects previously admitted D-minus-M evidence and incompatible targets; removes legitimate direct/API possibilities unless migrated |128 distinct identities derive from that universe; raw-work budget still not derived | Domain/kernel owns contract; source adapters consume/validate without domain importing Browser MIDI/acoustic internals. Shared artifact restrictions affect other modes unless scoped | Changes v8 semantics; runtimeVersion/target compatibility policy required. Re-encode/reject legacy artifacts explicitly; schemaVersion only if format/versioned admission protocol changes. No automatic Result6 migration | Product-supported score/source universe, backend range proof, spelling/score compatibility and migration evidence |
|3. Domain-owned piano21..108 | Additionally removes40 valid current MIDI identities; unsupported MIDI-range restriction without product evidence |88 distinct identities, still no raw iteration bound | Makes source-neutral STEP depend semantically on today's acoustic range; current outside-piano MIDI behavior changes | v8 semantic/version and artifact compatibility changes; shape need not change, no automatic Result migration | Explicit piano-only product scope and score/source compatibility, not merely model88 |
|4. Canonical spelling without fixed range | Removes E#/B#/negative-zero aliases, may admit multi-digit octaves; still leaves source-unreachable targets | Unbounded octave/string representation needs its own work analysis; no derived raw128 | Could be domain-owned and source-neutral; normal canonical source output can remain identical | Tightens/broadens v8 accepted language; runtimeVersion and artifact spelling/migration policy required; shape not inherently changed | Definition of canonical octave/sign/spelling, exact physical identity, supported-range and score compatibility decisions |
|5. Target-derived evidence language | Filtering/discarding off-target pitches destroys exact MISMATCH evidence and can manufacture MATCH; not justified | Does not replace raw-entry work defense | Target validation at the domain boundary can be legitimate; target-aware source analysis/aggregation is forbidden. Preserve full evidence, compare in domain | Rejecting evidence or changing verdict/error behavior changes v8; target-validation changes need compatibility policy. No inherent Result shape requirement | A domain target-admission decision, never using targets to trim/repair source evidence |
|6. Remove raw128 because sources are bounded | Accepts129 duplicates and larger direct arrays, changing current contract | Producer dedup/finite distinct universes do not bound arbitrary raw iteration or caller allocation | Only defensible if direct/raw callers are intentionally removed/trusted or a separate finite work owner replaces it; neither is established | Direct v8 admission change requires runtimeVersion decision; record shape/Result schema need not change | Explicit API trust decision or justified replacement finite work owner; source128/88 alone insufficient |
|7. Separate semantic validator, raw-work admission and normalization | Can clarify current ownership without changing language/order; any subsequent semantic tightening is a separate decision | Raw128 remains unqualified; accepted-language cardinality and target work must stay separate | Domain-owned facts; no Browser/decoder imports or universal coordinator required | Pure equivalent refactor needs no version change; altered language/work accepted set changes v8. Artifact/Result consequences depend on that separate decision | Equivalence/order tests for refactor, then explicit semantic/product and workload evidence for changed policies |

No candidate is selected merely to remove the most literals. Current producer
canonicality does not justify silently restricting all direct domain/artifact values.
Version is about behavior as well as shape: a future change to accepted evidence,
target admission or verdicts changes the v8 runtime contract. RuntimeVersion should
advance for an observable semantic change; schemaVersion8 can remain if the session/
record shape and its interpretation protocol remain compatible. A new field/shape
or version-dispatch contract would need a schema decision. Canonicalizing/rejecting
old targets requires explicit artifact compatibility handling and new content IDs
where payloads change; it does not automatically require a Continuous Result6 migration.

## Round50 recommendation — implemented by Round51 above

Round50 recommended the smaller correctness prerequisite: **make pitchSetsEqual compare the
normalized arrays element by element, including equal cardinality, instead of
serializing them with U+001F**. Add a regression for the admitted single-string
target versus two-pitch evidence and preserve all existing ordinary exact-set cases.
This restores the declared exact-set/false-negative preference without choosing a
new pitch universe, changing artifact admission, filtering sources or changing raw128.
It is justified by an actual differing-set MATCH, not implementation cleanliness.

Round50 required treating the future verdict correction as a runtime semantic change:
advance STEP runtimeVersion in the authorized implementation round, retaining
schemaVersion8 if shape remains unchanged. No artifact payload rewrite/canonicalization
or Result6 migration is required for this comparison-only correction. Preserve
source neutrality, full evidence and ownership. Existing normal source/target
spellings have no separator, so their comparison outcomes stay the same. Round50
changed no code/version; Round51 implements the correction and runtime advance above.

At Round50, acoustic regex deletion was a separate proved future DERIVE sub-item,
not a second Round51 recommendation. Round53 completes it. Domain-language tightening and
numeric raw-work/target-work qualification remain undecided. T15 stays SOURCE
IDENTITIES RESOLVED, DOMAIN UNRESOLVED in UNQUALIFIED_RESOURCE_SAFETY_POLICY;
domain language/raw work stays DELETE/REDESIGN and raw128 stays QUALIFY;
Round51 removes comparison and Round52 removes dense-array shape from that bucket.
Future DERIVE is now **None** after Round53; historical Round50–52 states had only
this acoustic regex cleanup. No primary row is added/reclassified:93 rows, structural24,
verified18, empirical2, algorithm19, resource11, diagnostic7, redundant12,
semantic-unresolved0. S17/R01/R03/R04 are unchanged; S09/S10/S15 remain resolved.

## Audit execution and validation limits

Read-only Node characterization transpiles the actual current modules in memory;
no repository source/test is rewritten. Pure backend timeline/schema modules are
loaded directly without application startup, and the actual backend artifact-ID
function recomputes probe identities. This isolates initialization, not validators.
Evidence includes unusual target/evidence outcomes, API/browser agreement, all88
post-mapping regex outputs, raw128/129 ordering and the comparison collision.

Existing focused frontend tests passed244 tests in12 files: STEP domain/attempt,
artifact, architecture, decoder/publication, identity/attestation and Result provenance.
The standard pytest attempt for backend practice-score timeline/artifact/loader
aborted during collection because application Settings lacked18 required values;
no backend tests executed. The available Python is3.13, while the project declares
3.12, and numpy is absent. No environment, dependency or workflow was changed to
force that suite. Pure-module probes and inspection of fixture48..81 are not reported
as backend pytest success. Full suite/typecheck/lint/E2E/build are not inferred.

Documentation guards, structure/links, ledger/count/membership and diff checks are
reported in completion. All production/test/schema/version/identity bytes remain
unchanged, including selected acoustic anchors and canonical/composite digests.
Round50 neither implements the comparison fix nor deletes the redundant regex.
