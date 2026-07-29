# Argo CD Applications

Current resources:

- `noteverse-project.yaml`
- `noteverse-staging.yaml`

`noteverse-project.yaml` restricts NoteVerse delivery to the in-repository
source path and the `noteverse-staging` namespace.

`noteverse-staging.yaml` points Argo CD at
`deploy/gitops/environments/staging` and intentionally uses manual sync.

Future resources:

- `noteverse-production.yaml`, after staging GitOps is proven and production
  approval rules are configured.
