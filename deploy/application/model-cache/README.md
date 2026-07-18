# Model Cache Manifests

This directory contains optional manifests for validating and evolving the
node-local model cache topology.

These manifests are intentionally not referenced by the default application
Kustomize base. They are operational building blocks that should be copied,
patched, or included by a private environment overlay when that environment is
ready for node-local model caching.

## Files

- `model-cache-sim-daemonset.yaml`
  - lightweight local/minikube topology test;
  - writes a tiny `manifest.json` into a node-local host path;
  - does not download real models.

- `model-cache-agent-daemonset.yaml`
  - production-oriented shape for per-node model cache initialization;
  - uses the backend runtime image and `backend/scripts/prepare_model_assets.py`;
  - mounts `/var/lib/noteverse/models` as node-local cache;
  - validates only model assets, not database, Redis, or Celery.

## Which Manifest To Use

- Minikube topology simulation: use `model-cache-sim-daemonset.yaml` to verify
  DaemonSet scheduling and node-local cache shape without duplicating the full
  model set.
- Real minikube/staging/production runtime: use
  `deploy/application/base/model-cache-agent-daemonset.yaml`. It prepares the
  node-local model cache under `/var/lib/noteverse/models`, while API and worker
  pods mount that same path read-only at `/opt/noteverse/models`.

## Topology

```text
model source of truth
  -> model-cache DaemonSet
    -> node-local model directory
      -> worker Deployment read-only mount
```

The worker remains a `Deployment`; it should be scheduled only onto nodes that
have a verified model cache. In production, that readiness gate can be
implemented with node labels, taints/tolerations, or a dedicated scheduling
policy. Do not let ordinary worker pods mutate the model cache.
