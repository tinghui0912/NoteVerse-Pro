# Practice Bundle

## Content and ownership

PracticeBundle owns immutable Practice representations: prepared MusicXML canonical bytes
and PracticeScoreArtifact canonical JSON bytes. It contains no Score, Revision, user,
title or authorization facts. PracticeScoreArtifact schemaVersion 1 contains musical
content only; its artifactId is derived from that content.

ScoreRevisionPracticeBinding owns the revision association. Its revision_id primary key
references score_revisions with ON DELETE CASCADE. Its bundle_id references
practice_bundles with ON DELETE RESTRICT. One revision has at most one binding;
one Bundle supports many bindings, including revisions of different Scores.

## Construction and identity

The bundle compiler accepts canonical revision MusicXML bytes, prepares stable notation
IDs, compiles the [Practice score](practice-score-compiler.md), projects its exact tick
timeline and produces a content-only artifact. The same musical inputs produce identical
artifact and representation bytes independently of Score/Revision ownership.

The bundleId has the form `practice-bundle:<sha256>`. Its digest covers a canonical JSON
manifest containing bundleSchemaVersion, artifactSchemaVersion, preparedMusicxmlSha256
and artifactSha256. Sorted keys, compact separators and UTF-8 define canonical bytes.
Ownership, timestamps, binding IDs and storage locators do not participate in identity.

## Revision read and authorization

The authenticated endpoint is:

```text
GET /practice/scores/{score_id}/revisions/{revision_id}/bundle?include_notation=true
```

The response separates ownership from content:

```text
binding: { score_id, revision_id, bundle_id }
artifact: PracticeScoreArtifact
notation: null | { musicxml, mime_type }
```

The service uses ScoreAccessPolicy PRACTICE authorization, then looks up the revision binding.
Existing-binding reads acquire shared Binding/Bundle row locks, so readers coexist and
GC cannot delete representation bytes during verification. They acquire no Score or
membership write locks and do not enter mutation admission. The request session releases
shared locks on close; the application read commits no domain mutation.

An existing binding selects the verified READY Bundle without canonical revision source access, MusicXML
materialization, ID preparation or compilation.

An unbound revision is compiled after initial read authorization. Before binding mutation,
lock_live_practice_mutation_access reauthorizes the live Score/Revision and selected
access fact under locks, then the repository creates/reuses the content-addressed Bundle
and binds the revision. A durable creation-lease commit is followed by fresh mutation
reauthorization before binding. Database uniqueness and row locks arbitrate
concurrent creation and binding. An existing binding wins over a new compiler candidate.

Bundle ID possession is not authorization. There is no Bundle-ID-only authorization
route. Saved Take score export reauthorizes its saved Score/Revision through this route
and requires exact saved bundleId and artifactId agreement. Deleted or inaccessible
revisions make score export unavailable; raw Take playback and download remain independent.

## Durable verification and retention

practice_bundles owns content identity and CREATING and READY lifecycle states.
It references exactly two StoredObjects: prepared_musicxml_object and artifact_object.
Each StoredObject owns its representation locator, exact byte size, SHA256 and content type. Objects use
`practice-bundles/{bundle_id}/score.musicxml` and `artifact.json`.
Every durable read verifies exact byte counts and SHA256 values, decodes generated
artifact transport structure, validates the musical graph through backend score semantics,
then verifies artifactId, canonical JSON bytes and recomputed bundleId. Corruption fails closed.
The [score schema](../../contracts/practice/score/artifact.schema.json) owns transport
structure; Bundle envelope models reference its generated Python projection.

Only ScoreRevisionPracticeBinding rows retain a Bundle. A READY Bundle with zero bindings
is eligible for GC. Take and UploadReservation reference one immutable PerformanceTakeManifest, whose detached
provenance strings retain neither Bundle rows nor objects. Bundle GC locks the Bundle, verifies the absence of bindings and removes the semantic row. It then queues each representation's StoredObject independently through the repo-wide reference authority in the same transaction. Another domain reference protects either object without blocking Bundle removal. Stale CREATING recovery uses the same release path.

Binding creation and GC serialize through Bundle/Binding database locks. A binding that wins retains the Bundle. GC that wins removes that generation; subsequent construction uses normal content-addressed creation and safe StoredObject acquisition. Shared durable-read locks fence GC until representation verification completes. Physical deletion is owned by StoredObjectRetirement and never runs synchronously in Bundle GC.

## Save and browser admission

New save admission accepts `practice_binding: {score_id, revision_id, bundle_id}`.
Both binding creation and new save use lock_live_practice_mutation_access.
Locks follow Score, Revision, selected access fact, binding, Bundle order. Admission reauthorizes the exact
revision and verifies its exact READY bound Bundle before server-side canonical planning.
Deletion that commits first denies a new save. Admission creates an immutable
PerformanceTakeManifest containing provenance, resolved scope/tempo and score timebase.
Reservation and Take share that exact Manifest row; finalize requires no Bundle read.

The browser bundle package validates the binding envelope and uses the generated structural
decoder for the content-only artifact. It does not re-prove the backend musical graph. AdmittedPracticeBundle contains a readonly binding, deeply frozen artifact,
and prepared musicXml. PracticePlan carries the binding and artifact projection;
notation remains admitted rendering/Review representation. Review, Save and VideoExport
read executed binding truth rather than inferring ownership from artifact content.
