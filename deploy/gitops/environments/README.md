# GitOps Environments

Environment desired state lives here after the release-package path is proven.

Expected directories:

- `staging`: first Argo CD sync target.
- `production`: production sync target with stricter approval and receiver
  configuration boundaries.

No environment directory may contain raw Secret values.
