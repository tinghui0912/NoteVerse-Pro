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

## Browser preparation identity

PracticePreparationKey is browser-local score/revision plus mode, inputSource and
recordingMode, compared by canonical value. It does not replace bundleId, artifactId
or ScoreRevisionPracticeBinding. Explicit Setup requests fresh authorization and
admission, then Workspace retains `{ key, bundle, binding }` in memory. Practice uses
only an exact keyed preparation. Navigation does not own resource lifetime; explicit
page commands and provider disposal do. Preferences persist; preparation and transient
Review handoffs do not. Reload requires Setup and never reconstructs device readiness.

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
access fact under locks, then `PracticeBundleWriter.ensure_binding` creates/reuses the
content-addressed Bundle and binds the revision. The null-FK creation lease commits before both representations are written through durable ObjectWriteIntents. The intent lock covers physical put and WRITTEN persistence. After both writes and exact read-back checks, fresh mutation reauthorization precedes Bundle locking, adoption of both WRITTEN intents, READY and binding creation in one semantic transaction. A partial write creates no StoredObject authority; its intent owns cleanup. Database uniqueness and row locks arbitrate
concurrent creation and binding. An existing binding wins over a new compiler candidate.

Bundle ID possession is not authorization. There is no Bundle-ID-only authorization
route. PerformanceTake score export reauthorizes its saved Score/Revision through this route
and requires exact saved bundleId and artifactId agreement. Deleted or inaccessible
revisions make score export unavailable; raw Take playback and download remain independent.

## Persistence and workflow owners

`PracticeBundleService` owns revision authorization, canonical-source lookup,
compile-on-miss and read orchestration. Bound reads ask the DB-only
`PracticeBundleRepository` for rows under shared locks, then call
`content.read_verified_bundle` while those locks remain held. They do not compile,
acquire mutation authorization or commit. Save admission uses live mutation access
and exclusive binding/bundle locks before the same content verification.

`PracticeBundleRepository()` queries and locks only bundle rows and revision
bindings, inserts creation rows, constructs references and inserts bindings. It
has no storage dependency, Score/Revision authorization, commit or rollback.

`PracticeBundleWriter` owns creation-lease transactions, Practice-owned storage
keys, ObjectWriteIntent prewrites, exact physical read-back, StoredObject adoption,
READY admission and the final binding commit. A durable CREATING lease commits
before physical IO. Prewrites release access locks, so the service-supplied
`reauthorize_mutation` action reestablishes live Score/Revision/access locks before
adoption and binding. Missing or expired creation leases fail closed. Physical
creation failure rolls back current work, discards the semantic creation through
transaction-neutral retention and commits cleanup; unadopted intents retain cleanup
ownership. An existing READY bundle is verified and reused without physical rewrite.

`content.read_verified_bundle` is the single durable-content verifier. It reads
admitted objects, checks type/size/checksum, validates the artifact structure and
musical graph, verifies canonical artifact bytes and identities, and reconstructs
the content-addressed bundle. It neither queries database rows nor owns a workflow
or transaction. Compiler and artifact contracts remain persistence-independent.

## Durable verification and retention

practice_bundles owns content identity and CREATING and READY lifecycle states.
CREATING requires a finite creation lease and null prepared_musicxml_object_id/artifact_object_id.
READY requires both physical references and no creation lease. A creation lease is not physical authority.
A READY Bundle references exactly two StoredObjects: prepared_musicxml_object and artifact_object.
Each StoredObject owns its representation locator, exact byte size, SHA256 and content type. Objects use
`practice-bundles/{bundle_id}/score.musicxml` and `artifact.json`.
Every durable read verifies exact byte counts and SHA256 values, decodes generated
artifact transport structure, validates the musical graph through backend score semantics,
then verifies artifactId, canonical JSON bytes and recomputed bundleId. Corruption fails closed.
The [score schema](../../contracts/practice/score/artifact.schema.json) owns transport
structure; Bundle envelope models reference its generated Python projection.

Only ScoreRevisionPracticeBinding rows retain a Bundle. A READY Bundle with zero bindings
is eligible for GC. Take and UploadReservation reference one immutable PerformanceTakeManifest, whose detached
provenance strings retain neither Bundle rows nor objects. Bundle GC locks the Bundle, verifies the absence of bindings and removes the semantic row. It then queues each representation's StoredObject independently through the repo-wide reference authority in the same transaction. Another domain reference protects either object without blocking Bundle removal. Stale CREATING recovery removes the semantic lease; its unadopted physical writes remain independently owned by ObjectWriteIntent.

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


`app/db/models/practice_bundle.py::PracticeBundleStatus` owns Bundle lifecycle
vocabulary. `PracticeBundleRecord.status` is typed with that enum, and its
non-native SQLAlchemy Enum projects the VARCHAR(16) status CHECK. Creation-lease
constraints reference enum members: CREATING requires a live creation expiry and
null representation IDs; READY requires both representation IDs and no creation
expiry. Repository, writer and retention consume the same enum members.
