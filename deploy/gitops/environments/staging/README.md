# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `0cb5d954167c9f8e5489b5b2f64a72615ab3ee87`
- rendered at: `2026-08-01T07:08:40.133147+00:00`
- workflow run: `30689125985`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
