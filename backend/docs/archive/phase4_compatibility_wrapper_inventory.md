# Phase 4 Compatibility Wrapper Inventory

## Scope

This inventory covers legacy wrapper files that now exist mainly for backward compatibility.

It is based on the current `backend/app` code search after the Phase 3 migration work.

## Summary

A search across `backend/app` found no active runtime imports that still depend on these legacy wrapper paths as canonical implementation paths.

That means these files are now primarily:

- compatibility shims
- migration safety layers
- import-stability placeholders

This is a strong signal that the project is ready for a controlled compatibility cleanup phase.

## Service Wrappers

### Compatibility-only service wrappers

The first service-wrapper cleanup has already been completed.

Removed:

- `app/services/task_service.py`
- `app/services/worker_task_service.py`
- `app/services/share_service.py`
- `app/services/xml_service.py`
- `app/services/avatar_service.py`
- `app/services/file_service.py`

Validation after removal:

- `app.main` and canonical module services still import successfully
- no remaining real imports found in `backend/app`, `backend/run.py`, or `backend/scripts`
- remaining search hits are only compatibility notes inside module docstrings/comments

## Endpoint Wrappers

### Compatibility-only endpoint wrappers

The first endpoint-wrapper cleanup has already been completed.

Removed:

- `app/api/endpoints/shares.py`
- `app/api/endpoints/xml.py`
- `app/api/endpoints/profile.py`

Validation after removal:

- no remaining imports found in `backend/app`, `backend/run.py`, or `backend/scripts`
- `app.main`, `app.api.v1.router`, and canonical module routers still import successfully

## Schema Wrappers

### Compatibility-only schema wrappers

The first schema-wrapper cleanup has already been completed.

Removed:

- `app/schemas/share.py`
- `app/schemas/xml.py`
- `app/schemas/profile.py`
- `app/schemas/response.py`

Validation after removal:

- no remaining imports found in `backend/app`, `backend/run.py`, or `backend/scripts`
- canonical schema/response modules still import successfully

## Recommendation

These wrappers look like good candidates for a staged cleanup plan.

Recommended order:

1. remove schema wrappers first
   - completed
2. remove endpoint wrappers next
   - completed
3. remove service wrappers last
   - completed

## Caution

This inventory only reflects imports found inside `backend/app`.

Before deletion, also check:

- external scripts
- tests
- notebooks
- deployment helpers
- local tooling outside `backend/app`

If external callers still use these imports, keep the wrappers temporarily or update those callers first.
