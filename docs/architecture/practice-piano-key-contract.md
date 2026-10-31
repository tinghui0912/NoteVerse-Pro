# Practice Piano-Key Contract

## Product domain

PracticePianoKey is an integer MIDI key21..108:88 physical piano keys A0..C8.
This is an explicit Practice product domain, owned by backend
modules/practice/score/piano_key.py and browser practice/kernel/piano-key.ts.
Enharmonic spelling belongs to notation; physical evaluation compares numeric keys.
The domain is independent of input source and acoustic model vocabulary.

Practice admission validates the entire pinned score revision before mode, source,
FULL/RANGE selection, browser permission, Device Lease or Environment preparation.
Every retained playable note, including continuations and unused sections, must have
a valid key. Booleans, fractional values, strings and out-of-domain keys fail without
coercion, clamping, transposition or filtering. Empty/no-target revisions fail.

## Artifact and source boundary

[Artifact schema3](practice-moment-artifact.md) owns canonical notes, events and
chronological moments with physical attacks and continuation references. A key/onset
has one attack containing all unison notation identities across voices/staves.
Backend deterministic construction and browser strict parsing validate this graph.
Scope selects indexes/beats from an admitted revision.

PracticeSourceService exposes one `/source` resource containing the artifact, optional
prepared-MusicXML notation and source_id. See [Practice Source](practice-source.md).
Deterministic PracticeScoreInvalidError maps to422 practice_score_invalid; unexpected
parser/storage/serialization/invariant failures map to503 practice_source_failed.
Generated DTOs describe transport; the kernel parser owns revision-wide semantic
admission. Planning and mode execution consume that admitted runtime artifact.

usePracticeSource pins exact revision identity and delegates transport parsing to the
canonical Source query. Setup Start Practice requests fresh artifact-only admission
before qualification. Invalid scores block that revision's preparation and resource
creation; direct Practice entry renders the error in place with user-controlled Setup
navigation. Score validity is independent of device readiness. Localized invalid-score feedback preserves that
distinction.

## Source adapters

Browser MIDI supplies integer noteNumber0..127 with NOTE_ON/OFF wire semantics.
Practice adapters ignore wire-valid keys outside21..108 before opening/retaining
gestures or publishing observations. The filter is score-blind. Malformed wire
facts fail closed. H35 owns the fixed first-NOTE_ON half-open aggregation interval.

Acoustic sources independently validate the decoder-owned canonical pitch/midiPitch
pair for MIDI21..108, immutable all-pitch observations, chronology and publication
identity. Practice adapters consume validated midiPitch numerically. H50 owns
physical gesture coverage and retirement. Neither source repairs targets or uses
score/verdict knowledge.

## Evaluation and versions

STEP schema9/runtime step-piano-key-learning-v12 uses StepPianoKeyEvidence with
observedAttackKeys, exact attackKeys and continuationKeys. normalizePianoKeySet is
Set plus numeric ascending sort; pianoKeySetsEqual compares normalized cardinality
and every member. Missing/extra keys mismatch; continuation is excluded. MATCH
advances once on rearm, MISMATCH stays, and Skip is separate.

Raw evidence length1..128 is a separate unqualified work-admission budget. Length129
rejects before indexed reads. Accepted arrays are dense own-indexed valid-key arrays.
Malformed evidence remains ANALYZING and retryable.88 distinct product keys does not
derive128 raw entries. See [STEP evidence](practice-step-pitch-evidence-bounds.md).

Continuous uses same-key inclusive±250ms matching: maximum cardinality, minimum
absolute error, then earliest chronological noncrossing ownership. All accepted
observations are retained. Assignment identity is
CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5; MIDI evidence identity is
MIDI_PIANO_KEY_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V3. Result schema7 binds evidence
and timing provenance. Acoustic implementation identities have their separate
[selected-source boundary](practice-acoustic-identity-boundary.md).

H35/H50/W250, MIDI grace250 and resource budgets describe current behavior. Their
optimality, generalization and supported-workload headroom require separate evidence
as recorded in the [parameter inventory](practice-acoustic-parameter-provenance.md).
