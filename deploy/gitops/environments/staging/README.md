# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `1d5b1e9948b134d0af2dc5cbe2ad58eead8bd445`
- rendered at: `2026-08-05T18:26:08.920285+00:00`
- workflow run: `31034688661`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- The `base/` directory is a release-scoped application manifest snapshot.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
