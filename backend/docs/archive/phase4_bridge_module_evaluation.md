# Phase 4 Bridge Module Evaluation

## Scope

This note evaluates bridge-style module files that currently sit under `app/modules/*` but still delegate to older implementation paths.

Reviewed files:

- `app/modules/auth/router.py`
- `app/modules/auth/schemas.py`
- `app/modules/files/router.py`
- `app/modules/files/schemas.py`
- `app/modules/tasks/router.py`
- `app/modules/tasks/schemas.py`

## Current Assessment

These files are not dead compatibility wrappers.

They are better described as:

- canonical public module entrypoints
- backed by older internal implementation files

This is different from the wrappers already removed from:

- `app/schemas/*`
- `app/api/endpoints/*`
- `app/services/*`

Those removed wrappers had no remaining meaningful role.

These bridge module files still have a useful role because:

- `app.api.v1.router` imports module paths, not legacy endpoint paths
- external feature-oriented imports should already prefer `app.modules.*`
- deleting them now would weaken the module-oriented public structure

## Recommendation

Do not remove these bridge-style module files yet.

Treat them as:

- canonical import surfaces
- temporary internal delegation layers

## Suggested Next Step

If Phase 4 continues deeper, the right move is:

1. inline real router/schema implementations into these module files
2. then decide whether the old `app.api.endpoints.*` or `app.schemas.*` files can shrink further

## Priority

Recommended priority order for future inlining:

1. `app/modules/tasks/router.py`
2. `app/modules/tasks/schemas.py`
3. `app/modules/files/router.py`
4. `app/modules/files/schemas.py`
5. `app/modules/auth/router.py`
6. `app/modules/auth/schemas.py`

## Bottom Line

These files should stay for now.

They are transitional internally, but already canonical externally.
