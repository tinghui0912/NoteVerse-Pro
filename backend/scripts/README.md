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
| `prepare_model_assets.py` | Prepares model assets. | May download or materialize local assets. |
| `legato_visual_probe.py` | Probes LEGATO output visually. | Diagnostic. |
| `transcoda_kern_visual_probe.py` | Probes Transcoda/Kern output visually. | Diagnostic. |

This directory contains runtime, operations, migration and developer-operational tools.
Research and qualification tools belong to [../research/tools/](../research/tools/).
Backend-wide quality entry points are documented in [../README.md](../README.md).
