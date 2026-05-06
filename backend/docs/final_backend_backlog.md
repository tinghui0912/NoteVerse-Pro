## Final Backend Backlog

This document lists only the remaining backend improvements that still have
clear engineering value.

Everything else from the migration and hardening phases should be treated as
complete.

### Current Baseline

- architecture migration is complete
- canonical structure is stable
- `pytest`, `ruff`, `mypy`, `mypy-model-layer`, `pre-commit`, and CI are in place
- main `mypy` baseline passes on `102` source files
- model-layer `mypy` passes on `40` source files
- the current pytest suite passes with `38` tests

### Remaining High-Value Items

#### 1. Expand model-layer typing incrementally

Keep [mypy-model-layer.ini](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/mypy-model-layer.ini)
as a separate hardening track and continue expanding it only where there is
clear value.

Do not merge it into the default main baseline yet.

Why:

- ORM-heavy typing is stricter and noisier than the main application baseline
- keeping it separate preserves a low-friction default developer workflow
- the current two-track setup is already a reasonable enterprise-style pattern

#### 2. Continue DTO / typed-result cleanup in heavy modules

The typed-result cleanup has already covered the main runtime paths in:

- `tasks`
- `shares`
- `xml`
- `files`
- `pipeline`
- `processing`
- `shared` response helpers

It is still worth continuing when touching related code, especially to reduce:

- `dict[str, object]`
- loose intermediate payloads
- generic option/result shapes

Current status:

- the highest-value cleanup is already done
- the remaining loose typing is now mostly in lower-level helper code
- this should stay incremental, not become a large standalone rewrite

#### 3. Refine heavy orchestration services only if they grow again

Two modules are already much better than before, but should still be watched:

- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/service.py)
- [worker_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/worker_service.py)

Current status:

- the most obvious `shares` runtime performance issue has already been removed
  by replacing the old owner-share listing N+1 path with a joined query
- the repeated worker-side session reset logic has also been consolidated into
  a single helper with regression coverage
- both are acceptable in their current form
- neither is a structural blocker

Only continue splitting them if new feature work makes them noticeably larger.

#### 4. Keep docs and workspace noise under control

Future cleanup should stay lightweight:

- archive new historical notes instead of growing top-level docs
- keep main docs focused on current rules and current architecture
- avoid committing cache/output noise such as `__pycache__`
- treat low-level `core/*` helper typing cleanup as opportunistic, not as a
  new dedicated campaign

### Not Recommended Right Now

- restarting large-scale architecture refactoring
- forcing model-layer typing into the main default `mypy` baseline
- moving ORM models into `app/modules/*`
- large cosmetic rewrites without concrete engineering benefit

### Recommended Working Mode

From this point forward, the backend should be treated as a stable production
codebase.

The default approach should be:

1. ship features under the current canonical structure
2. keep `ruff + mypy + mypy-model-layer + pytest` green
3. improve typing and service boundaries only when there is clear local value
4. prefer incremental hardening over broad refactor campaigns

### Bottom Line

The backend no longer has a meaningful migration backlog.

What remains is a short engineering-hardening backlog, not a structural rescue
plan.
