# Backend Settings Ownership

`backend/app/core/config.py` is the authoritative environment-variable schema.
It currently contains roughly one hundred fields and is read directly by about
sixty backend modules. This document records the ownership boundary before
splitting its implementation; it does not change any environment variable name
or supply compatibility aliases.

## Current ownership map

| Configuration group | Primary owner | Runtime consumers | Representative fields |
| --- | --- | --- | --- |
| Platform and customer HTTP | API | API, Practice, Worker shared auth helpers | `PROJECT_NAME`, `API_V1_STR`, `DEBUG`, customer cookie/CSRF settings, `BACKEND_CORS_ORIGINS`, `TRUSTED_PROXY_CIDRS` |
| Control-plane identity | Control Plane | Control Plane only | `CONTROL_PLANE_*`; resolved through `app.core.control_plane_settings` |
| Observability | Platform | API, Practice, Control Plane, observability exporter | `LOG_FORMAT`, `OTEL_*` |
| Database and cache | Platform | API, Practice, Worker, Beat | `DATABASE_URL`, `SYNC_DATABASE_URL`, `SCHEDULER_LOCK_DATABASE_URL`, Redis and Celery URLs |
| Worker scheduling and reliability | Worker | Worker, Beat, API dispatch/outbox writers | import, render, playback, mail, notification, realtime, retention, and scheduler timing settings |
| Object storage and file lifecycle | Storage | API, Worker, Practice | `FILE_STORAGE_BACKEND`, `S3_*`, storage/work roots, upload extensions |
| OMR, OCR, rendering, playback | Worker | Worker and runtime checks | `LEGATO_*`, `PADDLEOCR_*`, Hugging Face cache settings, `VEROVIO_*`, playback soundfont settings |
| Practice alignment | Practice | Practice runtime and API-side session helpers | practice soundfont, alignment and diagnostics settings |
| Account email | API | API auth/account and Worker mail delivery | `RESEND_*`, sender, password-reset and verification lifetimes |
| Interactive fingering | API | API fingering service | `FINGERING_*` |

## Measured constraints

- Setting groups own their validation: task deadlines, storage backend, model
  engines, secret values, URLs, and runtime paths must move with their
  fail-fast validation rather than being reimplemented by a caller.
- Database, queue, storage, and Worker-reliability fields cross runtime
  boundaries. They cannot be assigned to a single deployment merely because
  one caller reads them most often.
- Control-plane settings are already an intentional role-specific projection.
  Its cookie and CORS policy must remain separate from customer settings.

## Extraction contract

1. Keep `Settings` as the only environment-variable loader until a complete
   configuration group and its validators move together.
2. Preserve each existing variable name and validation behavior. Do not add
   deprecated names, fallback values, or dual-read compatibility code.
3. Each extracted group must have one owner, direct validation tests, and a
   documented list of runtime consumers.
4. Migrate all direct consumers of one group in the same change; delete the
   former declarations immediately.
5. Keep deployment configuration role-explicit. A Worker-only setting must not
   become an implicit API requirement after extraction.

## Configuration taxonomy and source of truth

The word "configuration" does not determine its storage. Choose the source of
truth according to **what changes the value** and **how it must be released**.

| Kind | Examples | Source of truth | Change control |
| --- | --- | --- | --- |
| Deployment/runtime configuration | URLs, credentials, replica capacity, queue timing, timeouts, model locations, tracing endpoint | Local: untracked `.env.docker`; production: reviewed deployment configuration plus secret store | Environment promotion and operational change review |
| Versioned domain/algorithm profile | `PracticeAudioProfile` gates and frame rate; OCR classification thresholds; MusicXML layout constants | Typed source module adjacent to its owning algorithm, with fixtures/tests | Normal code review and application release |
| Product policy that operators or customers must change without a deployment | entitlement limits, tenant rules, feature rollout state | Audited database-backed configuration or feature-flag service | Explicit administration workflow, audit trail, validation, rollout and rollback |

`app.processing.engines.practice_audio_profile` is correctly a versioned audio
processing profile: every value is coupled to the 30 fps pipeline and its
fixture matrix. `app.processing.text.config` similarly owns deterministic OCR,
classification, and MusicXML layout rules. They must not be copied into
`.env.docker`, because an unreviewed per-environment threshold change would
make the same source revision produce different recognition or notation output.

For these domain profiles, maintain one typed, immutable owner module per
algorithm; give values domain units in their names; document the empirical or
product rationale next to non-obvious values; and update fixtures and regression
tests in the same pull request. Do not introduce a generic YAML/JSON settings
loader merely to move constants out of Python: it weakens typing, discovery,
validation, and code-review locality without adding a real runtime requirement.

When a profile genuinely needs runtime selection, introduce an explicit
versioned profile identifier and an allowlisted registry, validate it at startup,
record the selected version in job/result metadata, and promote it as deployment
configuration. Do not permit arbitrary individual threshold overrides. Mature
products use this separation to retain reproducibility while still allowing a
controlled, auditable rollout of a fully tested profile.

Settings group modules must remain pure: they may use the standard library and
configuration-validation libraries, but must not import `app` runtime modules.
`backend/tests/test_settings_architecture_contract.py` enforces this boundary.

## Recommended migration order

1. **Observability settings:** small, cohesive, and cross-runtime without
   business-domain behavior.
2. **Practice diagnostics settings:** cohesive and already bounded by the
   Practice runtime.
3. **Worker model and engine settings:** migrate OMR/OCR/rendering/playback as
   one validated group after Worker model smoke coverage is available.
4. **Storage and database/queue settings:** move only after their cross-runtime
   consumers are explicitly mapped in code, because they are release-critical.
5. **Worker scheduler/reliability settings:** split by outbox domain only when
   dispatch services have stable ownership modules.

This order deliberately does not start with database or secret settings. Those
settings are high-impact and should first be moved out of committed local
configuration through a separately coordinated credential-rotation task.

## Extraction status

- **Complete:** Observability, Practice diagnostics, Playback synthesis, and
  Worker model/engine configuration. `PlaybackSettings` owns the SoundFont,
  sample rate, and duration limit used by API delivery and Worker generation.
  `WorkerModelEngineSettings` owns Hugging Face/PaddleOCR model locations and
  offline mode, LEGATO selection/runtime parameters, and Verovio rendering.
  It intentionally does not own either playback or Practice soundfonts.
- **Complete:** Task-reliability deadline configuration. `TaskReliabilitySettings`
  owns the ordered processing, Celery soft-limit, and Celery hard-limit
  envelope. It remains shared because API pipeline contexts, Worker execution,
  and Beat/Celery configuration must enforce the same deadline contract.
- **Complete:** Import dispatch policy. `ImportDispatchSettings` owns dispatch
  cadence, leases, retry/batch limits, and orphan-upload retention. The group
  remains shared because import services, Ops, metrics, and Beat all enforce
  the same delivery policy.
- **Complete:** Render asset delivery policy. `RenderAssetDeliverySettings`
  owns render Outbox cadence, leases, retry/batch limits, and derived-asset
  retention/cleanup. A zero historical-revision retention count remains valid;
  every delivery deadline and batch/retry limit remains strictly positive.
- **Complete:** Playback delivery policy. `PlaybackDeliverySettings` owns
  playback Outbox cadence, leases, retry/backoff, and batch limits. It remains
  separate from `PlaybackSettings`, which owns audio synthesis capability.
- **Next:** Extract Mail delivery policy, using its measured Outbox, Ops,
  metrics, and Beat consumers as one atomic change.

## Worker runtime-loader migration boundary

The Worker model/engine fields still compose into the shared `Settings` object
until their consumers migrate to a lazy `WorkerRuntimeSettings` loader. The
complete direct-consumer boundary was measured on 2026-08-10:

- `app.core.runtime_checks` (Worker-only checks; loader must be called inside
  those check functions because the module is also imported by HTTP lifespans);
- `app.core.startup_checks` (Worker-only status logging);
- `app.pipeline.steps.text` (PaddleOCR deadline);
- `app.processing.engines.omr.factory` and `.omr.legato`;
- `app.processing.engines.render.factory` and `.render.verovio`.

No API route, Practice runtime, Beat scheduler, or playback synthesis module
may import the Worker loader. Migrate this whole list in one change, remove
`WorkerModelEngineSettings` from shared `Settings`, then move the corresponding
model variables to the Worker-only Docker manifest. Do not make fields optional
or provide a fallback loader: Worker startup must fail when its required model
configuration is absent.

## Outbox and lifecycle policy migration boundary

The remaining scheduling fields are not a Worker runtime projection. They are
shared product-operational policies: API-facing services enforce retry and
expiry decisions, observability reports the same pending-work semantics, and
Beat supplies only the periodic trigger. They must remain in the shared base
environment manifest while their typed owners are extracted.

| Proposed settings group | Fields | Direct production consumers |
| --- | --- | --- |
| Import dispatch | `IMPORT_DISPATCH_*`, `IMPORT_PROCESSING_TIMEOUT_SECONDS`, `ORPHAN_UPLOAD_TTL_SECONDS` | import dispatch/maintenance service, Ops reconciliation, async-operation metrics, Beat |
| Render asset delivery | `RENDER_OUTBOX_*`, `DERIVED_ASSET_RETAIN_RECENT_REVISIONS`, `DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS` | render outbox service, derived-asset retention service, Ops, metrics, Beat |
| Playback delivery | `PLAYBACK_OUTBOX_*` | playback outbox service, Ops, metrics, Beat |
| Mail delivery | `MAIL_OUTBOX_*` | mail outbox service, Ops, metrics, Beat |
| Notification and realtime retention | `NOTIFICATION_*`, `REALTIME_EVENT_*` | notification/realtime services, realtime HTTP router, Beat |
| Score deletion lifecycle | `SCORE_DELETION_*` | score lifecycle service, Ops reconciliation, Beat |

`app.modules.ops.service` and `app.observability.async_operation_metrics` are
cross-domain readers, not owners. They may consume the extracted groups but
must not define duplicate limits. The first safe extraction is Import dispatch:
it has a coherent service owner and no cross-field dependency on another
outbox. Extract one domain per change, move its positive/non-negative
validation with the fields, add a direct settings-group test, then migrate all
of its measured consumers and delete its declarations from `Settings`.

## Database, queue, and storage migration boundary

This group has four deliberately separate runtime projections:

| Projection | Required settings | Consumers |
| --- | --- | --- |
| API/Practice data access | `DATABASE_URL`, `REDIS_URL`, storage backend and read/write roots | async session, HTTP readiness, API storage, Practice persistence |
| Worker data access | `SYNC_DATABASE_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `WORK_ROOT`, storage backend | Celery tasks, import/render/playback processing, Worker runtime checks |
| Beat leadership | `SCHEDULER_LOCK_DATABASE_URL`, Redis/Celery broker, `WORK_ROOT` | scheduler leader advisory lock and Beat state |
| Shared storage contract | `FILE_STORAGE_BACKEND`, `S3_*`, `STORAGE_ROOT`, `WORK_ROOT` | API upload/download, Worker artifact generation, Practice score access |

The first migration must extract typed groups without changing deployment
projections: `StorageSettings`, `AsyncDatabaseSettings`, `WorkerDatabaseSettings`,
and `BeatSchedulerSettings`. Keep the current cross-field S3 validation with
`StorageSettings`; do not make credentials optional or allow local-storage
fallback when `FILE_STORAGE_BACKEND=s3`. Only after direct consumers use these
groups may Compose environment manifests be split by role.

Production database policy is PostgreSQL only. SQLite remains permitted inside
isolated unit tests through explicit SQLAlchemy test engines; it is not an
application runtime configuration. MySQL has no supported deployment or
integration-test contract and is not accepted by runtime settings.
