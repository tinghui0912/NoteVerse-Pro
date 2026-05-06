## Final Backend Backlog Task Plan

This plan turns the final backend backlog into a short execution sequence.

It intentionally avoids broad refactor work and focuses only on the remaining
high-value tail items.

### Phase A. Expand Model-Layer Typing Carefully

Goal:

- expand [mypy-model-layer.ini](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/mypy-model-layer.ini)
  to additional low-risk files that already import `app.db.models/*`
- keep the isolated ORM-aware track separate from the default main baseline

Execution order:

1. add low-risk router/service/repository files that already look clean
2. fix any newly exposed `Optional[id]`, ORM-expression, or TypedDict boundary issues
3. keep the isolated model-layer check green after each expansion

Current priority candidates:

- [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/profile/router.py)
- [access_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/access_service.py)
- [collection_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/collection_service.py)
- [worker_repository.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/worker_repository.py)

Current progress:

- the isolated model-layer check has already been expanded from `37` to `40`
  source files
- the current low-risk additions are now included and passing

### Phase B. Continue Typed Result Cleanup Only Where It Pays Off

Goal:

- keep reducing loose payload shapes in heavy modules

Execution order:

1. continue in `tasks`
2. continue in `shares`
3. continue in `xml`

Scope:

- replace remaining loose `dict[str, object]` payloads where a stable result
  shape already exists
- avoid large DTO rewrites with no immediate engineering value

Current progress:

- `tasks` now uses explicit typed results for task status, batch delete, batch
  submit, archive, and pipeline execution flows
- `shares` now uses explicit typed results for access, collection, and download
  file listing flows
- `xml` now uses explicit typed results for load/save/confirm/fingering flows
- `files` now uses explicit typed results for upload, task-file listing, and
  uploaded-file deletion flows
- `auth` email-code sending now returns a concrete
  [SendCodeResult](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/auth/schemas.py)
  model instead of a loose payload
- `TaskProcessingOptions` is now a real `TypedDict`, and the
  `tasks -> pipeline -> worker` path uses clearer protocol-style boundaries
- the `processing -> pipeline` path now uses explicit typed results for OCR,
  text integration, and Audiveris engine outputs instead of loose transport
  dictionaries
- the XML preparation and preview-rendering path now uses explicit typed
  results for MXL extraction and MuseScore rendering as well
- OCR recognition geometry now uses an explicit bounding-box shape instead of
  leaving `bbox` as an untyped payload
- shared response helpers now use explicit payload types instead of relying on
  broad `Any`-shaped response dictionaries

Current status:

- the highest-value typed-result cleanup on the main runtime paths is now
  substantially complete
- remaining loose typing is mostly concentrated in low-level shared/core helper
  code rather than heavy feature workflows
- the lowest-risk `core/*` helper typing cleanup has also advanced, especially
  around exception payloads and security-token boundary types
- the worker-side session reset path has been consolidated behind a single
  helper, with regression coverage for rollback behavior
- further cleanup should happen opportunistically when touching those areas,
  not as a dedicated broad rewrite

### Phase C. Keep The Workspace Quiet

Goal:

- keep the current docs and workspace aligned with the real backend state
- finish only the remaining small hardening items that still have clear value

Execution order:

1. sync any quality-gate count changes into current docs
2. keep new historical notes archived
3. clean workspace noise such as `__pycache__`
4. only then consider low-level helper hardening such as:
   - worker transaction/session cleanup
   - opportunistic `core/*` typing cleanup

### Start Here

The next active task is:

- Phase C. Keep docs and workspace aligned, with only small worker/core/cache
  hardening left as optional follow-up work
