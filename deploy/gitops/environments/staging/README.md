# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `612c5e65e081c2882cdbf4235a506af1c99f9d49`
- rendered at: `2026-07-29T14:10:03.816716+00:00`
- workflow run: `30459489175`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
