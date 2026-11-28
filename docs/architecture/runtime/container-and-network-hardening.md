# Container and Network Hardening

## Process identity and writable storage

Every repository Dockerfile has final `USER 10001:10001`. Build instructions may
use root; running processes do not. Application Pods set `runAsNonRoot`, numeric
UID/GID/fsGroup 10001 and RuntimeDefault seccomp. Each container and initContainer
also denies privilege escalation, uses a read-only root filesystem, drops all
capabilities and sets `privileged: false`. Application Pods mount no Kubernetes
ServiceAccount token, including explicit projected tokens, and use no host network, PID or IPC namespace.

Python images disable bytecode writes. HOME, TMPDIR, XDG, matplotlib, Torch,
Numba, Paddle and quality-tool caches use `/tmp`. Models and soundfonts are
read from `/opt/noteverse/models`; Worker uses offline HuggingFace/Transformers
settings. Model download runs only in the model-cache preparation initContainer.
Paddle OCR inherits the Worker's numeric identity and receives no credentials.
The Legato source and Python environment remain read-only.

| Workload | `/tmp` emptyDir | Additional writable storage |
| --- | --- | --- |
| Customer API | 128 MiB | Work root 512 MiB |
| Control Plane | 64 MiB | None |
| Worker | 2 GiB | Work root 8 GiB |
| Beat | 64 MiB | Schedule/work root 64 MiB |
| Customer Web | 64 MiB | `/app/.next/cache`, 128 MiB |
| Platform Admin | 64 MiB | None |
| Observability Exporter | 32 MiB | None |
| Migrator | 32 MiB | None |
| Model cache preparation | 2 GiB | Explicit node-local model directory |
| Model cache simulation | 32 MiB | Explicit node-local simulation directory |

All application emptyDir volumes have size limits. Kubernetes accounts disk-backed
emptyDir against node ephemeral storage; sizeLimit is not a reservation. Capacity,
eviction and Worker concurrency require real workload qualification. Frontend
runtime assets remain read-only; only temporary files and Next image/data caches
have scratch mounts. Customer Web uses Next image optimization and its cache mount;
Platform Admin uses no Next Image or persistent server data cache and has no
writable `.next/cache`. SWC native bindings materialize in a user-owned temporary
cache and require executable `/tmp` mounts; Docker smoke tests explicitly use
`exec,nosuid,nodev`. Root filesystems remain read-only. Development images own their writable application directory;
bind/volume permissions must permit UID 10001, without a root entrypoint.

The node administrator provisions `/var/lib/noteverse/models` and the simulation
cache directory as UID/GID 10001 before scheduling model preparation. hostPath
uses `Directory`; kubelet does not create an inaccessible root-owned directory.
fsGroup does not repair hostPath permissions. Workers mount model assets read-only.
No privileged ownership-fixing initContainer is used.

## Application network contract

A namespace-wide NetworkPolicy denies ingress and egress. Additive policies grant
only the following paths. A NetworkPolicy-capable CNI is mandatory; YAML rendering
cannot prove dataplane enforcement. Kubernetes node/kubelet probe exceptions and
Service/DNAT behavior depend on the CNI and require a cluster acceptance check.

| Runtime | Ingress | Egress |
| --- | --- | --- |
| Customer Web / Platform Admin | Envoy proxy TCP 3000 | DNS only |
| Customer API | Envoy TCP 8000; Prometheus TCP 8000 | PostgreSQL 5432; Redis 6379; object storage 443; DNS; OTLP 4317 |
| Control Plane | Envoy TCP 8000 | PostgreSQL 5432; Redis 6379; DNS; OTLP 4317 |
| Worker | None | PostgreSQL 5432; Redis 6379; object storage 443; mail 443; DNS; OTLP 4317 |
| Beat | None | PostgreSQL 5432; Redis 6379; DNS; OTLP 4317 |
| Observability Exporter | Prometheus TCP 8000 | PostgreSQL 5432; DNS |
| Migrator | None | PostgreSQL 5432; DNS |
| Model cache Pod | None | Model assets 443; DNS |

Peers combine namespace AND pod selectors, never two independent OR peers:

- Envoy: namespace `envoy-gateway-system`, component `proxy`, managed-by `envoy-gateway`.
- Prometheus: namespace `observability`, `app.kubernetes.io/name: prometheus`.
- Collector: namespace `observability`, name `opentelemetry-collector`, instance `otel-collector`.
- Cluster PostgreSQL/Redis: namespace `noteverse-data`, name `postgresql`/`redis`.
- DNS: namespace `kube-system`, `k8s-app: kube-dns`, UDP and TCP 53.

OTLP is a narrow exception required by the configured tracing exporter; it grants
no general access to the observability namespace. Collector ingress accepts only
these application identities and Prometheus metrics. Its egress permits Tempo
4317 and DNS. Apply `deploy/observability/application-network-policy.yaml` alongside
the observability releases. There is no application-to-Control Plane, frontend-to-
API, Gateway-to-Worker or background ingress allowance.

## External destinations

Standard Kubernetes NetworkPolicy has no FQDN destination authority. Each environment
owns `external-egress.json`, with explicit lists for `postgresql`, `redis`,
`object_storage`, `mail` and `model_assets`. Empty lists deny those external paths.
Checked-in lists are empty; they are not a production connectivity qualification.
Cluster-local PostgreSQL/Redis selectors remain usable where deployed.

Review the provider's maintained CIDRs and exact configured endpoints, then render:

```powershell
python scripts/container_security_contract.py --external-config deploy/application/overlays/staging/external-egress.json --output deploy/application/overlays/staging/external-egress.yaml
```

Release packaging accepts `--external-egress-config <reviewed-file.json>` on
`scripts/render_k8s_release_overlay.py`. Omission retains deny-by-default lists.
Both JSON and generated YAML travel with the release. Manifest checks compare
them and reject undeclared additive policies, wrong ports or selectors, wildcard
networks and private HTTPS provider destinations. Database/Redis private CIDRs
are allowed at their fixed ports. Source IPs, Pod/Service CIDRs, IPv6 and changing
cloud/CDN addresses require environment review; do not snapshot DNS answers as
permanent authorization. CIDRs and ports do not bind an HTTPS hostname; shared
CDN addresses require an explicit egress design when host-level isolation is
necessary. If stable provider CIDRs are unavailable, keep the path
closed until the cluster owner selects an explicit, enforceable egress design.

Policies are pod-scoped: the model-cache initContainer and idle cache-ready
container share a network identity. Only the initContainer executes downloads;
NetworkPolicy does not distinguish individual containers inside that Pod.

## Gateway and client identity

Both HTTPS listeners route `/api` directly to their HTTP runtime; `/` routes to
its frontend. Customer API uses port 8000; Control Plane uses port 8000; frontends
use port 3000. Gateway HSTS and the 32 MiB Customer / 512 KiB Admin request limits
remain authoritative at the edge. Gateway preserves application nonce CSP.

Production frontend configurations emit no API rewrite. Development-only rewrites
support local browser origins 3000/3001 with direct API ports 8000/8002. Local
settings use `TRUSTED_PROXY_HOPS=0`; the API uses the transport peer in this topology,
not a claimed client XFF. Deployed settings use exactly one trusted hop and an
explicit Envoy Pod CIDR. Uvicorn disables automatic proxy-header rewriting.
Envoy appends its downstream peer to XFF; the API's configured suffix extraction
ignores client-injected leftmost values. An extra L7 proxy requires a reviewed hop
and CIDR contract, not an arbitrary increase in trust. Same-origin cookies and
BrowserOriginGuard remain unchanged.

## Observability and platform infrastructure

`scripts/harden_observability_manifests.py` is the common Helm post-renderer for
the fixed chart versions in `scripts/render_observability_helm.py`. It hardens
rendered Pods and Prometheus/Alertmanager Pod templates, including init containers,
sets UID/GID 10001, bounds emptyDir at 128 MiB by default, and mounts host logs
read-only. Grafana ownership-changing init is disabled; fsGroup owns PVC access.
Loki rule-discovery sidecar is disabled because no rule-discovery API is required.
Node log ACLs must grant UID 10001 read access for Fluent Bit; no root fallback is
provided. PVCs and node logs require real cluster permission qualification.

Every Helm install/upgrade uses the same post-renderer:

```text
--post-renderer python --post-renderer-args scripts/harden_observability_manifests.py
```

Kubernetes API token exceptions are explicit: Prometheus service discovery,
Prometheus Operator reconciliation, kube-state-metrics cluster reads, Grafana
ConfigMap dashboard discovery when its sidecar is enabled, and Fluent Bit Kubernetes metadata.
Grafana discovery has namespaced RBAC for ConfigMaps only in `observability`;
it has no Secret read grant. The static-dashboard profile mounts no Grafana API token. Their chart
RBAC remains the API authorization boundary. Loki, Tempo, Collector, Alertmanager,
node exporter and application workloads receive no token. The node exporter alone
uses host observation namespaces and read-only host mounts for node metrics.

The application manifests contain no PostgreSQL/Redis workload. Platform charts
for Envoy/cert-manager/Argo CD perform Kubernetes reconciliation and need their
own RBAC/token. OpenEBS LVM and MetalLB/CNI are cluster-privileged infrastructure,
not application identities; their host/kernel privileges cannot be removed by
application policy. Their pinned chart values and cluster admission policies
require a separate infrastructure audit; no claim of uniform application-level
hardening is made for operator-generated storage/network Pods.

## Executable verification

- `backend_security_regression.py`: security/architecture plus session, password,
  email-link and fresh-schema tests. Any skipped/xfail check or empty run fails.
  Explicit real PostgreSQL and Redis URLs are required.
- `backend-quality.yml`: runs this gate separately before full backend pytest.
- `container_security_contract.py`: Docker numeric identity, Pod/init security,
  bounded scratch, exact default-deny/runtime traffic and external CIDR contract.
- Application/GitOps/observability checkers share these validators; browser checks
  enforce direct API routing, exact body budgets, HSTS and CSP header ownership.
- Observability CI renders both environment profiles with fixed charts and the
  common post-renderer. Policy mutation tests reject relaxed contexts and networks.

Frontend image workflows execute `frontend_image_security_smoke.mjs` without
network access. It checks UID/GID, root-write rejection, writable scratch/cache,
and a 200 login document with CSP. Backend image publication executes the offline
packaging contract with read-only root, no capabilities and no privilege escalation.

Image builds and read-only container smoke checks establish process/filesystem
compatibility. CNI enforcement, Envoy client IP behavior, GPU/OCR model execution,
real object storage, Practice hardware and production volumes remain separate
live-environment acceptance checks. Dependency security upgrades have their own
change scope.
