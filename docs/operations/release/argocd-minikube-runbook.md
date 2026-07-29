# Argo CD Minikube Runbook

This runbook installs Argo CD into the production-like minikube staging cluster
and points it at the in-repository staging GitOps desired state.

The first rollout is intentionally manual-sync only. Do not enable automatic
sync until drift detection, rollback, and smoke tests are proven.

The minikube values intentionally reduce application-controller concurrency and
raise the cluster-info timeout. This is a local VM stability setting for qemu2
and should not be copied blindly into production. The upstream Argo CD
documentation recommends `ARGO_CD_UPDATE_CLUSTER_INFO_TIMEOUT` when slow cluster
network/API responses make cluster-info updates exceed the default timeout.

## Scope

Environment:

- cluster profile: `noteverse-lvm`
- Argo CD namespace: `argocd`
- application namespace: `noteverse-staging`
- desired state path: `deploy/gitops/environments/staging`
- Argo CD chart: `argo/argo-cd`
- pinned chart version: `10.2.1`
- Argo CD app version from chart: `v3.4.5`

## Prerequisites

The platform bootstrap must already be complete:

```powershell
kubectl get ns cert-manager envoy-gateway-system metallb-system observability topolvm-system
kubectl get ns noteverse-staging
```

The staging desired state must pass local validation:

```powershell
python scripts\check_gitops_manifests.py
kubectl kustomize deploy\gitops\environments\staging
```

The GitOps desired-state path must also exist in the remote Git repository and
branch that Argo CD reads. Argo CD does not read uncommitted local files.

Before creating or syncing the Application, commit and push:

```text
deploy/gitops/environments/staging
deploy/gitops/applications/argocd
deploy/gitops/bootstrap/argocd
scripts/check_gitops_manifests.py
scripts/promote_release_package_to_gitops.py
scripts/argocd_create_repo_secret.ps1
```

The application runtime Secrets must already exist in the cluster. The GitOps
directory references Secrets by name and does not store Secret values:

```powershell
kubectl -n noteverse-staging get secret noteverse-backend-secret
kubectl -n noteverse-staging get secret noteverse-registry-credentials
kubectl -n noteverse-staging get secret cloudflare-api-token-secret
```

## Install Argo CD

```powershell
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update argo

helm upgrade --install argocd argo/argo-cd `
  --namespace argocd `
  --create-namespace `
  --version 10.2.1 `
  -f deploy\gitops\bootstrap\argocd\minikube.values.yaml `
  --wait `
  --timeout 10m
```

Verify:

```powershell
kubectl -n argocd get pods
kubectl -n argocd get svc
```

If the first install is slow, check image pulls before changing manifests:

```powershell
kubectl -n argocd get events --sort-by=.lastTimestamp
kubectl -n argocd get pods
```

On Windows qemu2 minikube, the first pull of `quay.io/argoproj/argocd` and
Redis images can take several minutes.

## Configure Repository Access

If the GitHub repository is private, create a repository credential Secret.
Do not commit this token.

Use a fine-scoped GitHub token with repository read access:

```powershell
$env:GITHUB_REPO_TOKEN = "<token>"

.\scripts\argocd_create_repo_secret.ps1
```

For a public repository, this Secret is not required.

## Create The Staging Application

Apply the Argo CD Application resource:

```powershell
kubectl apply -k deploy\gitops\applications\argocd
```

Verify:

```powershell
kubectl -n argocd get appproject noteverse
kubectl -n argocd get application noteverse-staging
kubectl -n argocd describe application noteverse-staging
```

The Application intentionally has no `automated` sync policy. Initial sync
should be manual.

If Argo CD reports:

```text
app path does not exist
```

then the local GitOps files have not been pushed to the remote branch referenced
by `spec.source.targetRevision`. The staging Application uses
`targetRevision: main` intentionally; avoid `HEAD` here because it is less
explicit and can make first-time GitOps debugging noisier.

## Access Argo CD UI

Port-forward:

```powershell
kubectl -n argocd port-forward svc/argocd-server 18080:443
```

Open:

```text
https://127.0.0.1:18080
```

Get the initial admin password:

```powershell
kubectl -n argocd get secret argocd-initial-admin-secret `
  -o jsonpath="{.data.password}" |
  ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
```

## Manual Sync Validation

In the Argo CD UI, inspect `noteverse-staging` first. It should show the
rendered Kubernetes objects from:

```text
deploy/gitops/environments/staging
```

Then perform a manual sync.

Command-line equivalent:

```powershell
kubectl -n argocd patch application noteverse-staging `
  --type merge `
  -p '{"operation":{"sync":{"syncStrategy":{"hook":{}}}}}'
```

Verify application health:

```powershell
kubectl -n argocd get application noteverse-staging `
  -o jsonpath="{.status.sync.status} {.status.health.status}"
```

Then verify app workloads:

```powershell
kubectl -n noteverse-staging get pods
kubectl -n noteverse-staging get gateway,httproute,certificate
```

## Rollback Rehearsal

Rollback should be done by reverting the GitOps desired-state commit or by
promoting a previous digest-pinned release package back into
`deploy/gitops/environments/staging`, then manually syncing again.

Do not edit live Kubernetes resources by hand except for emergency recovery.

## Next Hardening

After manual sync is stable:

- add an Argo CD `AppProject` with explicit namespace and cluster-resource
  allowlists;
- add a staging GitOps PR workflow;
- add production desired state only after staging GitOps is proven;
- evaluate ExternalSecret integration for runtime Secrets;
- evaluate image signature verification after digest deployment is stable.
