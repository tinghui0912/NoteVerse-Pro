# Remaining Items And Task Board

## Scope

This document lists the remaining cleanup items after the hybrid-architecture
migration.

It separates:

- low-priority cleanup items that may still improve readability or maintainability
- historical notes that are still useful for context
- optional test-hardening ideas that are not required for the current
  architecture state

## Current Residual Areas

Based on the current codebase state, there are no remaining structure-level
blockers.

The hybrid architecture is already established. The remaining items are tail
cleanup only.

### 1. Removed legacy wrapper layers

Current state:

- `app/services`
- `app/schemas`
- `app/api/endpoints`

Assessment:

- these legacy wrapper layers have already been removed
- their former responsibilities now live under canonical module, shared, or DB
  paths

Recommendation:

- do not recreate them
- if an old caller resurfaces, migrate that caller to canonical paths instead of
  restoring wrappers

### 2. `app/api/deps.py`

Current state:

- still active and canonical for auth, DB, and common API dependencies

Assessment:

- not a legacy-directory problem
- this file should remain

Recommendation:

- keep it
- continue to avoid adding new feature-specific dependency logic there unless
  it is truly shared

## Priority Classification

### P1. Optional cleanup tasks

These improve readability and long-term maintainability, but they are not
architecture blockers.

1. Trim stale migration notes
2. Add deeper DB-backed repository tests later if fixture support is added

## Task Board

### A. Low-Priority Cleanup

#### A1. Stale migration notes

- [ ] Remove stale migration-only comments when touching related files
- [ ] Keep historical progress notes in `docs/phase*` as history, not as current
      architecture rules

#### A2. Optional test deepening

- [ ] Add DB-backed repository tests later if fixture support or test DB setup
      is introduced

## Recommended Execution Order

1. Remove stale migration-only comments opportunistically when touched
2. Add deeper repository tests only if they provide real value for upcoming
   changes

## Recommended Interpretation

If the goal is "make the physical directory tree align more closely with the
target structure", the main remaining work is limited to low-priority
stale-note cleanup.

Everything else is secondary.
