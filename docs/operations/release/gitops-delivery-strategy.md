# GitOps Delivery Strategy

Release packages contain digest-pinned component references, rendered manifests
and release metadata. GitOps desired state is owned in this repository under
`deploy/gitops/`; complete release metadata identifies the deployed component set
even when only one component changes.

## Staging delivery

The staging release-package workflow can open a GitOps PR when
`open_gitops_pr=true`. `scripts/promote_release_package_to_gitops.py` materializes
the package into staging desired state; `scripts/check_gitops_manifests.py`
validates it. The scoped Argo CD AppProject and staging Application live under
`deploy/gitops/applications/argocd/`. Staging sync is manual.

Argo CD reads the committed path and target revision configured in its
Application. Local unpushed files cannot change cluster desired state. Repository
credentials are operator-created Secrets; no tokens belong in Git.

## Environment boundaries

Staging desired state is populated. Production release packages are generated
by their own workflow; the production GitOps directory is not a populated
delivery target. A directory placeholder does not establish an operational
production sync contract.

Secrets are referenced by name, never embedded in desired state or package
artifacts. Rendered manifests must pass configuration/secret ownership checks.
Sync, smoke validation, drift inspection and rollback use exact release identities.
An image tag alone is insufficient to identify a deployed release set.

See [Release Package Runbook](release-package-runbook.md),
[Argo CD Runbook](argocd-minikube-runbook.md) and
[Production Preflight](../deployment/k8s-production-preflight-checklist.md).
