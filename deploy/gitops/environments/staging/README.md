# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `d1b077b8ece9b17286dc0ce5010452a4de2bdc0e`
- rendered at: `2026-08-02T05:17:27.211200+00:00`
- workflow run: `30733851337`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Keep `base/` as the release-scoped application manifest snapshot; it must not
  be replaced with a reference to `deploy/application/base`.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
