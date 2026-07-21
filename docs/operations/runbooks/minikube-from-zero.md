# Minikube From Zero Runbook

This is the operator entry point for rebuilding a local minikube environment
from scratch. It links to the detailed runbooks instead of duplicating every
command, and it marks which steps are manual and which are covered by scripts.

Use this runbook when:

- the minikube cluster was deleted;
- Docker Desktop was reset;
- local Kubernetes resources need to be recreated from a clean state;
- a production-like local smoke test is required before cloud Kubernetes exists.

## Read First

Read these documents in order:

1. [Container Image Build Strategy](../release/container-image-build-strategy.md)
2. [Minikube Local Kubernetes Runbook](minikube-local-k8s-runbook.md)
3. [Minikube Observability Runbook](../observability/minikube-observability-runbook.md)
4. [Kubernetes Ingress And TLS](../deployment/k8s-ingress-and-tls.md)
5. [Kubernetes Secrets And Storage Template](../deployment/k8s-secrets-and-storage-template.md)
6. [Kubernetes Application Runtime Contract](../../architecture/runtime/k8s-application-runtime-contract.md)

The local environment should stay production-shaped:

- model assets: node-local model cache prepared by the model-cache DaemonSet;
- user uploads, score sources, rendered pages, and audio: S3-compatible object
  storage;
- PostgreSQL: local managed service on the host machine;
- Redis: local managed service on the host machine;
- observability: Fluent Bit, Loki, Prometheus, Grafana, OpenTelemetry Collector,
  and Tempo in Kubernetes.

## Manual Versus Scripted Steps

| Area | Manual | Scripted |
| --- | --- | --- |
| Tool installation | Docker Desktop, kubectl, Helm, minikube, PowerShell | none |
| Cluster creation | `minikube start`, node count, ingress controller | none |
| Local DNS stability | verify two-node CoreDNS and remove local-only kube-dns policy if present | `scripts/minikube_bootstrap.ps1 -ApplyDnsFix` |
| Images | choose registry path, tag, and build args | image commands are documented in the runbook |
| Application overlay | choose namespace, hostnames, image tags, S3 settings | `scripts/render_k8s_release_overlay.py` |
| Manifest validation | review generated manifests | `scripts/check_k8s_application_manifests.py`, `scripts/quality.ps1 -Check k8s-minikube` |
| Observability overlay | choose minikube or production profile | `scripts/render_observability_helm.py`, `scripts/check_observability_manifests.py` |
| Secrets | create real local-only Secret values | no committed Secret manifests |
| Smoke tests | choose target URL and smoke account | `scripts/k8s_smoke_storage.py`, `scripts/k8s_smoke_derived_assets.py` |
| Runtime checks | inspect failed pods and logs when needed | `scripts/minikube_bootstrap.ps1 -ValidateTracing`, container `scripts/check_runtime.py` |

## Execution Order

1. Start or recreate minikube.

   Follow the cluster sizing, ingress, image, and registry guidance in
   [Minikube Local Kubernetes Runbook](minikube-local-k8s-runbook.md).

2. If testing two minikube nodes, apply the local DNS stability check.

   ```powershell
   .\scripts\minikube_bootstrap.ps1 -ApplyDnsFix
   ```

   This scales CoreDNS and makes sure `kube-dns` keeps normal cluster-wide
   endpoint routing. Do not set `internalTrafficPolicy: Local` on `kube-dns`.

3. Build and publish uniquely tagged images.

   Use GHCR or the same private registry shape used by CI.
   Do not use `minikube image load` for NoteVerse staging rehearsal.

4. Render the application overlay.

   Use the minikube environment, test domain, image tags, S3 test bucket
   settings, and cookie host settings described in
   [Minikube Local Kubernetes Runbook](minikube-local-k8s-runbook.md).

5. Create local Kubernetes Secrets deliberately.

   Do not apply partial Secret manifests. Use a full Secret value set derived
   from local-only values. The required keys are listed in
   [Kubernetes Secrets And Storage Template](../deployment/k8s-secrets-and-storage-template.md).

6. Apply node labels, TLS Secret, ConfigMaps, Secrets, and workloads.

   The model cache is a node-local DaemonSet-managed cache. Label only nodes
   that should host worker pods with `noteverse.io/model-cache=enabled`.
   Object assets must continue using S3 so local behavior stays close to
   production. For production-flow rehearsal, use cert-manager with the
   Cloudflare DNS-01 staging issuer and a real test domain. Use mkcert or
   self-signed TLS only for quick development smoke tests.

7. Deploy observability.

   Follow [Minikube Observability Runbook](../observability/minikube-observability-runbook.md).
   Validate that Grafana can see Prometheus, Loki, and Tempo.

8. Run smoke checks.

   ```powershell
   .\scripts\quality.ps1 -Check k8s-minikube
   .\scripts\minikube_bootstrap.ps1 -ValidateTracing
   ```

   Then run the storage and derived-asset smoke tests from the minikube runbook.

9. Manually test the core product path.

   Use a local smoke account and verify:

   - login;
   - upload;
   - review;
   - confirm score;
   - edit and save;
   - derived thumbnail and audio update;
   - billing storage usage updates;
   - delete and cleanup release quota.

## Known Pitfalls Already Captured

- Multi-node minikube can expose DNS instability when CoreDNS has too few
  replicas, cross-node DNS forwarding is unhealthy, or `kube-dns` was changed
  to local-only endpoint routing.
- `minikube image load` is intentionally excluded from the staging rehearsal
  path because it bypasses production-style image pulls.
- Local staging uses GHCR for image publication and pulls. Do not run a local
  registry for NoteVerse production-shaped minikube rehearsal.
- Do not use fixed `:local` tags for release-like tests; use unique tags or
  digests.
- Do not use local filesystem object storage for app assets in minikube when the
  target production model is S3.
- Do not access authenticated write flows through a frontend service
  port-forward unless backend `FRONTEND_BASE_URL`, `BACKEND_CORS_ORIGINS`,
  `AUTH_COOKIE_SECURE`, and TLS settings were rendered for that exact origin.
  Prefer HTTPS ingress testing through the same domain rendered into the
  application overlay.
- Hugging Face and model assets are large; validate available local node disk
  before enabling the model-cache DaemonSet.
- Do not commit generated Secrets or copied `.env` files.

## Definition Of Done

The local minikube rebuild is complete only when:

- application and observability manifests render and validate;
- all required application pods are ready;
- API runtime checks pass;
- tracing smoke reaches Tempo;
- storage smoke can create and delete object-backed assets;
- derived-asset smoke can generate and clean up render/playback assets;
- the manual upload-to-delete product path works without exposing internal
  infrastructure details to the UI.
