# Phase 4 Package Surface Evaluation

## Scope

This note evaluates the package-level surfaces that remained late in Phase 4:

- `app/api/deps.py`

## `app/api/deps.py`

### Current role

`app/api/deps.py` is still part of the live runtime path.

It currently serves two different responsibilities:

- canonical shared API dependencies
  - auth
  - DB session
  - current user
  - superuser gate
- compatibility forwarding for some feature-level providers

### Current assessment

This file should not be removed during cleanup.

It is still canonical for:

- `get_db`
- `get_current_user`
- `get_current_active_superuser`

It also still acts as a transitional compatibility surface for:

- task/share/xml/profile provider forwarding

### Recommendation

Keep `app/api/deps.py`, but keep shrinking it toward:

- shared auth + DB concerns only

Feature-specific providers should continue to live in:

- `app.modules.tasks.dependencies`
- `app.modules.shares.dependencies`
- `app.modules.xml.dependencies`
- `app.modules.profile.dependencies`

## Bottom Line

- `app/services/__init__.py` was later removed after confirming there were no in-repo callers
- `app/api/deps.py` remains canonical and should be retained, but its feature-forwarding role should continue shrinking over time
