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

If one or more components use different tags, provide explicit image refs for
those components and set every unchanged component to its intended current
image ref:

```text
backend_api_image=ghcr.io/<owner>/noteverse/backend-api:<sha-a>
backend_beat_image=ghcr.io/<owner>/noteverse/backend-beat:<sha-a>
backend_practice_image=ghcr.io/<owner>/noteverse/backend-practice:<sha-b>
backend_worker_image=ghcr.io/<owner>/noteverse/backend-worker:<sha-c>
frontend_image=ghcr.io/<owner>/noteverse/frontend:<sha-d>
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
*_AUTH_COOKIE_SECURE
*_MAIL_DEFAULT_SENDER
*_S3_ENDPOINT_URL
*_S3_REGION
*_S3_BUCKET
*_S3_PUBLIC_BASE_URL
*_S3_FORCE_PATH_STYLE
*_S3_PRESIGN_EXPIRE_SECONDS
```

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

## Hardening Backlog

Next production-grade improvements:

- optionally fail production package generation when any input is not already a
  digest ref;
- sign release package artifacts or attach build provenance;
- evolve from downloadable package artifacts to GitOps PRs after minikube and
  production package flow is stable.
