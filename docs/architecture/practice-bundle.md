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

The service authorizes the revision, then looks up its binding. An existing binding
selects the verified READY Bundle without canonical revision source access, MusicXML
materialization, ID preparation or compilation. An unbound revision is compiled and
bound to a READY content-addressed Bundle. Database uniqueness and row locks arbitrate
concurrent creation and binding. An existing binding wins over a new compiler candidate.

Bundle ID possession is not authorization. There is no Bundle-ID-only authorization
route. Saved Take score export reauthorizes its saved Score/Revision through this route
and requires exact saved bundleId and artifactId agreement. Deleted or inaccessible
revisions make score export unavailable; raw Take playback and download remain independent.

## Durable verification and retention

practice_bundles stores immutable representation fingerprints and physical locators,
with CREATING, READY and DELETING lifecycle states. Objects use
`practice-bundles/{bundle_id}/score.musicxml` and `artifact.json`.
Every durable read verifies both exact byte counts and SHA256 values, artifact schema,
artifactId, canonical JSON bytes and recomputed bundleId. Corruption fails closed.

Only ScoreRevisionPracticeBinding rows retain a Bundle. A READY Bundle with zero bindings
is eligible for GC. Take and UploadReservation store immutable provenance snapshots
without retaining Bundle rows or objects. The practice_bundle_delete_outbox worker
rechecks DELETING status and absence of bindings under the Bundle lock before deleting
its exact physical objects. A new binding cannot attach to a DELETING Bundle.

## Save and browser admission

New save admission accepts `practice_binding: {score_id, revision_id, bundle_id}`.
Locks follow Score, Revision, binding, Bundle order. Admission reauthorizes the exact
revision and verifies its exact READY bound Bundle before server-side canonical planning.
Deletion that commits first denies a new save; admitted reservations retain their
self-contained provenance, scope, tempo and score-timebase snapshot for replay/finalize.
Take copies that snapshot without a new Bundle read.

The browser bundle package validates the generated transport envelope and content-only
artifact. AdmittedPracticeBundle contains a readonly binding, deeply frozen artifact,
and prepared musicXml. PracticePlan carries the binding and artifact projection;
notation remains admitted rendering/Review representation. Review, Save and VideoExport
read executed binding truth rather than inferring ownership from artifact content.
