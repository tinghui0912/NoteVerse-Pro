# GitOps Environments

Environment desired state lives here after the release-package path is proven.

These directories are desired state, not reusable source templates. Source
templates live under [`../../application/`](../../application/README.md).
Environment directories should be generated or updated by the release promotion
flow, then reviewed as immutable, digest-pinned snapshots.

Expected directories:

- `staging`: first Argo CD sync target.
- `production`: production sync target with stricter approval and receiver
  configuration boundaries.

No environment directory may contain raw Secret values.
