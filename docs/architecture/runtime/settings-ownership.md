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

- `Settings` has cross-field validation for task deadlines, storage backend,
  model engines, secret values, URLs, and runtime paths. Moving a field without
  its validation can weaken a fail-fast guarantee.
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

- **Complete:** Observability, Practice diagnostics, and Worker model/engine
  configuration. `WorkerModelEngineSettings` owns Hugging Face/PaddleOCR model
  locations and offline mode, LEGATO selection/runtime parameters, Verovio
  render parameters, and playback synthesis parameters. Its runtime consumers
  are the Worker, API-side import dispatch/runtime checks, and playback asset
  generation; it intentionally does not own the Practice soundfont.
- **Next:** Practice soundfont/alignment runtime configuration, followed by the
  release-critical Storage and database/queue settings only after their runtime
  projections are explicitly separated.
