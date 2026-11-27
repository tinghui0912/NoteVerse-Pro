# Backend Settings Ownership

Environment loading belongs to process composition roots under `backend/app/runtime/`.
`backend/app/platform/config/` contains validated value models without environment
loading or resource construction. `runtime/config_blocks.py` composes connection
and observability blocks. Domain constructors receive explicit policy values.

| Process | Settings | Entrypoint | Inputs |
| --- | --- | --- | --- |
| Customer API | `CustomerApiSettings` | `app.runtime.customer_api.main:app` | DB, Redis/dispatch, object storage, observability, customer cookie/signing policy, public links, resource policies, fingering |
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

Worker and Beat settings contain neither customer signing/session credentials nor
operator identity configuration. Control Plane excludes customer credentials.
Customer API excludes operator credentials. Worker owns notification, realtime
retention and derived-asset maintenance policies; Customer API owns stream and
durable dispatch policies. Environment files are supplied by the
process launcher, never discovered implicitly by domain code.

HTTP composition attaches its Engine, SessionFactory, settings and resource
services to `app.state`. `app/platform/db/dependencies.py` selects that application's
factory. CLI and background processes own independent factories.

Customer and operator cookie/header identities come from their generated browser
protocol contracts. Deployment inputs configure origins, cookie policy, connection
URLs and resource policy; they do not redefine protocol identities.

Database factories use synchronous SQLAlchemy/psycopg sessions with UTC, bounded
pools and stale-connection checks. Scheduler advisory locks use their dedicated
PostgreSQL connection policy. Per-process database roles and Secret distribution
remain a separate security implementation responsibility.

The import-direction and settings-schema tests in
`backend/tests/architecture/test_runtime_boundaries.py` enforce isolation without
skipping unavailable external services. PostgreSQL tests verify transaction behavior.
See [Runtime Dependency Ownership](runtime-dependency-ownership.md) and
[ADR 0010](../../adr/0010-security-and-runtime-foundation.md).
