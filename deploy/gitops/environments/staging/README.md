# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `8e5cfcb6f11909fa2f5373a852ba18d10b7dfd6d`
- rendered at: `2026-08-05T09:31:36.467950+00:00`
- workflow run: `30993611300`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- The `base/` directory is a release-scoped application manifest snapshot.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
