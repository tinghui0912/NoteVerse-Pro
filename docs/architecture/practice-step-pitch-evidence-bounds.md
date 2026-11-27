# STEP Piano-Key Evidence and Raw-Work Boundary

## Cardinalities and ownership

| Quantity | Current meaning |
| --- | --- |
| Raw entries | completeAttempt accepts1..128 entries; duplicates count |
| Distinct keys | Set+numeric-sort normalization of dense valid PracticePianoKey entries |
| Source output | Practice MIDI/acoustic projections retain at most88 distinct product keys |
| Work-admission budget |128 is independently owned and unqualified; neither MIDI wire128 nor product88 derives it |

StepPracticeSession receives the same source-neutral
StepPianoKeyEvidence from both inputs. Admission checks ownership/state, capture
time, confidence, Array/nonempty/raw length, dense own indices and valid keys before
normalization, structural comparison and record retention.

Dense128 duplicate key60 entries normalize to one60. Length129 rejects before index0
access. Sparse/inherited-only entries fail STEP_ATTEMPT_EVIDENCE_INVALID, preserve
ANALYZING and the active attempt, and permit valid retry. Extra non-index properties
are irrelevant. This bounds ordinary runtime iteration/Set/sort work; caller's prior
allocation and arbitrary hostile getters/proxies are outside the work claim.

## Source and target integrity

MIDI wire-valid keys outside21..108 are ignored by the score-blind Practice adapter;
valid product keys enter a fixed first-NOTE_ON H35 interval. Acoustic publication
validates canonical pitch/midiPitch identity and sequence/coordinates before H50
retention. Practice consumes midiPitch numerically. Physical retirement excludes
stale input from subsequent attempts.

The [artifact](practice-moment-artifact.md) validates every note in the revision.
Moments own physical attacks; both modes project the same attacks. Key uniqueness
bounds each target's distinct cardinality by the explicit88-key product domain.
Scope and device readiness do not change score validity.

Exact set comparison is order/duplicate insensitive, excludes continuation and
retains missing/extra evidence as MISMATCH. Source assembly is target-blind and
keeps accepted gesture evidence. Confidence is metadata rather than a verdict gate.

## Qualification

Raw128 remains UNQUALIFIED_RESOURCE_SAFETY_POLICY. Its retained-ownership and
workload headroom need measured workload evidence before any numerical change.
H35/H50 also require learner/input-timing qualification. Correctness tests do not
qualify recognition, physical-device latency or learner intent. See
[resource semantics](practice-acoustic-resource-semantics.md) and the
[parameter inventory](practice-acoustic-parameter-provenance.md).
