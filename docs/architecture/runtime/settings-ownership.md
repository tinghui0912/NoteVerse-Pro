# Backend Settings Ownership

`backend/app/core/config.py` composes typed setting groups from
`backend/app/core/settings/` into the shared environment loader. Each group owns
its field definitions and validators. Direct runtime consumers use the relevant
typed projection; group names do not imply a separate deployment or database.

## Ownership

| Responsibility | Typed settings and consumers |
| --- | --- |
| HTTP identity and security | Service identity, browser CORS, trusted proxies, customer session security and token signing; API/shared HTTP adapters |
| Data and queues | Async/sync database, queue and Beat scheduler settings; API, Worker and Beat according to role |
| Storage and delivery | Storage, upload admission, model/render/playback delivery; storage and asset adapters |
| Async policy | Import dispatch, mail delivery, task reliability, notification/realtime retention, score/performance-take deletion; domain services and Worker scans |
| Worker execution | Worker runtime/model engine and playback settings; Worker startup and engines |
| Account and frontend links | Transactional mail provider, account email links, public frontend URL; account/invite services |
| Observability | Structured logging and explicit OTLP settings; API, control plane, exporter and Worker |
| Interactive fingering | Fingering execution settings; API computation boundary |

Control-plane identity is loaded separately by `ControlPlaneRuntimeSettings`.
Its cookie, CSRF and CORS policy does not inherit customer authentication.
The control API prefix is a source-owned HTTP contract, not an environment alias
for the customer prefix.

## Configuration invariants

Environment variables configure deployment identity, secrets, connections,
resource/lifecycle policy and explicitly selectable engines. Source-owned
musical/recognition profiles stay in typed domain modules with units, rationale
and fixtures. They are not duplicated into arbitrary environment files.

Validation stays with the owning settings group, including deadlines, bounded
retention, CIDRs, storage backend and cross-field requirements. CORS origins and
trusted proxy CIDRs answer different trust questions. Never use a universal
proxy allowlist. S3 configuration does not fall back to local storage when
credentials are missing.

Production runtime uses PostgreSQL. Explicit isolated SQLAlchemy test engines
may use SQLite; that does not establish SQLite runtime support. Async database,
sync Worker database and scheduler-lock connections have different responsibilities.
Compose and Kubernetes must supply the role's required values without changing
domain policy or introducing permissive defaults.

Focused settings and architecture tests define field parsing and projection
boundaries. Runtime diagnostics validate the selected role against its actual
environment. See [Kubernetes Runtime Contract](k8s-application-runtime-contract.md).
