# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `3aede931f19d3a350cd7400d2fa18a2947230191`
- rendered at: `2026-08-06T05:22:54.659902+00:00`
- workflow run: `31073929743`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- The `base/` directory is a release-scoped application manifest snapshot.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
