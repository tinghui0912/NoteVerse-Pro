# Canonical Practice Moment Artifact

## Current contract

Round58 replaces artifact schema2 with current-only schema3 at approved parent
`e4693f5a5287717f66e2da7d30731ae7ac028f52`. There is no legacy reader, upgrade,
alias, fallback or dual writer. Artifact identity changes with the canonical payload.
The [piano-key product contract](practice-piano-key-contract.md) remains revision-wide:
every retained playable note must have an integer key21..108, before mode, source,
scope or device preparation. An invalid unused later section still rejects Practice.

Artifact schema3 has one canonical notation ownership graph and one canonical
Practice moment/physical-attack sequence. STEP and Continuous are projections, not
independent serialized target truths.

## Ownership graph

| Serialized owner | Facts owned once |
| --- | --- |
| notes | noteId, eventId reference, pianoKey, renderNoteId, measureNumber, staffId, voiceId, tieTypes |
| events | eventId, onsetBeat, durationBeats |
| moments | groupId, onsetBeat, canonicalEndBeat, attacks, continuationNoteIds |
| moment attack | attackId, pianoKey, nonempty canonical noteIds of that onset/key |

Notes reference their event; events do not mirror note IDs or notation metadata.
Every event has notation, every note has one event, and note/render identities are
revision-wide unique. Every non-continuation note belongs to exactly one physical
attack. An onset/key has one attack even when different voices/staves contribute
several notation notes. Attack pianoKey is physical attack identity, checked against
its note references; it is not a cached parallel target list.

Moments cover attack onsets chronologically. Same-onset tie-stop notes are retained
as continuation references, disjoint from attacks. Pure tie-only onsets remain in
the canonical note/event graph rather than creating an empty learning target.
canonicalEndBeat follows sounding attack-note ends through same-key/staff/voice
tie continuations, using the established beat rounding. Negative pickup onsets
remain valid chronology; no origin clamp is added.

Removed transport structures include playableEvents, expectedPracticeGroups,
practiceAttackSteps, ExpectedPracticeNote, PracticeStepNote, separate strike/attack
note copies, parallel group/step IDs, and repeated event/render/measure/staff/voice
aggregates. Validators no longer prove equality between deleted target arrays.
They defend the remaining graph: exact schema/fields, primitive numeric keys,
unique identities, references, complete membership, chronological ordering and
canonical endpoints. Malformed inputs fail without mutation, coercion or repair.

## Shared projections

Scope uses moment groupId directly; no moment↔group↔step mapping is persisted.
STEP current target's existing stepId field receives that same groupId. Its exact
attack key set comes from moment.attacks; continuation keys resolve referenced
notes and never participate in attack equality. Numeric Set+sort normalization,
structural equality, MATCH-on-rearm, MISMATCH-stays and separate Skip are unchanged.

Continuous reads the same attacks. strikeId is the attackId, performance time is
the existing tempo mapping of moment.onsetBeat relative to scope, and render IDs
resolve attack noteIds. Unison therefore yields one strike with both render IDs;
a C4/E4 chord yields two strikes. Continuation creates no second strike. Same-key
inclusive±250ms assignment, cardinality/error/earliest-noncrossing priorities and
full accepted evidence retention remain unchanged.

Score-view moment views are frozen read-only presentation projections, never
serialized. Cursor/range/feedback resolve canonical note references; the artifact
has no flat render-ID truth repeated across groups or targets. Continuation render
identity remains available through its canonical reference without adding attacks.

## Producer, transport and snapshots

Backend score_timeline constructs deterministic notes/events/moments from Partitura
and prepared MusicXML notation facts. The serializer writes only schema3. Pydantic
strict transport models reuse the graph assertion; customer OpenAPI and generated
browser DTOs describe this transport. The browser kernel independently validates
untrusted transport into its own domain model, rather than casting a DTO.

The canonical endpoint remains /artifact; /content remains stable-render MusicXML.
There is no /targets endpoint. Committed backend/browser fixture tests compare the
same deterministic schema3 artifact, including identity. PerformanceTake source
snapshots now store schema3 in their existing version field and retain exact
score/revision/artifact IDs, prepared XML/artifact checksums and immutable objects.
Authorize/finalize ownership and metadata protocol are unchanged.

## Versions and protected boundaries

STEP schema9/runtime step-piano-key-learning-v12 remain current: snapshot/evidence
shape, numeric verdict and progression semantics do not change. stepId is still an
opaque current target identity, projected from the canonical group owner. Result7
retains its existing scope group identities and evidence-provenance shape; no
Result migration is needed. Artifact3 is the only new schema boundary.

Raw128 remains an independent unqualified work budget. Raw129 rejects before
indexed reads; sparse/inherited evidence fails closed while ANALYZING stays
retryable. H35/H50/W250, MIDI grace250, count-in, model thresholds, geometry,
FIR/rates, admission/resource caps, identity192 and timeouts do not change.

All selected acoustic source/identity blobs remain byte-identical to Round57,
including model-contract, adapter implementation and identity JSON. Acoustic
pitch↔midiPitch integrity stays independent; Practice consumes validated midiPitch
numerically. Source analysis remains score/target/verdict-blind with immutable
all-pitch publication, half-open ownership and separate source/availability clocks.

## Remaining separate architecture work

This removes duplicated artifact target truth. It does not redesign the separate
artifact/prepared-XML source bundle, duplicated resource-plan derivation, device
health ownership, Continuous tempo dual input, shared session planning, STEP page
lifecycle, PerformanceTake authorize/finalize metadata, metronome construction,
error taxonomy,100MB policies or acoustic descriptor scalars. Those are not new
target owners and are not implemented here. No parameter gains qualification.

Validation covers the real producer/transport/browser fixture, unison/chord/tie
projections, corrupt graphs, revision-wide rejection, STEP evidence lifecycle,
Continuous assignment and persistence. The [parameter ledger](practice-acoustic-parameter-provenance.md)
retains93 rows and all evidence classes; Future DERIVE remains None. Test results
characterize implementation integrity, not hardware/device/model qualification.
