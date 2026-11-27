# Practice planning contract

`score-planning-cases.json` owns language-neutral expected scope/tempo values for
admitted canonical score facts and learner selections. Python durable-save planning
and TypeScript browser execution consume these same cases. They cover leading rests,
tie sounding endpoints, range order, score-wide tempo and exact finite positive Custom BPM.

## Score artifact authority

`score/artifact.schema.json` owns serialized structure and numerical bounds.
`generate_practice_score_contract.py --check` verifies generated Python/TypeScript projections.
`score/artifact-transport-cases.json` supplies shared structural conformance cases.
Backend Practice score semantics own graph truth; the producer fixture check verifies
deterministic canonical bytes independently of structural and semantic admission.

## Original Recording Media Admission

`recording-media-admission.json` owns cross-runtime durable admission for original
AUDIO/VIDEO recordings: media kind, canonical MIME, filename extension and container
byte-signature family. `generate_practice_recording_media_admission.py --check` verifies
immutable Python/TypeScript descriptors consumed by the PerformanceTake and browser
Recording admission adapters. Production does not read this JSON.

Customer Web's recorder capability module owns VIDEO MIME/codec candidate preference.
Every candidate normalizes to a durably admitted VIDEO MIME. Backend admission has no
browser recorder ordering. AUDIO uses the browser's default recorder container. Both
modes validate the actual MediaRecorder MIME against durable admission.
Composite Video owns its independent local derivative encoder policy.

## RecordingTimebase structure and semantics

`recording-timebase.schema.json` owns exact serialized fields, required properties,
array cardinality and primitive JSON-safe integer bounds. The stdlib-only
`generate_practice_recording_timebase.py` owns the cross-field semantic implementation
and projects complete Python Pydantic models and TypeScript validation. Its predicates
require positive, equal segment durations, a zero media origin, exact nominal end,
non-overlapping performance segments and contiguous media segments. `--check` verifies
both generated projections. Production consumes them without reading the schema file.

`recording-timebase-cases.json` is a cross-runtime conformance corpus for the generated
validators. Customer Web's `recording/recording-timebase.ts` owns immutable decoding,
runtime unit conversion and browser media-time mapping, including decoded-duration
adaptation; those playback algorithms remain separate from durable validity.
