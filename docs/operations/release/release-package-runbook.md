# Release Package Runbook

This runbook explains how to generate a complete NoteVerse Kubernetes release
package for staging/minikube or production.

A release package is not just rendered YAML. It is the deployment record for a
specific environment:

- rendered Kubernetes overlay;
- fully rendered manifest;
- `release-metadata.json`;
- exact image references for every deployable component;
- environment hosts and TLS Secret name;
- no secret values.

## Components In A Complete Release Set

Every release package must name all deployable application images:

```text
backend-api
backend-beat
backend-practice
backend-worker
frontend
platform-admin
```

The image tags do not have to be identical. A partial rollout is valid when
only one component changed, but the release package must still record the exact
image reference for every component so operators can answer:

```text
What exact application set is deployed?
```

## Image Reference Policy

Preferred production form:

```text
ghcr.io/<owner>/noteverse/backend-api@sha256:<digest>
```

Acceptable input form:

```text
ghcr.io/<owner>/noteverse/backend-api:<git-sha>
```

Rules:

- do not use `latest`;
- do not use local image names;
- do not use `:local`;
- do not rely on a mutable environment alias as the audit source of truth;
- if tags are supplied as workflow inputs, the release package workflow resolves
  them to digest-pinned image refs before rendering the deployable overlay.

## Staging / Minikube Package

The local minikube environment is the staging rehearsal environment. It should
consume the staging release package, not ad hoc local manifests.

Run the GitHub workflow:

```text
.github/workflows/staging-release-package.yml
```

If all component images were built with the same Git SHA, set:

```text
image_tag=<git-sha>
```

If you leave `image_tag` empty, the workflow uses the current
`deploy/gitops/environments/staging/release-metadata.json` image digests for
every component you did not explicitly override. This is the normal path for a
small staged rollout where only one or two images changed.

When a newly introduced deployable component has no entry in the current
metadata yet, provide its immutable image reference explicitly for that first
promotion. The first Platform Admin release therefore requires
`platform_admin_image` unless `image_tag` is supplied for a complete release.

For example, to update only the API image:

```text
backend_api_image=ghcr.io/<owner>/noteverse/backend-api:<new-sha-or-digest>
```

The release package will keep the current staging beat, practice, worker,
frontend, and Platform Admin image digests.

If one or more components use different tags and you do not want to inherit
from current staging, provide explicit image refs for every component:

```text
backend_api_image=ghcr.io/<owner>/noteverse/backend-api:<sha-a>
backend_beat_image=ghcr.io/<owner>/noteverse/backend-beat:<sha-a>
backend_practice_image=ghcr.io/<owner>/noteverse/backend-practice:<sha-b>
backend_worker_image=ghcr.io/<owner>/noteverse/backend-worker:<sha-c>
frontend_image=ghcr.io/<owner>/noteverse/frontend:<sha-d>
platform_admin_image=ghcr.io/<owner>/noteverse/platform-admin:<sha-e>
```

Download the `staging-release-package` artifact. It contains:

```text
build/k8s-release/staging/
build/k8s-release/staging.rendered.yaml
build/k8s-release/staging/release-metadata.json
```

Inspect the metadata before applying:

```powershell
Get-Content build/k8s-release/staging/release-metadata.json
```

If you only want a downloadable package for local inspection or one-off
minikube testing, leave `open_gitops_pr=false`.

If you want Argo CD to pick up this release through GitOps, run the workflow
with:

```text
open_gitops_pr=true
gitops_base_branch=main
```

The workflow will promote the digest-pinned package into
`deploy/gitops/environments/staging`, validate it, push a
`release/staging-<run-id>-<attempt>` branch, and open a PR. Merge that PR before
manually syncing Argo CD.

Apply through the repository release prepare script:

```powershell
.\scripts\minikube_app_release_prepare.ps1 `
  -RenderedOverlay build/k8s-release/staging `
  -BackendSecretEnvFile backend\.env.docker `
  -Apply `
  -Wait `
  -ScaleWorkerToZero `
  -SkipModelCacheWait
```

Use `-ScaleWorkerToZero` only while the Kubernetes GPU worker path is paused
and the worker is being tested through Docker Compose against the same
PostgreSQL, Redis, and S3 settings.

When `-BackendSecretEnvFile` is used, the prepare script filters the env file
to the required credential keys before creating `Secret/noteverse-backend-secret`.
The rendered ConfigMaps remain the source of truth for public/runtime settings
such as `FRONTEND_BASE_URL`, `BACKEND_CORS_ORIGINS`, `LOG_FORMAT`, S3 bucket
names, and model paths. This prevents a local `.env.docker` file from
accidentally overriding the release package's production-shaped configuration.

## Production Package

Run the GitHub workflow:

```text
.github/workflows/production-release-package.yml
```

The production workflow uses the GitHub `production` Environment. Enable
required reviewers on that Environment before using it for a real deployment.

Production package generation must use the same tested image refs from staging,
preferably digest refs. Do not rebuild a different production image from the
same commit after staging has passed.

If `image_tag` is empty, the workflow uses the current
`deploy/gitops/environments/production/release-metadata.json` image digests for
every component you did not explicitly override. This supports a production
patch release where only one image changes while the release package still
records the full deployed component set.

For a newly initialized production environment that does not yet have
`release-metadata.json`, provide either a shared `image_tag` for a full release
or explicit image refs for every component.

The production artifact contains:

```text
build/k8s-release/production/
build/k8s-release/production.rendered.yaml
build/k8s-release/production/release-metadata.json
```

## Environment Variables And Secrets

GitHub Environment variables provide non-secret render values such as:

```text
*_FRONTEND_HOST
*_API_HOST
*_TLS_SECRET
*_FRONTEND_BASE_URL
*_BACKEND_CORS_ORIGINS
*_CONTROL_PLANE_CORS_ORIGINS
*_AUTH_COOKIE_SECURE
*_MAIL_DEFAULT_SENDER
*_S3_ENDPOINT_URL
*_S3_REGION
*_S3_BUCKET
*_S3_PUBLIC_BASE_URL
*_S3_FORCE_PATH_STYLE
*_S3_PRESIGN_EXPIRE_SECONDS
```

`*_CONTROL_PLANE_CORS_ORIGINS` must be JSON with only the intended Platform
Admin origin, for example `["https://admin.staging.example.com"]`. It is
required even while the control-plane Deployment is dark so rendering cannot
silently invent a browser security policy when the runtime is enabled.

Database URLs, Redis URLs, cookie secrets, S3 access keys, mail API keys, and
Hugging Face tokens must already exist in the target cluster as Kubernetes
Secrets. They are not rendered into release package artifacts.

## Validation Checklist

Before applying:

- `release-metadata.json` lists every deployable image;
- `images` contains the digest-pinned refs used by the rendered overlay;
- `requested_images` contains the original operator-supplied refs;
- the workflow has inspected and resolved each image ref in GHCR before
  uploading the artifact;
- the environment, hosts, and TLS Secret are correct;
- rendered YAML passes strict validation;
- no Secret values exist in the artifact.

After applying:

- migration job succeeded;
- frontend is reachable through Gateway/TLS;
- API health passes;
- upload/import/review/score/share smoke path passes;
- realtime events are received;
- practice API health passes;
- logs, metrics, and traces are visible in Grafana.

## Promote A Downloaded Package Into GitOps Desired State

Use this manual path only when you downloaded a release package artifact and
intentionally want to promote it from your workstation. The preferred path is
`staging-release-package.yml` with `open_gitops_pr=true`.

After a staging release package has been applied and verified, promote the
same package into the in-repository GitOps staging directory:

```powershell
python scripts/promote_release_package_to_gitops.py `
  --source tmp/staging-release-package/staging `
  --environment staging `
  --overwrite
```

Then validate:

```powershell
python scripts/check_gitops_manifests.py
kubectl kustomize deploy/gitops/environments/staging
```

The promotion script copies only non-secret declarative files, rewrites the
relative Kustomize base path for the GitOps directory, and preserves
`release-metadata.json`. The GitOps guard fails if desired state contains:

- deployment placeholders;
- local development endpoints;
- obvious Secret values;
- mutable image tags instead of digest-pinned image references;
- missing release metadata.

Do not manually edit generated staging desired state except to repair the
promotion script itself. Normal staging promotion should update this directory
through a pull request generated from a release package.

## Hardening Backlog

Next production-grade improvements:

- optionally fail production package generation when any input is not already a
  digest ref;
- sign release package artifacts or attach build provenance;
- add production GitOps PR generation after staging GitOps promotion remains
  stable.
