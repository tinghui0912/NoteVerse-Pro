# Import Job Migration Plan

## Goal

Rename the pre-score upload/OCR/review pipeline from the broad `ProcessingJob`
language to the narrower `ImportJob` language.

The current job system represents one product workflow:

```text
Upload files -> OCR/OMR import pipeline -> Review -> Confirm -> Score
```

It should not become a catch-all container for unrelated AI work such as
fingering, thumbnail rendering, exports, or background maintenance tasks.

## Target Model

Backend domain names:

- `ProcessingJob` -> `ImportJob`
- `ProcessingJobStep` -> `ImportJobStep`
- `ProcessingJobUpload` -> `ImportJobUpload`
- `ProcessingArtifact` -> `ImportArtifact`
- `ProcessingJobState` -> `ImportJobState`
- `ProcessingJobStepStatus` -> `ImportJobStepStatus`

Database tables:

- `processing_jobs` -> `import_jobs`
- `processing_job_steps` -> `import_job_steps`
- `processing_job_uploads` -> `import_job_uploads`
- `processing_artifacts` -> `import_artifacts`

API:

- `/api/v1/jobs` -> `/api/v1/import-jobs`

Frontend:

- `ProcessingJob` -> `ImportJob`
- `jobsApi` -> `importJobsApi`
- `useJobDetail`, `useJobList`, `useSubmitJob`, `useDeleteJob` -> import job equivalents

State language:

- `PENDING`: created but not yet picked up
- `RUNNING`: worker pipeline is executing
- `PENDING_REVIEW`: import output is ready for human review
- `CONFIRMED`: review has been confirmed and a canonical Score exists
- `FAILURE`: import failed

## Non-Goals

- Do not introduce a generic `PipelineJob`.
- Do not move thumbnail rendering, fingering generation, exports, or email work into this model.
- Do not change public route semantics for `/upload` and `/review/:jobId`.
- Do not keep compatibility aliases for `/api/v1/jobs`.

## Execution Plan

### Phase 1: Backend model/API/type rename

- Rename backend model file and classes.
- Rename backend `modules/jobs` to `modules/import_jobs`.
- Rename database tables, constraints, indexes, and enum names in the squashed baseline migration.
- Rename API prefix to `/import-jobs`.
- Rename state values `PROGRESS` -> `RUNNING` and `SUCCESS` -> `CONFIRMED`.
- Update review, score creation, worker, pipeline, notifications, and tests.

### Phase 2: Frontend API/type rename

- Rename job API module, hooks, and types.
- Update upload, review, my-scores, editor source image loading, and notifications links.
- Keep user-facing route params as `jobId`.

### Phase 3: Documentation cleanup

- Update active architecture docs to use `ImportJob`.
- Mark old `ProcessingJob` references in historical ADRs as historical context only.

### Phase 4: Verification

- Backend lint and targeted tests.
- Frontend lint, typecheck, and targeted unit tests.
- Rebuild baseline migration on a temporary database and run `alembic check`.

## Status

- [x] Phase 1 backend rename
- [x] Phase 2 frontend rename
- [x] Phase 3 docs cleanup
- [x] Phase 4 verification

## Verification Log

- Backend lint: `docker compose -f docker-compose.backend-dev.yml run --rm api ruff check app tests alembic`
- Backend targeted tests: `docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_score_revision_services.py tests/test_service_regressions.py tests/test_import_job_execution_service.py tests/test_import_job_reliability_contract.py tests/test_config_runtime.py tests/test_api_smoke.py -q`
- Frontend lint: `npm run lint`
- Frontend typecheck: `npm run typecheck`
- Frontend targeted tests: `npm run test:unit -- tests/unit/my-scores-views.test.ts tests/unit/upload-workflow.test.ts`
- Frontend import contract test: `npm run test:unit -- tests/unit/import-job-upload-contract.test.ts`
- Baseline schema: temporary database `noteverse_pro_import_job_tmp`, `alembic upgrade head && alembic check`
