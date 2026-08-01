# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `d041557de4482c4640fe4a28b5bd9c225e3eb2d8`
- rendered at: `2026-08-01T06:08:14.461403+00:00`
- workflow run: `30687151043`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
