# Phase 4 Cleanup And Hardening Task Board

## Goal

Phase 4 is not about inventing a new structure.

It is about:

- reducing transitional debt
- reinforcing canonical architecture rules
- improving regression safety
- making future maintenance easier

---

## A. Canonical Path Freeze

### A1. Define canonical module rules

- [x] Confirm that new feature logic must live under `app/modules/*`
- [x] Confirm that shared response/code utilities must live under `app/shared/*`
- [x] Confirm that DB/session entry points must go through `app/db/*`
- [x] Write these rules into one project-facing architecture note or contributor guide

### A2. Mark legacy areas as transitional

- [x] Add short compatibility comments to migrated `app/schemas/*` wrappers where still present

### A3. Prevent future drift

- [x] Search for fresh imports pointing to old `app.services.*` paths
- [x] Search for fresh imports pointing to old migrated endpoint/schema paths
- [x] Replace those imports with canonical `app.modules.*` or `app.shared.*` imports where safe

---

## B. Compatibility Layer Cleanup

### B1. Inventory legacy compatibility wrappers

- [x] Build a complete list of compatibility-only files under `app/services/*`
- [x] Build a complete list of compatibility-only files under migrated `app/api/endpoints/*`
- [x] Build a complete list of compatibility-only files under migrated `app/schemas/*`
- [x] Label each item as:
  - safe to keep temporarily
  - ready to remove
  - blocked by remaining imports

### B2. Clean service wrappers

- [x] Review legacy service wrappers
- [x] Remove service wrappers that were no longer imported anywhere
- [x] Remove the package-level compatibility shim after confirming no in-repo callers
- [ ] Record any external callers outside checked source ranges if they are discovered later

### B3. Clean migrated endpoint/schema wrappers

- [x] Check migrated endpoint wrappers for `shares`, `xml`, `profile`
- [x] Check migrated schema wrappers for `share`, `xml`, `profile`, `response`
- [x] Remove schema wrappers that had zero remaining imports
- [x] Remove endpoint wrappers that had zero remaining imports
- [x] Remove `auth/files/tasks` endpoint wrappers after confirming no in-repo runtime imports
- [x] Keep remaining wrappers with active imports and record the blocking import locations when such wrappers still exist

---

## C. Import Normalization

### C1. Normalize to module imports

- [x] Replace remaining task-related imports that still point to legacy service paths
- [x] Replace remaining share-related imports that still point to legacy service paths
- [x] Replace remaining profile/xml/files imports that still point to old compatibility files

### C2. Normalize to shared imports

- [x] Search for remaining old response helper imports that should come from `app.shared.responses`
- [x] Search for remaining pure business-code imports that should come from `app.shared.constants`
- [ ] Leave `FileKind` and model-coupled constants on their current path unless intentionally redesigned

### C3. Normalize db imports

- [x] Search for old DB import paths that bypass `app.db/*`
- [x] Update them to `app.db.session` or `app.db.worker_session` where appropriate

---

## D. Module Maturity Completion

### D1. Review lower-maturity modules

- [x] Review `app/modules/auth`
- [x] Review `app/modules/profile`
- [x] Review `app/modules/xml`
- [x] Review `app/modules/shares`

### D2. For each lower-maturity module, verify internal shape

- [x] Does it have a real `router.py`?
- [x] Does it have a real `service.py`?
- [x] Does it need a real `repository.py`?
- [x] Does it need its own `dependencies.py`?
- [x] Are its schemas canonical in the module or still re-exported from old paths?

### D3. Close remaining shallow-wrapper gaps

- [x] Convert any remaining thin re-export file into a real module file if it is still part of the main runtime path
- [x] Leave low-value compatibility wrappers alone until imports are fully normalized

---

## E. Logging And Runtime Consistency

### E1. Finish log cleanup tail work

- [x] Review remaining mixed runtime log messages outside already-covered files
- [x] Review `app/core/*` for lingering inconsistent runtime wording
- [x] Review any worker/pipeline files not yet touched for inconsistent runtime logs

### E2. Optional readability cleanup

- [x] Normalize mixed-language comments in `app/pipeline/*`
- [x] Normalize mixed-language comments in `app/processing/*`
- [ ] Normalize stale migration comments that no longer add value

### E3. Guard the Windows console path

- [x] Keep `app/core/logger.py` encoding fallback in place
- [x] Re-run a minimal Windows-style smoke after any future logger changes

---

## F. Regression Test Hardening

### F1. API smoke coverage

- [x] Add a basic automated smoke test for:
  - `/`
  - `/docs`
  - `/redoc`
  - `/api/v1/openapi.json`
- [x] Add unauthenticated access checks for protected routes

### F2. Feature smoke coverage

- [x] Add smoke tests for `tasks`
- [x] Add smoke tests for `files`
- [x] Add smoke tests for `shares`
- [x] Add smoke tests for `xml`
- [x] Add smoke tests for `profile`

### F3. Pipeline/task regression coverage

- [x] Add targeted tests for task service repository behavior
- [x] Add targeted tests for file repository/service behavior
- [x] Add targeted tests for pipeline step wiring
- [x] Add targeted tests for MXL extraction edge cases

### F4. Config/runtime tests

- [x] Add a test for settings loading from `backend/.env`
- [x] Add a test for `DEBUG` environment parsing
- [x] Add a test for route import success through `app.main`

---

## G. Documentation Hardening

### G1. Keep migration docs current

- [x] Update [fastapi_hybrid_architecture_migration_plan.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/fastapi_hybrid_architecture_migration_plan.md) with the current real status
- [x] Update [current_refactor_status_summary.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/current_refactor_status_summary.md) after major cleanup milestones
- [x] Keep [phase3_logging_style_progress.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase3_logging_style_progress.md) as historical progress, not as the main current-state source

### G2. Add one stable architecture guide

- [x] Create a short architecture guide describing:
  - top-level folder responsibilities
  - canonical locations for new code
  - which folders are transitional
  - how tasks/files/modules/shared/db should be extended

---

## H. Completion Criteria

Phase 4 can be considered complete when all of the following are true:

- [x] New code placement rules are explicitly documented
- [x] Canonical imports are mostly normalized to `app/modules/*`, `app/shared/*`, and `app/db/*`
- [x] Compatibility-only wrappers are inventoried and reduced
- [x] Major runtime paths still pass smoke validation
- [x] Basic regression tests protect the current architecture
- [x] The team can clearly tell which paths are canonical and which are transitional

---

## Suggested Execution Order

1. `A. Canonical Path Freeze`
2. `B. Compatibility Layer Cleanup`
3. `C. Import Normalization`
4. `F. Regression Test Hardening`
5. `D. Module Maturity Completion`
6. `G. Documentation Hardening`
7. `E. Logging And Runtime Consistency` optional tail cleanup

---

## Recommended Interpretation

Phase 4 should be treated as a cleanup-and-protection phase, not a redesign phase.

The architecture direction is already good enough.

The main objective now is to make that direction:

- enforceable
- testable
- easier for future contributors to follow

---

## Practical Completion Status

Phase 4 is now effectively complete on the main engineering path.

The still-unchecked items above fall into one of these buckets:

- intentionally retained compatibility notes or low-risk exports
- optional readability/log tail cleanup
- future-proofing checks that only matter if new drift appears later

For normal development, the backend can now be treated as operating on the intended canonical structure.

