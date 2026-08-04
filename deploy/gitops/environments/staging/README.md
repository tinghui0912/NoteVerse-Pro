# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `51c70835a20b3704c4b9f34f624d66a65986012a`
- rendered at: `2026-08-02T07:59:29.195583+00:00`
- workflow run: `30738868723`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- Keep `base/` as the release-scoped application manifest snapshot; it must not
  be replaced with a reference to `deploy/application/base`.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
