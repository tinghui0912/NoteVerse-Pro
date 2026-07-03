# Import Job Reliability Plan

## Current Flow

1. The client uploads each score image through `POST /api/v1/files/upload`.
2. The backend reads the request body, stores the file through the configured storage adapter, upserts the `uploads` row, and returns the SHA-256 `file_id`.
3. The client submits recognition through `POST /api/v1/import-jobs` or `POST /api/v1/import-jobs/batch` with one or more `file_id` values.
4. The backend verifies that the uploaded file IDs exist and belong to the submitting user, creates a `PENDING` import job row, then dispatches `process_images_job` to Celery with `task_id=job_uuid` and the durable upload file IDs.
5. The worker materializes those upload file IDs from the configured storage backend into its own `WORK_ROOT`, then updates the import job state while running the pipeline.

This is already a reasonable development-stage design because uploaded files are durable before import submission, and the database is the user-facing import job state source.

Terminology note: `ImportJob` is the product/database entity. Celery still uses the word
`task` for the background execution primitive, so `task_id=job_uuid` is intentional and
does not reintroduce the retired task-as-score model.

## Must Fix Before Production

### 1. Make Celery Execution Durable

Current risk: `process_images_task` can be acknowledged before the pipeline finishes. If a worker process dies mid-task, the task may not be redelivered and the database row can remain stuck in `RUNNING`.

Recommended changes:

- Configure `process_images_task` with `acks_late=True`.
- Configure `task_reject_on_worker_lost=True`.
- Keep `worker_prefetch_multiplier=1`.
- Ensure the pipeline can tolerate a retry for the same `job_uuid`.

Status: implemented. `process_images_task` now uses late acknowledgement and worker-lost rejection. The global Celery configuration keeps `worker_prefetch_multiplier=1`.

### 2. Add Stuck Import Job Recovery

Current risk: import job rows can remain in `PENDING` or `RUNNING` if dispatch fails after DB creation, the broker loses a message, or the worker dies after partial progress.

Recommended changes:

- Add a periodic reconciler job.
- Mark old `PENDING` import jobs as failed or requeue them.
- Mark old `RUNNING` import jobs as failed when their heartbeat is stale.
- Store `last_heartbeat_at` whenever a worker updates progress.

Status: implemented. Import jobs now have `last_heartbeat_at`, progress updates refresh it, and `run_import_job_maintenance` fails stale `PENDING` / `RUNNING` jobs on a periodic Celery beat schedule.

### 3. Make Import Job Submission Atomic Enough

Current risk: import job creation and Celery dispatch are separate operations. If DB creation succeeds but Celery dispatch fails, an import job exists without a queued Celery task.

Recommended changes:

- Catch dispatch failure and immediately mark the import job as failed with a dispatch error.
- Keep the stale `PENDING` reconciler as the safety net for broker loss or process crashes.
- Defer the DB outbox pattern until task volume, operational risk, or cross-service boundaries justify the extra table and dispatcher.

The outbox pattern is more enterprise-grade, but it is intentionally deferred for production v1 to keep the system simpler.

Status: implemented as the lightweight Phase 1.5 approach. Dispatch failure is caught and the import job is immediately marked failed. The DB outbox pattern is documented as Phase 2, not part of production v1.

### 4. Clean Up Orphan Uploads

Current risk: if the upload succeeds but the user leaves before submitting recognition, files and upload rows remain forever.

Recommended changes:

- Add `created_at` and `last_used_at` based cleanup rules if not already present.
- Periodically delete uploads not linked to any import job after a TTL.
- Keep linked uploads while import jobs exist.

Status: implemented. The maintenance job deletes uploads not linked through `import_job_uploads` after `ORPHAN_UPLOAD_TTL_SECONDS`.

## Worth Doing After The Core Reliability Work

### 1. Upload Sessions

Create an explicit upload session or draft import job before the files are uploaded. This gives the UI a durable container for progress, cancellation, retry, and cleanup.

Status: deferred. For the current image OCR flow, upload sessions add more state-machine complexity than value. Orphan upload cleanup covers the main failure mode for production v1.

### 2. Idempotent Submit API

Allow the frontend to pass an idempotency key. If the user double-clicks or the network retries the request, the backend returns the same import job instead of creating duplicates.

Status: implemented. Import job submission accepts a client-generated `idempotency_key`, `import_jobs` stores it under a per-user unique constraint, and the upload page reuses the same key across retry attempts for the current submission. The Celery payload now contains durable upload file IDs instead of API-local filesystem paths, so redelivery to another worker can re-materialize inputs from storage.

### 3. Stronger File Storage Boundary

Move from local disk to object storage for production deployments, or at least define a storage interface. Local disk is fragile under multi-pod deployment unless backed by shared persistent storage.

Status: implemented. Upload, preview, deletion, import job submission, orphan cleanup, avatar storage, XML reads/writes, rendered import artifacts, archives, and practice reads now go through `app.storage` instead of directly building durable filesystem paths in feature services. `FILE_STORAGE_BACKEND=local` is explicit configuration, with durable objects under `STORAGE_ROOT` and per-job scratch files under `WORK_ROOT`. The S3-compatible adapter materializes remote objects into job-local work files only when processing requires local bytes.

Storage adapter target shape:

- `put_bytes(key, content, content_type)`
- `exists(key)`
- `delete(key)`
- `public_url(key)`
- `materialize_to_local(key, target_path)`
- `download_url(key, filename=None, content_type=None)`

Recommended object keys:

- `scores/{sha256}.{ext}` for uploaded score source images.
- `avatars/{user_id}_{hash}.jpg` for user avatars.
- `jobs/{job_uuid}/original_image/001-page.jpg` for import raw inputs.
- `jobs/{job_uuid}/review_musicxml/<uuid>.musicxml` for review MusicXML.
- `jobs/{job_uuid}/preview_image/001-preview.svg` for rendered previews.
- `jobs/{job_uuid}/result_thumbnail/001-thumbnail.svg` for list thumbnails.

S3-compatible deployment notes:

- Add `boto3` to the backend runtime.
- Use `FILE_STORAGE_BACKEND=s3`.
- For Alibaba Cloud OSS, use the regional endpoint, for example `https://oss-cn-shenzhen.aliyuncs.com`, and the signing region without the `oss-` prefix, for example `S3_REGION=cn-shenzhen`.
- Alibaba Cloud OSS requires virtual-hosted style access for this adapter, so set `S3_FORCE_PATH_STYLE=false`.
- Keep access keys only in local `.env`, deployment secrets, or a secret manager. Do not commit them.

Download behavior:

- User-facing preview, image display, and single-file download endpoints keep backend authorization as the entry point.
- Display flows use `access-url` endpoints. They return short-lived inline signed URLs for S3-compatible storage and same-origin API URLs for local storage.
- Download flows keep attachment semantics. When the storage adapter can provide a short-lived object URL, the endpoint returns a `302` redirect to that signed URL.
- When the file only exists on local disk, the endpoint keeps returning `FileResponse`.
- Dynamic archives are still generated by the backend until archives are prebuilt and stored as objects.
- Browser direct-to-OSS display requires bucket CORS. Use the minimum rule: allow only the frontend origins, `GET` and `HEAD`, and expose `Content-Length`, `Content-Type`, `Content-Disposition`, and `ETag`.

Import artifact output status:

- Worker-side `replace_files()` now uploads recorded import artifacts through `app.storage` before writing artifact records.
- Import artifact records use `storage_backend`, `storage_key`, `filename`, and `page_number`; they no longer store local filesystem paths or render DPI.
- New import artifact objects use keys under `jobs/{job_uuid}/{kind}/`.
- Readers materialize by `storage_key`, so XML editing, practice sessions, archives, and downloads work against either local storage or S3-compatible object storage.
- Import job submission no longer passes API-local materialized paths to Celery. Workers receive upload file IDs and materialize them inside the worker process, which is required for late acknowledgement, retry, and multi-pod deployments.

### 4. Cancellation

Support user cancellation for queued import jobs and best-effort cancellation for running import jobs. Store cancelled state in DB and make pipeline steps check it between expensive operations.

### 5. Operational Monitoring

Expose metrics for:

- Upload success and failure count.
- Queue depth.
- Import job runtime by step.
- Stuck import job count.
- Worker failure and retry count.

## Recommended Execution Order

Completed:

1. Add Celery durable execution settings and import job idempotency safeguards.
2. Add import job heartbeat and stuck-job reconciler.
3. Add orphan upload cleanup.
4. Add dispatch failure handling.
5. Add frontend idempotency key.
6. Move storage behind an interface before multi-pod deployment.
7. Add S3-compatible storage and signed object access URLs.
8. Move Celery task payloads from API-local paths to durable upload file IDs.

Next:

1. Add operational metrics and dashboards for upload, queue, worker, and stuck-import-job behavior.
2. Consider user cancellation only after real user demand appears.
3. Consider DB outbox only if dispatch reliability becomes a measured operational problem.
4. Consider upload sessions only if the product adds large uploads, resumable upload, drafts, or cross-device resume.

Current implementation covers durable Celery acknowledgement, heartbeat-based stuck-import-job recovery, orphan upload cleanup, idempotent submission, dispatch failure marking, the storage boundary, S3-compatible object storage, worker-side input materialization, and signed object access URLs. The remaining production v1 work is now narrower: operational monitoring and real-world validation.
