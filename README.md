# NoteVerse Pro

NoteVerse Pro is a sheet-music processing and practice platform. It combines MusicXML import and review, immutable score revisions, collaboration and public sharing, browser-based editing, and realtime practice.

## System map

```text
Customer Web ──same-origin proxy──> Backend API ──> PostgreSQL / Redis / Object Storage
       |                                   |
       └──────────────> Practice API       └──> Celery Worker / Beat

Platform Admin ──same-origin proxy──> Control Plane API
```

The backend is a modular monolith deployed as separately scalable API, practice, worker, beat, and control-plane runtimes. It is not a collection of microservices or separate repositories.

## Repository layout

| Path | Ownership and purpose |
| --- | --- |
| `apps/customer-web/` | Customer-facing Next.js application. |
| `apps/platform-admin/` | Operator-facing Next.js application; it only talks to the Control Plane API. |
| `backend/` | FastAPI modular monolith, Celery workers, database migrations, and processing engines. |
| `deploy/` | Kubernetes templates and GitOps desired state. |
| `docker/` | Runtime and quality image definitions. |
| `docs/` | Cross-system architecture, engineering, operations, product, and security documentation. |
| `scripts/` | Repository-level quality, release, Kubernetes, and platform automation. |

## Start here

1. Read [the documentation index](docs/README.md) and the relevant app or backend README.
2. For backend runtime setup, use [backend/README.md](backend/README.md).
3. For customer UI setup, use [apps/customer-web/README.md](apps/customer-web/README.md).
4. For platform administration setup, use [apps/platform-admin/README.md](apps/platform-admin/README.md).
5. Before a change, read [repository quality checks](docs/engineering/guides/repository-quality-checks.md).

## Quality entry points

Use the repository wrapper for supported checks:

```powershell
.\scripts\quality.ps1 -Check <check>
```

Run `docs-links` after changing Markdown documentation. Backend quality runs in Docker; customer web and platform-admin checks have Docker development paths in their own READMEs. See the [quality guide](docs/engineering/guides/repository-quality-checks.md) for the full matrix.

## Documentation and script placement

- Put cross-system rules, ADRs, operations, security, and onboarding material in `docs/`.
- Put component-owned implementation notes in `backend/docs/` or `apps/*/docs/`.
- Put cross-project automation in `scripts/`; put component-only tooling next to its owning component.
- All checked-in Markdown links must be repository-relative and pass the `docs-links` check.

The active refactoring backlog is maintained in the [Architecture Refactoring Ledger](docs/engineering/reviews/2026-08-09-architecture-refactoring-ledger.md).
