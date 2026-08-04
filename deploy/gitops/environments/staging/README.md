# Staging GitOps Environment

This directory contains the current digest-pinned NoteVerse staging
desired state promoted from a release package.

Release metadata:

- commit: `ab4ad906ec504bd97765de834719bc89a55f78bf`
- rendered at: `2026-08-04T15:01:25.336735+00:00`
- workflow run: `30921943911`

Rules:

- Do not commit raw Secret values here.
- Keep image references digest-pinned.
- The `base/` directory is a release-scoped application manifest snapshot.
- Update this directory through the release-package promotion flow, not by
  manually editing generated values.
- Apply only after required cluster Secrets, CRDs, Gateway API, cert-manager,
  object storage, and observability prerequisites exist.
