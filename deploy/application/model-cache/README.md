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
  node-local model cache under `/var/lib/noteverse/models`. Worker pods mount
  that same path read-only at `/opt/noteverse/models`; API pods do not require
  model-cache scheduling.

## Storage Boundary

The model cache is node capability, not application business state. It is
therefore intentionally modeled as node-local storage:

- host/node path: `/var/lib/noteverse/models`
- container path: `/opt/noteverse/models`

The two paths do not need to be identical. The host path names the durable
node-local location; the container path gives every runtime pod a stable
application-facing `MODEL_ROOT`.

Model files are large, read-mostly assets and are best served from node-local
disks for worker throughput. In production this can be implemented with local
PVs or another node-local storage abstraction; in minikube the same Kubernetes
shape is rehearsed with a hostPath-backed node directory.

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

## Asset Sources

`noteverse-model-cache-agent` runs `backend/scripts/prepare_model_assets.py` in
an init container. The script prepares the node cache as follows:

- Hugging Face repositories come from `HF_MODEL_REPOSITORIES` and are downloaded
  with `huggingface_hub.snapshot_download` into
  `/opt/noteverse/models/huggingface/hub`. The active application overlays
  include `guangyangmusic/legato` and
  `meta-llama/Llama-3.2-11B-Vision`; Legato loads the Llama vision encoder at
  runtime.
- `FluidR3_GM.sf2` is copied from the backend runtime image system soundfont
  directory into `/opt/noteverse/models/soundfonts/FluidR3_GM.sf2`.
- PaddleOCR model directories are prepared through PaddleOCR/PaddleX bootstrap
  and stored under `/opt/noteverse/models/paddleocr/official_models`.

The agent validates the configured model set; it does not garbage collect old
repositories removed from `HF_MODEL_REPOSITORIES`. Clean stale node-local cache
manually after changing the model set.
