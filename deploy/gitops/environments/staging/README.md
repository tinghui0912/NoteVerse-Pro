# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `fd3475357ec77c06ab42088baa59331d4af5288c`
- rendered at: `2026-08-01T14:57:36.366714+00:00`
- workflow run: `30704860155`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
