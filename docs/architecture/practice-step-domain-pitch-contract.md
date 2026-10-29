# STEP Domain Pitch Language and Raw-Work Contract — Round50 Audit / Round51 Correction

Approved baseline: `eb2fa7ad1513de3e3f44f9adb6dda6445cdc2c51` on
`refactor/practice-foundation-v2`. Round50 changed documentation only; the historical
findings below describe that baseline. Round51 implements only its comparison
recommendation from approved HEAD `c599cd0bb1b7831aab2fa4d3a011e9e15853a26e`.
The [T15 source audit](practice-step-pitch-evidence-bounds.md) records resolved
MIDI/acoustic identity boundaries. This companion addresses the remaining domain,
artifact compatibility and raw128 questions without assuming a new canonical universe.

## Round51 current state — structurally exact comparison, runtime v9 / schema8

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
4. Present-entry typeof-string and regex checks via some.
5. normalizePitchSet: raw Set construction and default sorting; freeze normalized evidence.
6. currentTarget projection, then pitchSetsEqual, which normalizes both sides again and compares their lengths/elements (Round50 used join).
7. Frozen record creation/retention and transition to POST_VERDICT.

128 raw C4 entries are accepted and normalize to one C4;129 reject before step4.
A129-entry audit array with an index0 getter that would throw is rejected with
zero entry-getter reads. This small ordering probe does not promise protection from
arbitrary getters/proxies or dishonest length/iteration behavior.

Nor does it prove every malformed Array is a well-formed string tuple: some skips
holes. A separate one-slot sparse direct array passes that scan and finalizes
MISMATCH with an undefined normalized entry (shown as null by JSON serialization
of the probe). No valid current producer emits this shape. D280 describes primitive
pitch strings, not a complete theorem about arbitrary JavaScript arrays. This is
an additional unresolved direct-input shape issue within T15, not a new numeric
policy, source-identity gap or authorization to change validation in Round50.

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

## Acoustic post-mapping regex: proved redundant, still present

This is the regex in SourcePublicationSequence, **not** the domain runtime regex.
Round49 first validates integer21..108 and requires exact equality to the decoder's
pianoMidiPitchToName. Every output of that finite mapping is one of88 sharp/natural
strings A0..C8, all within D. Therefore any observation reaching the later regex
already necessarily passes it. Exhaustive actual-helper characterization confirms
all88; the implication follows from the mapping construction, not from tests alone.

The later regex has no independently reachable rejection or extra integrity
guarantee on the current qualified mapping. It repeats a grammar that could conflict
with a future deliberate canonical-mapping change rather than validating that
future contract. It is a narrow **future deletion/DERIVE cleanup** sub-item, with
no replacement bound and no source-identity gap reopened. It remains unchanged in
Round50. A future deletion must retain exact mapping checks, update selected
publication attestation mechanically, and preserve the distinct domain regex.

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

The redundant acoustic regex deletion remains a separate proved future DERIVE
sub-item, not a second Round51 recommendation. Domain-language tightening and
numeric raw-work/target-work qualification remain undecided. T15 stays SOURCE
IDENTITIES RESOLVED, DOMAIN UNRESOLVED in UNQUALIFIED_RESOURCE_SAFETY_POLICY;
domain language/raw work/direct shape stays DELETE/REDESIGN and raw128 stays QUALIFY;
Round51 removes the completed comparison correction from that bucket.
Future DERIVE is therefore **not empty**: it contains only this post-mapping acoustic
regex cleanup. No primary row is added/reclassified:93 rows, structural24,
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
