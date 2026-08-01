# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `d2b4a82af79113abca56233e52971fd3e0bc0900`
- rendered at: `2026-08-01T14:14:28.216548+00:00`
- workflow run: `30703353032`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
