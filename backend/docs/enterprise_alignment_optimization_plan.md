## Enterprise Alignment Optimization Plan

This document records the post-migration work that moved the backend closer to
common enterprise FastAPI practices.

It now serves primarily as a status record plus a short guide for the next
quality-improvement steps.

### Current State

The project is already operating on the intended hybrid architecture:

- canonical feature code lives under `app/modules/*`
- shared helpers live under `app/shared/*`
- runtime setup lives under `app/core/*`
- DB/session/model entry goes through `app/db/*`
- worker runtime entrypoints live under `app/worker/*`
- processing workflows live under `app/pipeline/*` and `app/processing/*`

The major structural cleanup is already complete:

- legacy wrapper directories such as `app/services`, `app/schemas`, and
  `app/api/endpoints` have been retired
- `tasks`, `files`, `shares`, `xml`, `profile`, and `auth` all run through
  canonical module paths
- config/startup concerns were separated
- email dispatch moved behind a Celery boundary
- router/service boundaries were tightened in the heaviest modules

### What Has Been Added Since The Main Migration

#### 1. Tooling baseline

The backend now has a standard local quality toolchain:

- `pytest`
- `ruff`
- `mypy`
- `mypy-model-layer`
- `pre-commit`

These are configured in:

- [pyproject.toml](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/pyproject.toml)
- [.pre-commit-config.yaml](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/.pre-commit-config.yaml)

#### 2. Stable test workflow

Tests have been migrated to `pytest`, and the verified local command is:

```powershell
.\venv\Scripts\python.exe -m pytest tests -q
```

Current verified result:

- `38 passed`

#### 3. Directory-based type-checking baseline

`mypy` now runs on a directory-based backend baseline rather than a brittle
per-file allowlist.

The baseline currently covers:

- `app/api`
- `app/core`
- `app/db`
- `app/modules`
- `app/pipeline`
- `app/processing`
- `app/shared`
- `app/utils`
- `app/worker`
- plus `app/main.py`

Current verified result:

- `Success: no issues found in 102 source files`
- `Success: no issues found in 40 source files` for the isolated model-layer track

This is a practical enterprise-style rollout strategy:

- turn on static checks for the most valuable code first
- move from file-by-file opt-in to directory-based coverage once stable
- avoid destabilizing the whole codebase with an all-at-once type migration

### What Is Already Considered Done

The following optimization areas are already completed:

- task router slimming
- task submission/archive split
- task worker-side repository split
- task typed-result and request protocol cleanup started
- files service split
- shares service split into primary, access, and collection boundaries
- shares typed-result cleanup started
- xml typed-result cleanup started
- mail dispatch boundary
- config/startup separation
- first-round observability cleanup
- core/shared/module docstring and readability cleanup
- pytest migration
- toolchain setup with `ruff`, `mypy`, and `pre-commit`
- GitHub Actions enforcement for `ruff + mypy + pytest`
- archival of historical phase-by-phase migration docs under `docs/archive/`

### Remaining High-Value Work

At this point, the project no longer needs more structural migration. The
remaining work is mostly about quality hardening.

#### 1. Decide whether to include model-layer files in the type baseline

The most obvious remaining expansion candidate is the model layer.

Good candidates:

- deeper ORM typing around `app/db/models/*`
- selected low-risk package entry files not yet covered

This should be done only if the team wants broader static-check enforcement, not
because the current baseline is insufficient.

Current guidance:

- ORM models now live under `app/db/models/*`
- do not force full model-adjacent ORM typing into the global baseline yet
- treat it as a separate hardening track
- use [model_layer_typing_plan.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/model_layer_typing_plan.md)
  as the staged rollout guide
- use [mypy-model-layer.ini](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/mypy-model-layer.ini)
  when working specifically on ORM typing debt
- the isolated model-layer check now passes on its current 40-file target set
- the active runtime files under `backend/app` that directly import
  `app.db.models/*` are now covered by that isolated track

#### 2. Keep current docs lean and archive new historical notes when needed

Older migration-phase notes have already been moved into `docs/archive/`.
Future cleanup should keep current-state documents short and move superseded
phase notes into the archive rather than leaving them in the top-level docs
directory.

### Recommended Next Steps

If the goal is "what should we improve next without restarting architecture
churn," the best sequence is:

1. decide whether to expand model-adjacent ORM typing around `app/db/models/*`
2. keep new historical notes archived instead of letting top-level docs grow

### Bottom Line

The backend is already close to a production-style FastAPI codebase with:

- clear module boundaries
- consistent canonical paths
- background email dispatch
- pytest-based regression coverage
- local linting and type-checking
- GitHub Actions enforcement for `ruff + mypy + pytest`
- incremental static-analysis adoption
- a maintainable directory-based `mypy` baseline

The next phase is not more migration. It is incremental quality hardening.
