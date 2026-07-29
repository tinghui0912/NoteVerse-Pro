# GitOps Evolution Plan

This plan defines how NoteVerse should move from downloadable release packages
into GitOps. The current goal is to keep the deployment model production-shaped
without introducing a second repository before ownership boundaries require it.

## Current Decision

Keep the GitOps desired state in this repository first.

Rationale:

- NoteVerse is still a single-product repository with tightly coupled backend,
  frontend, worker, platform, and release-package changes.
- The current team needs fast feedback while the Kubernetes contract is still
  being hardened.
- Release packages already contain digest-pinned image references and release
  metadata, so the same rendered state can become GitOps desired state later.
- Keeping GitOps in-repo avoids premature repository and permission overhead.

Do not put Secret values in GitOps directories. GitOps should reference Secret
names, ExternalSecret resources, or pre-created cluster Secrets.

## Target In-Repository Shape

Planned directory shape:

```text
deploy/
  gitops/
    applications/
      argocd/
        noteverse-staging.yaml
        noteverse-production.yaml
    environments/
      staging/
        kustomization.yaml
        release-metadata.json
      production/
        kustomization.yaml
        release-metadata.json
    releases/
      staging/
      production/
```

The `deploy/gitops/environments/*` directories should contain desired state or
references to desired state that Argo CD can sync. Image references should be
immutable digest references for staging and production.

## Promotion Model

Initial GitOps flow:

```text
Build images
  -> generate digest-pinned release package
  -> validate rendered manifests
  -> open a PR that updates deploy/gitops/environments/staging
  -> Argo CD syncs staging
  -> smoke test staging
  -> open or promote a production PR with the same tested image digests
  -> production sync requires approval
```

Image tags do not need to match across all components. A release set is coherent
when its metadata records the exact image reference and digest for every
component:

```text
backend-api
backend-practice
backend-beat
backend-worker
frontend
```

Partial releases are valid when only one component changes, but the desired
state must still record the full deployed set.

## When To Split Into A Separate GitOps Repository

Move GitOps desired state to a separate repository only when at least one of
these is true:

- platform/deployment ownership is separate from application development;
- production deploy rights must be isolated from code merge rights;
- multiple services share one platform repository;
- production approval/audit requirements need a separate change history;
- ExternalSecret, policy, cluster-addons, and application deployment lifecycles
  become independent enough to justify a separate repo.

Until then, keep the monorepo shape and design paths so they can be moved later
without changing the application manifests.

## Current Release Workflows

Keep these workflows during the transition:

- `.github/workflows/staging-release-package.yml`
- `.github/workflows/production-release-package.yml`

They are still useful as package generators and validation gates. After Argo CD
is introduced, staging can optionally generate a GitOps PR directly from the
release package workflow.

`.github/workflows/staging-release-overlay.yml` has been retired. It was a
low-level manual renderer and did not provide the same environment scoping,
digest resolution, or release metadata as the release package workflow.

## Current Repository State

Implemented:

- `deploy/gitops/` directory skeleton;
- `deploy/gitops/environments/staging` populated from a verified digest-pinned
  staging release package;
- `deploy/gitops/bootstrap/argocd/minikube.values.yaml` for pinned minikube
  Argo CD installation;
- `deploy/gitops/applications/argocd/noteverse-project.yaml` for scoped Argo CD
  delivery boundaries;
- `deploy/gitops/applications/argocd/noteverse-staging.yaml` for manual-sync
  staging delivery;
- `scripts/promote_release_package_to_gitops.py` for release-package promotion;
- `scripts/check_gitops_manifests.py` for strict GitOps desired-state
  validation;
- `scripts/argocd_create_repo_secret.ps1` for local creation of Argo CD
  repository credentials without committing tokens;
- GitHub Actions manifest validation now runs the GitOps guard;
- `.github/workflows/staging-release-package.yml` can open a staging GitOps PR
  when `open_gitops_pr=true`.

Not implemented yet:

- production GitOps PR generation workflow;
- production desired-state population;
- ExternalSecret integration;
- image signing/admission verification.

Current minikube status:

- Argo CD is installed with chart `argo/argo-cd` version `10.2.1`;
- `noteverse-staging` is created and bound to the scoped `noteverse`
  `AppProject`;
- sync remains manual;
- private repository access is configured through an Argo CD repository
  credential Secret;
- Argo CD can only sync after the GitOps desired-state path is committed and
  pushed to the remote branch referenced by `spec.source.targetRevision`.

## Security Requirements

- No database URLs, Redis URLs, S3 credentials, mail API keys, Hugging Face
  tokens, cookie secrets, or registry tokens in Git.
- No generated manifest artifact should contain Secret values.
- GitOps state should reference existing Secret names or future ExternalSecret
  resources.
- Production sync should require review and approval.

## Future Hardening

After digest-pinned GitOps deployment is stable, add:

- SBOM publication for each image;
- image signing with Cosign or equivalent;
- admission verification for signed production images;
- release runbooks linked from alert annotations;
- Argo CD project and RBAC boundaries for staging and production.

## Execution Plan

1. Keep using release packages as the authoritative deployment path while
   GitOps is introduced.
2. Promote verified staging release packages into
   `deploy/gitops/environments/staging`.
3. Validate GitOps desired state through `scripts/check_gitops_manifests.py`.
4. Install Argo CD in minikube and point it at the staging desired-state path.
5. Create Argo CD repository credentials for the private GitHub repository.
6. Prove sync, drift detection, rollback, and smoke-test workflow.
7. Add production desired-state path with stricter approval rules.
8. Add production GitOps PR generation after staging promotion is stable.
9. Keep staging sync manual until smoke tests and rollback rehearsal are proven.
