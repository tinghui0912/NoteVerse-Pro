# Backend Scripts

These scripts are owned by the backend runtime. Run them through the supported backend Docker environment unless the script explicitly documents another path.

| Script | Purpose | Safety |
| --- | --- | --- |
| `check_runtime.py` | Validates configuration and dependencies for a runtime role. | Read-only diagnostic. |
| `export_openapi.py` | Exports or verifies versioned HTTP API contracts. | Writes generated contracts unless `--check` is used. |
| `create_operator.py` | Creates a local platform operator. | Mutates identity data; development only. |
| `rebuild_score_metadata.py` | Rebuilds score metadata projections. | Mutates durable projections; review arguments first. |
| `reset_alembic.py` | Resets Alembic state. | Destructive; disposable development databases only. |
| `repair_unpublished_practice_migration_state.py` | Repairs unpublished migration metadata before the migration entrypoint. | Mutates migration metadata. |
| `seed_integration_user.py` | Seeds a disposable integration-test identity. | Mutates test identity data. |
| `verify_practice_acoustic_model_asset.py` | Verifies the exact Practice acoustic asset locally and in a private OSS bucket. | Read-only by default; `--publish` uploads a missing object with overwrite forbidden. |
| `prepare_model_assets.py` | Prepares model assets. | May download or materialize local assets. |
| `legato_visual_probe.py` | Probes LEGATO output visually. | Diagnostic. |
| `transcoda_kern_visual_probe.py` | Probes Transcoda/Kern output visually. | Diagnostic. |

This directory contains runtime, operations, migration and developer-operational tools.
Backend-wide quality entry points are documented in [../README.md](../README.md).

Verify the Practice acoustic asset in the supported backend environment:

```sh
python scripts/verify_practice_acoustic_model_asset.py \
  --model /path/to/model.onnx \
  --report /tmp/practice-acoustic-model-verification.json
```

Both paths are explicit. Reports are local operational outputs and must not
contain credentials or signed URLs. An existing report is never overwritten.
Use `--publish` only when publishing a missing content-addressed object; the
private-bucket and exact-byte checks also apply to publication.
