# Canonical Practice Piano-Key Contract

## Product ownership

Round57 supersedes the Round50–56 string-language and selected-scope designs by an
explicit product decision: Practice identity is `PracticePianoKey`, an integer MIDI
key21..108 (A0..C8,88 physical keys). This domain belongs to backend
`processing/practice_score/piano_key.py` and browser `practice/kernel/piano-key.ts`.
It is not derived from the acoustic model. Enharmonic spelling belongs to notation,
not physical matching. No string whitelist, conversion round trip or current D280
Practice grammar remains.

Practice readiness is revision-wide and independent of STEP/Continuous,
MIDI/microphone, FULL/RANGE, scope, browser permissions and device readiness.
Section selection changes progression indexes/beats only. An invalid note in an
unused section still invalidates the revision for Practice.

## Authoritative producer and transport boundary

Partitura already supplies numeric note facts. The timeline validates every retained
playable key without truncation/coercion, including continuation notes. Out-of-domain
keys or no playable attack groups raise `PracticeScoreInvalidError`; no notes are
clamped, transposed, filtered or repaired. Same-key multi-voice notation aggregates
one physical target while retaining every note/render/staff/voice identity. Ties
retain their existing continuation semantics.

`practice_score_artifact.py` serializes that valid timeline as schema3, the only
current transport. One canonical note/event graph and one moment/physical-attack
sequence own target truth; STEP and Continuous only project it. Physical identity
is `pianoKey`. Artifact and nested target identities are deterministic from
the schema3 payload. There is no schema1/schema2 reader, upgrade, alias or fallback.
`PracticeSourceService` maps only the specific deterministic contract error to422
`practice_score_invalid`, logging the internal reason. Unexpected parser, storage,
serialization or invariant failures remain503 `practice_source_failed`.

Generated API DTOs describe transport. The browser kernel owns separate domain
shapes and `parsePracticeScoreArtifact`/`assertPracticeScoreArtifact`: schema3,
nonempty revision/groups/targets, valid keys throughout, unique physical targets,
complete attack/continuation reference membership, note/event/render ownership
and exact chronological endpoints. Malformed data fails without coercion or repair. Independently callable
mode/scope boundaries reuse that artifact owner; they do not define another domain.

Metronome infrastructure consumes a minimal meter/timing projection; it no longer
fabricates an empty PracticeScoreArtifact to stand in for rhythm data.

The unused `/practice/.../targets` route, service, target-catalog module, DTOs and
catalog tests are deleted. Repository consumers use the canonical `/artifact` and
stable-render-identity `/content` endpoints. Source snapshots record schema3 in
existing numeric storage columns; no database migration or legacy reader is needed.

See [canonical moment artifact](practice-moment-artifact.md) for the schema3 graph,
projection and source-snapshot contract.

## Source adapters and evaluation

Raw Browser MIDI retains integer noteNumber0..127 and NOTE_ON/OFF wire semantics.
The redundant pitch-name field/table/converter is deleted. MIDI→Practice adapters
ignore wire-valid notes outside21..108 before opening/retaining a gesture or
publishing a Continuous observation. That score-blind domain filter does not fail
an otherwise valid session and never uses target knowledge. Malformed wire facts
still fail closed. H35 and duplicate grouping are unchanged.

The independent acoustic source contract still attests exact `pitch + midiPitch`
identity. Its decoder/executor/publication/planner/FIR/source-adapter bytes are
unchanged. STEP and Continuous Practice adapters consume `midiPitch` directly;
Practice evaluation does not retain a parallel string identity. Source analysis
remains score-blind and imports no artifact, target, scope or verdict.

STEP schema9/runtime `step-piano-key-learning-v12` exposes `StepPianoKeyEvidence`,
`observedAttackKeys`, `attackKeys` and `continuationKeys`. `normalizePianoKeySet`
performs Set plus numeric ascending sort; `pianoKeySetsEqual` compares normalized
cardinality and every exact numeric member. Missing/extra keys mismatch; duplicate
and input order do not matter. Continuation stays outside attack equality. MATCH
advances once only on rearm, MISMATCH stays, and Skip is separate.

Raw128 is still an unqualified work-admission policy, not derived from88. Raw129
rejects before indexed reads; accepted evidence is nonempty, dense own-indexed,
and valid-key throughout. Sparse/inherited-only/malformed evidence remains
ANALYZING and retryable; no evidence is filtered or fabricated. The former
selected-target loop, D280 predicate and STEP_TARGET_INVALID projection are deleted.
Whole artifact assertion precedes scope resolution and ordinary STEP initialization.

Continuous observations/strikes/cohorts/assignments use `pianoKey`. Same-key matching
keeps inclusive±250ms, maximum cardinality, minimum absolute error, then earliest
chronological noncrossing reconstruction. All accepted observations remain retained.
Assignment identity is `CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5`;
MIDI evidence identity is `MIDI_PIANO_KEY_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V3`.
Result schema7 is the only current reader/writer, with unchanged evidence-provenance
shape and unchanged acoustic identity values. There is no Result6 compatibility.
H35/H50/W250/MIDI grace250 and every recognition/resource/timing parameter remain
unchanged and acquire no qualification from this representation change.

## Route-family admission and resources

`usePracticeSource` is shared by Setup and Practice: resolve exact revision, pin it
in the URL, load/validate the immutable schema3 artifact through the shared TanStack
Query key/cache. Setup then permits configuration and explicit fresh environment
Prepare. Invalid-score copy is localized in English/Chinese, Prepare is unavailable,
and changing mode/input/section cannot repair score validity. No permission probe,
getUserMedia, MIDI or acoustic acquisition is needed to discover invalidity.
Infrastructure source failures remain separate from deterministic score rejection.

Direct Practice entry remains defensive: invalid source redirects to pinned Setup,
provides no artifact to session orchestration, disables Device Lease creation and
cannot auto-arm/start/record/create a completion. Environment/readiness requirements
remain score-blind and have no score-validity policy. No manual STEP Start is added.

## Ledger and compatibility disposition

T15 product identity, revision-wide validity, scope independence and physical set
comparison are resolved. Its only remaining numeric debt is raw128 workload
qualification/possible workload redesign. It remains resource-safety, not a bound
derived from88. S17 remains single owner/numeric unqualified; R01/R03/R04 and all
resolved acoustic derivations retain their dispositions. Future DERIVE is None.

Artifact3, STEP9/v12 and Result7 are clean development-contract replacements. No
production users exist and no hydration, migration, dual schema or retired identity
acceptance is introduced. The [Round56 release gate](practice-foundation-release-gate.md)
is historical evidence and is superseded by this explicit product decision, not a
current final release approval. See the [product contract](practice-product-contract.md),
[pitch-evidence resource audit](practice-step-pitch-evidence-bounds.md) and
[parameter ledger](practice-acoustic-parameter-provenance.md).
