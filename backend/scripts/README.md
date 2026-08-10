# Backend Scripts

These scripts are owned by the backend runtime. Run them through the supported backend Docker environment unless the script explicitly documents another path.

| Script | Purpose | Safety |
| --- | --- | --- |
| `check_runtime.py` | Validates configuration and dependencies for a runtime role. | Read-only diagnostic. |
| `export_openapi.py` | Exports or verifies versioned HTTP API contracts. | Writes generated contracts unless `--check` is used. |
| `check_practice_matchmaker.py` | Diagnoses practice matchmaker availability. | Read-only diagnostic. |
| `create_operator.py` | Creates a local platform operator. | Mutates identity data; development only. |
| `rebuild_score_metadata.py` | Rebuilds score metadata projections. | Mutates durable projections; review arguments first. |
| `reset_alembic.py` | Resets Alembic state. | Destructive; disposable development databases only. |
| `prepare_model_assets.py` | Prepares model assets. | May download or materialize local assets. |
| `evaluate_practice_replay.py` | Evaluates practice replay fixtures. | Diagnostic/evaluation. |
| `legato_visual_probe.py` | Probes LEGATO output visually. | Diagnostic. |
| `transcoda_kern_visual_probe.py` | Probes Transcoda/Kern output visually. | Diagnostic. |

Keep one-off experiments out of this folder unless they are reproducible, documented, and have an owner. Backend-wide quality entry points are documented in [../README.md](../README.md).
