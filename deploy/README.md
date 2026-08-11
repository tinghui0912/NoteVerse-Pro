# NoteVerse Deployment Index

This directory contains deployment source templates, GitOps desired state,
platform prerequisites, and observability values. These folders are deliberately
not interchangeable.

## Source and immutability rules

| Path | Role | Edit policy |
| --- | --- | --- |
| `application/base/` | Reusable Kustomize base for NoteVerse application workloads. | Edit by normal application/deployment code review. It must not contain environment-specific images, domains, or credentials. |
| `application/overlays/staging/` | Public staging shape template and local production-flow rehearsal overlay. | Edit when the reusable staging shape changes. Do not treat it as the live GitOps desired state. |
| `application/overlays/production/` | Public production shape template. | Keep placeholder-safe. Real production domains, digests, and secret references belong in a private overlay or promoted GitOps state. |
| `gitops/environments/staging/` | Current digest-pinned staging desired state promoted from a release package. | Do not hand-edit generated values. Update through the release-package promotion flow and review the resulting pull request. |
| `gitops/environments/production/` | Future production Argo CD desired-state target. | Must be digest-pinned, reviewed, and free of raw Secret values before production sync. |
| `platform/` | Cluster-level prerequisites such as Gateway API, cert-manager, and storage examples. | Owned by operators, applied before application releases. |
| `observability/` | Shared observability Helm values and environment overlays. | Keep component choices shared; put storage, retention, credentials, and scale differences in environment overlays. |

## Promotion model

Application changes flow from source templates to immutable desired state:

```text
deploy/application/base + deploy/application/overlays/<env>
  -> release package rendering and image digest substitution
  -> deploy/gitops/environments/<env>
  -> Argo CD sync
```

`deploy/gitops/environments/*/base` is a rendered release snapshot. It may look
similar to `deploy/application/base`, but it is intentionally digest-pinned and
release-scoped. Do not try to make those directories byte-for-byte identical.

## Related documentation

- [Kubernetes Application Runtime Contract](../docs/architecture/runtime/k8s-application-runtime-contract.md)
- [Production Deployment Guide](../docs/operations/deployment/production-deployment-guide.md)
- [Kubernetes Deployment Runbook](../docs/operations/deployment/k8s-deployment-runbook.md)
- [Kubernetes Secrets And Storage Template](../docs/operations/deployment/k8s-secrets-and-storage-template.md)
- [GitOps Evolution Plan](../docs/operations/release/gitops-evolution-plan.md)
- [Minikube From Zero Runbook](../docs/operations/runbooks/minikube-from-zero.md)
