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

Self-hosted Kubernetes (k3s or kubeadm) runs on cloud VMs with Cilium CNI
**1.20.5**, Linux kernel >= 5.10, a VXLAN/Geneve portable overlay and the L7 DNS
proxy enabled. [Cluster settings and pinned schema](../../../deploy/platform/cilium/README.md)
are infrastructure-owned; Hubble provides optional operational visibility.

A namespace-wide `cilium.io/v2` CiliumNetworkPolicy selects all application Pods.
It contains `ingress: []`, `egress: []` and explicitly sets
`enableDefaultDeny: {ingress: true, egress: true}`. Empty lists grant no traffic;
the explicit default-deny switches prevent omitted/empty-rule defaults from
leaving a direction unenforced. `[{}]` is never an allowlist entry.
`egressDeny.toCIDR` blocks `169.254.169.254/32` and `100.100.100.200/32` regardless
of additive allows, including DNS answers resolving to metadata addresses.
Application namespaces contain exclusively CiliumNetworkPolicy resources.

Offline validation proves schema and reviewed policy shape. Actual Cilium
agent/CRD admission, local-node/kubelet probe handling, Service translation,
DNS proxy visibility and packet enforcement require cluster acceptance.

| Runtime | Ingress | Egress |
| --- | --- | --- |
| Customer Web / Platform Admin | Envoy proxy TCP 3000 | DNS only |
| Customer API | Envoy TCP 8000; Prometheus TCP 8000 | PostgreSQL 5432; Redis 6379; object storage 443; DNS; OTLP 4317 |
| Control Plane | Envoy TCP 8000; Prometheus TCP 8000 | PostgreSQL 5432; Redis 6379; DNS; OTLP 4317 |
| Worker | None | PostgreSQL 5432; Redis 6379; object storage 443; mail 443; DNS; OTLP 4317 |
| Beat | None | PostgreSQL 5432; Redis 6379; DNS; OTLP 4317 |
| Migrator | None | PostgreSQL 5432; DNS |
| Model cache Pod | None | Model assets 443; DNS |

Peers combine namespace AND pod labels in the same endpoint selector, never two independent OR peers:

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

Each environment owns `external-egress.json` with these exact fields:

| JSON field | Release environment input | Authority |
| --- | --- | --- |
| `postgresql_cidrs` | `POSTGRESQL_EGRESS_CIDRS` | Private PostgreSQL TCP 5432, five DB runtimes |
| `redis_cidrs` | `REDIS_EGRESS_CIDRS` | Private Redis TCP 6379, API/Control Plane/Worker/Beat |
| `s3_fqdns` | `S3_EGRESS_FQDNS` | Exact object-storage hosts, API and Worker TCP 443 |
| `mail_fqdns` | `MAIL_EGRESS_FQDNS` | Exact mail API hosts, Worker TCP 443 |
| `model_fqdns` | `MODEL_EGRESS_FQDNS` | Exact artifact hosts, model-cache TCP 443 |

All inputs are JSON arrays and default to `[]` (fail closed). GitHub release
variables prefix these names with `STAGING_` or `PRODUCTION_`. They are public
network configuration, not Secrets. Runtime settings, endpoints and these lists
must agree, including the bucket hostname used by virtual-host S3 addressing,
regional endpoints and every required redirect/artifact hostname.

HTTPS rules contain only `toFQDNs.matchName` plus TCP 443. Validation rejects
wildcards, protocols, paths, ports, IP literals, malformed labels, trailing dots,
uppercase/non-normalized values and local/cluster names. Database/Redis CIDRs
must be canonical RFC1918 IPv4 or IPv6 ULA subnets; public, metadata, loopback and
wildcard networks are rejected. Cluster-local database selectors remain usable.
The five zero-public-internet roles have no external FQDN/HTTPS allowance.

All application DNS permits only kube-dns in kube-system, TCP/UDP 53, with
`rules.dns` so queries pass through Cilium's L7 proxy. The base DNS rule permits
`**.svc.cluster.local`, `**.cluster.local` and explicit cluster suffixes. In
Cilium 1.20.5 the leading `**.` matches multiple subdomain labels; this permits
Kubernetes `ndots:5` search forms, including negative searches for a fully
qualified external name under the cluster suffix. Each configured provider adds
only its exact DNS name. Internal search patterns permit DNS questions only;
`toFQDNs` always remains exact and never grants HTTPS to a wildcard or a
search-suffixed hostname. There is no L4-only DNS allow or alternate resolver.
Private database connection URLs use literal private IPs covered by the reviewed
CIDRs, or the declared cluster-local PostgreSQL/Redis Services. Arbitrary managed
DB DNS hostnames are not an implicit DNS permission.

```powershell
python scripts/container_security_contract.py --external-config deploy/application/overlays/staging/external-egress.json --output deploy/application/overlays/staging/external-egress.yaml
```

Release packaging passes `--external-egress-config <reviewed-file.json>` to
`scripts/render_k8s_release_overlay.py`. JSON and generated YAML travel together.
Manifest checks compare source and final rendered specs, including composed HA
and GitOps overlays, and reject additive policies, changed identities, ports,
DNS authority, secondary `specs` rule lists and schema-unknown fields. The pinned official v2 OpenAPI schema
is validated offline with a verified SHA-256 and strict structural fields;
Cilium's CEL/agent checks and DNS dataplane behavior still require a real cluster.

Cilium FQDN rules derive allowed IPs from observed DNS responses. They do not
validate TLS SNI, certificate identity, HTTP host or URLs, and a shared provider
IP remains shared at L3/L4. Application TLS verification and endpoint ownership
remain necessary. DNS TTL/connection tracking and CNAME/redirect behavior require
real-provider qualification. Model cache containers share the Pod's network
identity; only the preparation initContainer executes downloads.

Cluster acceptance checks exercise allowed and forbidden DNS/HTTPS names,
TCP/UDP DNS, service search suffixes, both metadata IPs, unauthorized public
resolvers, cross-runtime denials, kubelet readiness and Prometheus/OTLP traffic.
Observe Hubble DNS proxy flows and denied packets. Rendering alone does not
qualify the cluster or external endpoint allowlist.

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
  bounded scratch, exact default-deny/runtime traffic and exact FQDN/private CIDR contract.
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

Control Plane owns the internal durable metrics scrape alongside its process metrics.
Prometheus selects the Control Plane Service directly; Gateway rules expose only
`/api` and preserve the path. PostgreSQL infrastructure metrics belong to standard
`postgres_exporter` operated by the database infrastructure owner, not Python
application collectors or an application database role.

## Production image ownership

The modular monolith uses four production images: `noteverse-backend-core`,
`noteverse-backend-worker`, `noteverse-customer-web` and `noteverse-platform-admin`.
Customer API, Control Plane, Beat and the short-lived migrator share one immutable
core digest, with explicit `customer-api`, `control-plane`, `beat`, `migrator`
commands. Worker and model preparation share the Worker digest. Four long-lived
backend Deployments retain independent Settings, five runtime DB Secrets,
five PostgreSQL roles and workload-specific Cilium policies; an image is not an
authorization boundary. Model preparation's optional download credential and
registry-pull credential have separate purposes, without database authority.

Worker-deps is an internal qualified dependency cache; Quality and frontend dev
recipes serve CI/local development. Core excludes heavy processing dependencies.
[Image publication and release contract](../../operations/release/container-image-build-strategy.md)
checks numeric UID/GID, read-only operation, isolated imports and exact four-image
release ownership. GitOps without a trusted four-image publication is explicitly
BLOCKED; no existing digest is relabelled as a different image.
