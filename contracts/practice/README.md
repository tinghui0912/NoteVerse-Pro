# Practice planning contract

`score-planning-cases.json` owns language-neutral expected scope/tempo values for
admitted canonical score facts and learner selections. Python durable-save planning
and TypeScript browser execution consume these same cases. They cover leading rests,
tie sounding endpoints, range order, score-wide tempo and positive BPM rounding.

## Score artifact authority

`score/artifact.schema.json` owns serialized structure and numerical bounds.
`generate_practice_score_contract.py --check` verifies generated Python/TypeScript projections.
`score/artifact-transport-cases.json` supplies shared structural conformance cases.
Backend Practice score semantics own graph truth; the producer fixture check verifies
deterministic canonical bytes independently of structural and semantic admission.

## Original Recording Media Policy

`recording-media-policy.json` is the language-neutral authority for original AUDIO/VIDEO
recording containers, their file extensions and byte-signature families, and browser
VIDEO recorder preference order. `generate_practice_recording_media_policy.py --check`
verifies immutable Python/TypeScript projections. Browser Recording and backend
PerformanceTake adapters consume those projections; production does not read this JSON.
AUDIO uses the browser's default recorder container and validates its actual MIME.
Composite Video owns its independent local derivative encoder policy.
