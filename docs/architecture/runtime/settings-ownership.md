# Backend Settings Ownership

Environment loading belongs to process composition roots under `backend/app/runtime/`.
`backend/app/platform/config/` contains validated value models without environment
loading or resource construction. `runtime/config_blocks.py` composes connection
and observability blocks. Domain constructors receive explicit policy values.

| Process | Settings | Entrypoint | Inputs |
| --- | --- | --- | --- |
| Customer API | `CustomerApiSettings` | `app.runtime.customer_api.main:app` | DB, Redis/dispatch, object storage, observability, customer opaque session policy, public links, resource policies, fingering |
| Control Plane | `ControlPlaneSettings` | `app.runtime.control_plane.main:app` | DB, Redis connection, observability, operator cookie/origin policy, Ops delivery policies |
| Worker | `WorkerSettings` | `app.runtime.worker.main:celery_app` | DB, Redis/dispatch, object storage, mail transport, observability, processing/work directories, delivery/retention/scheduler policies |
| Beat | `BeatSettings` | `app.runtime.beat.main:celery_app` | DB, Redis, observability, schedule/reliability and scheduler-lock policies |
| Beat supervisor | `BeatSettings` | `python -m app.runtime.beat.leader` | Beat configuration and dedicated scheduler-lock connection |
| Observability exporter | `ObservabilitySettings` | `app.runtime.observability.main:app` | DB, observability and read-only metric policies |
| PaddleOCR subprocess | `PaddleOcrSettings` | `python -m app.runtime.paddle_ocr.main` | Three local OCR model paths; JSON stdout/argv execution protocol, no DB, broker or identity configuration |
| Alembic | `MigrationSettings` | `alembic/env.py` | DB only |
| Administrative DB commands | `DatabaseCommandSettings` | `scripts/create_operator.py`, `reconcile_storage_usage.py`, `reset_alembic.py` | DB only |
| Resource seed | `ResourceCommandSettings` | `scripts/seed_integration_user.py` | DB, object storage and resource policies |
| Metadata command | `MetadataCommandSettings` | `scripts/rebuild_score_metadata.py` | DB and metadata delivery policy |
| Model preparation | `AssetCommandSettings` | `scripts/prepare_model_assets.py` | Model-engine and playback asset paths |

Worker and Beat settings contain neither customer session policy nor
operator identity configuration. Control Plane excludes customer credentials.
Customer API excludes operator credentials. Worker owns notification, realtime
retention and derived-asset maintenance policies; Customer API owns stream and
durable dispatch policies. Environment files are supplied by the
process launcher, never discovered implicitly by domain code.

HTTP composition attaches its Engine, SessionFactory, settings and resource
services to `app.state`. `app/platform/db/dependencies.py` selects that application's
factory. CLI and background processes own independent factories.

Customer API owns `SESSION_IDLE_DAYS`, `SESSION_ABSOLUTE_DAYS`,
`SESSION_TOUCH_INTERVAL_SECONDS` and `SESSION_CACHE_TTL_SECONDS`. Its production
and staging `ENVIRONMENT` requires `AUTH_COOKIE_SECURE=true`; cookie SameSite is
fixed to Lax. Session credentials have no deployment signing secret. See
[Consumer Sessions](../consumer-sessions.md) for lifetimes, Redis failure behavior
and commit-owned revocation.

Customer and operator cookie/header identities come from their generated browser
protocol contracts. Deployment inputs configure origins, cookie policy, connection
URLs and resource policy; they do not redefine protocol identities.

Database factories use synchronous SQLAlchemy/psycopg sessions with UTC, bounded
pools and stale-connection checks. Scheduler advisory locks use their dedicated
PostgreSQL connection policy. Database roles and Secret distribution follow the explicit contracts below.

The import-direction and settings-schema tests in
`backend/tests/architecture/test_runtime_boundaries.py` enforce isolation without
skipping unavailable external services. PostgreSQL tests verify transaction behavior.
See [Runtime Dependency Ownership](runtime-dependency-ownership.md) and
[ADR 0010](../../adr/0010-security-and-runtime-foundation.md).

## Deployment credentials

`backend/app/runtime/deployment.py` binds every deployed process to its Settings
schema, exact Secret keys, ConfigMap and PostgreSQL role. The generated
`backend/docs/contracts/runtime-deployment.json` is checked against that source.
Kubernetes and release-package validators consume the generated contract.
Workloads reference individual Secret keys; each ConfigMap contains only fields
accepted by that process's Settings and never credential fields.

| Process | PostgreSQL role | Secret | Exact keys |
| --- | --- | --- | --- |
| beat | nv_beat | noteverse-beat-secret | `DATABASE_URL`, `SCHEDULER_LOCK_DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` |
| control_plane | nv_control_plane | noteverse-control-plane-secret | `DATABASE_URL`, `REDIS_URL` |
| customer_api | nv_customer_api | noteverse-customer-api-secret | `DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| migrator | nv_migrator | noteverse-migrator-secret | `DATABASE_URL` |
| model_assets | none | noteverse-model-assets-secret | `HF_TOKEN` |
| observability | nv_observability | noteverse-observability-secret | `DATABASE_URL` |
| paddle_ocr | none | none |  |
| worker | nv_worker | noteverse-worker-secret | `DATABASE_URL`, `SCHEDULER_LOCK_DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `RESEND_API_KEY` |

The six database runtimes have distinct login passwords. Worker and Beat use their
own role for scheduler-lock connections. Model preparation has no database role;
its optional `HF_TOKEN` is an auxiliary model-download credential. PaddleOCR uses
only local model paths and receives no Secrets. Its subprocess launcher passes
only explicit operating-system/runtime library variables and model paths; it
does not inherit the Worker credential environment. Registry image-pull, TLS and
Loki/Tempo object-storage credentials have infrastructure ownership and do not
enter application process environments.

Control Plane requires no customer authentication credential, object-storage credentials or mail
transport key: Ops retries update durable delivery records, and the Worker sends
mail. Beat and Exporter require no object-storage, mail or authentication keys.
The migrator receives only `DATABASE_URL` and runs as a short-lived Job.

Each local Docker process uses `backend/.env.docker.<runtime>` created from its
matching `.example`. Kubernetes credential-only examples live in
`backend/db/secret-templates/`. `scripts/validate_runtime_secrets.py` checks exact
keys and database usernames without displaying values. The release preparation
script validates the six runtime Secrets before applying workloads.

See [Database Role Ownership](database-role-ownership.md) for table/column grants,
bootstrap, migration and administrative command identities.
