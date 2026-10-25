# NoteVerse Pro

NoteVerse Pro is a sheet-music processing and practice platform. It combines MusicXML import and review, immutable score revisions, collaboration and public sharing, browser-based editing, and browser-local practice.

## System map

```text
Customer Web ──same-origin proxy──> Backend API ──> PostgreSQL / Redis / Object Storage
       |
       └──────────────> browser-local Practice execution

Platform Admin ──same-origin proxy──> Control Plane API
```

The backend is a modular monolith deployed as separately scalable API, worker,
beat, and control-plane runtimes. It is not a collection of microservices or
separate repositories. The backend Practice module owns score/source/artifact
delivery. Live `STEP_BY_STEP` and `CONTINUOUS_PLAY` Practice execution is owned
by Customer Web after the required score assets are loaded; it does not require
a Practice WebSocket, backend clock synchronization, Matchmaker, score-following,
or a backend PracticeSession runtime.

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
| `.github/scripts/` | CI/CD trust, artifact identity, registry publication, and workflow policy. |

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
- Put current component-owned contracts and guides in `backend/docs/` or `apps/*/docs/`.
- Put cross-project automation in `scripts/`; put component-only tooling next to its owning component.
- Internal Markdown links must be repository-relative and pass the `docs-links` check.

Current implementation outcomes and acceptance criteria are tracked in [GitHub Issues](https://github.com/tinghui0912/NoteVerse-Pro/issues).
