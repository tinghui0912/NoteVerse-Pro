# NoteVerse GitOps Desired State

This directory is the future home for GitOps desired state. It is intentionally
small at first because release packages are still the normal staging rehearsal
path.

Rules:

- do not commit Secret values;
- use digest-pinned image references for staging and production desired state;
- keep staging and production structurally aligned;
- keep environment-specific values in environment directories;
- let release workflows update this tree through pull requests after Argo CD is
  introduced.

Current status:

- `deploy/gitops/environments/staging` contains the current digest-pinned
  staging desired state promoted from a verified release package.
- `deploy/gitops/environments/production` is a placeholder for the future
  production sync path.
- `deploy/gitops/applications/argocd/noteverse-staging.yaml` is the first
  manual-sync Argo CD Application.
- release package workflows remain the active package generation path while
  GitOps is proven in minikube.

See [GitOps Evolution Plan](../../docs/operations/release/gitops-evolution-plan.md).
