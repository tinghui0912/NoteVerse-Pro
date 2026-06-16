# Upload And Task Reliability Plan

## Current Flow

1. The client uploads each score image through `POST /api/v1/files/upload`.
2. The backend reads the request body, stores the file through the configured storage adapter, upserts the `uploads` row, and returns the SHA-256 `file_id`.
3. The client submits recognition through `POST /api/v1/tasks/submit-batch` with one or more `file_id` values.
4. The backend verifies that the uploaded file IDs exist and belong to the submitting user, creates a `PENDING` task row, then dispatches `process_images_task` to Celery with `task_id=task_uuid` and the durable upload file IDs.
5. The worker materializes those upload file IDs from the configured storage backend into its own `WORK_ROOT`, then updates the database task state while running the pipeline.

This is already a reasonable development-stage design because uploaded files are durable before task submission, and the database is the user-facing task state source.

## Must Fix Before Production

### 1. Make Celery Execution Durable

Current risk: `process_images_task` can be acknowledged before the pipeline finishes. If a worker process dies mid-task, the task may not be redelivered and the database row can remain stuck in `PROGRESS`.

Recommended changes:

- Configure `process_images_task` with `acks_late=True`.
- Configure `task_reject_on_worker_lost=True`.
- Keep `worker_prefetch_multiplier=1`.
- Ensure the pipeline can tolerate a retry for the same `task_uuid`.

Status: implemented. `process_images_task` now uses late acknowledgement and worker-lost rejection. The global Celery configuration keeps `worker_prefetch_multiplier=1`.

### 2. Add Stuck Task Recovery

Current risk: task rows can remain in `PENDING` or `PROGRESS` if dispatch fails after DB creation, the broker loses a message, or the worker dies after partial progress.

Recommended changes:

- Add a periodic reconciler job.
- Mark old `PENDING` tasks as failed or requeue them.
- Mark old `PROGRESS` tasks as failed when their heartbeat is stale.
- Store `last_heartbeat_at` whenever a worker updates progress.

Status: implemented. Tasks now have `last_heartbeat_at`, progress updates refresh it, and `run_task_maintenance` fails stale `PENDING` / `PROGRESS` tasks on a periodic Celery beat schedule.

### 3. Make Task Submission Atomic Enough

Current risk: `_create_pending_task()` and `_dispatch_batch_processing()` are separate operations. If DB creation succeeds but Celery dispatch fails, a task exists without a queued job.

Recommended changes:

- Catch dispatch failure and immediately mark the task as failed with a dispatch error.
- Keep the stale `PENDING` reconciler as the safety net for broker loss or process crashes.
- Defer the DB outbox pattern until task volume, operational risk, or cross-service boundaries justify the extra table and dispatcher.

The outbox pattern is more enterprise-grade, but it is intentionally deferred for production v1 to keep the system simpler.

Status: implemented as the lightweight Phase 1.5 approach. Dispatch failure is caught and the task is immediately marked failed. The DB outbox pattern is documented as Phase 2, not part of production v1.

### 4. Clean Up Orphan Uploads

Current risk: if the upload succeeds but the user leaves before submitting recognition, files and upload rows remain forever.

Recommended changes:

- Add `created_at` and `last_used_at` based cleanup rules if not already present.
- Periodically delete uploads not linked to any task after a TTL.
- Keep linked uploads while tasks exist.

Status: implemented. The maintenance job deletes uploads not linked through `task_uploads` after `ORPHAN_UPLOAD_TTL_SECONDS`.

## Worth Doing After The Core Reliability Work

### 1. Upload Sessions

Create an explicit upload session or draft task before the files are uploaded. This gives the UI a durable container for progress, cancellation, retry, and cleanup.

Status: deferred. For the current image OCR flow, upload sessions add more state-machine complexity than value. Orphan upload cleanup covers the main failure mode for production v1.

### 2. Idempotent Submit API

Allow the frontend to pass an idempotency key. If the user double-clicks or the network retries the request, the backend returns the same task instead of creating duplicates.

Status: implemented. `submit-batch` accepts a client-generated `idempotency_key`, `tasks` stores it under a per-user unique constraint, and the upload page reuses the same key across retry attempts for the current submission. The Celery payload now contains durable upload file IDs instead of API-local filesystem paths, so redelivery to another worker can re-materialize inputs from storage.

### 3. Stronger File Storage Boundary

Move from local disk to object storage for production deployments, or at least define a storage interface. Local disk is fragile under multi-pod deployment unless backed by shared persistent storage.

Status: implemented. Upload, preview, deletion, task submission, orphan cleanup, avatar storage, XML reads/writes, rendered task artifacts, archives, and practice reads now go through `app.storage` instead of directly building durable filesystem paths in feature services. `FILE_STORAGE_BACKEND=local` is explicit configuration, with durable objects under `STORAGE_ROOT` and per-task scratch files under `WORK_ROOT`. The S3-compatible adapter materializes remote objects into task-local work files only when processing requires local bytes.

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
- `tasks/{task_uuid}/original_image/001-page.jpg` for task raw inputs.
- `tasks/{task_uuid}/current_xml/current.xml` for editor-facing XML.
- `tasks/{task_uuid}/final_xml/final.xml` for confirmed MusicXML.
- `tasks/{task_uuid}/preview_image/001-preview.svg` for rendered previews.

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

Task output status:

- Worker-side `replace_files()` now uploads recorded task artifacts through `app.storage` before writing file records.
- Task file records use `storage_backend`, `storage_key`, `filename`, and `page_number`; they no longer store local filesystem paths or render DPI.
- New task file objects use keys under `tasks/{task_uuid}/{kind}/`.
- Readers materialize by `storage_key`, so XML editing, practice sessions, archives, and downloads work against either local storage or S3-compatible object storage.
- Task submission no longer passes API-local materialized paths to Celery. Workers receive upload file IDs and materialize them inside the worker process, which is required for late acknowledgement, retry, and multi-pod deployments.

### 4. Cancellation

Support user cancellation for queued tasks and best-effort cancellation for running tasks. Store cancelled state in DB and make pipeline steps check it between expensive operations.

### 5. Operational Monitoring

Expose metrics for:

- Upload success and failure count.
- Queue depth.
- Task runtime by step.
- Stuck task count.
- Worker failure and retry count.

## Recommended Execution Order

Completed:

1. Add Celery durable execution settings and task idempotency safeguards.
2. Add task heartbeat and stuck-task reconciler.
3. Add orphan upload cleanup.
4. Add dispatch failure handling.
5. Add frontend idempotency key.
6. Move storage behind an interface before multi-pod deployment.
7. Add S3-compatible storage and signed object access URLs.
8. Move Celery task payloads from API-local paths to durable upload file IDs.

Next:

1. Add operational metrics and dashboards for upload, queue, worker, and stuck-task behavior.
2. Consider user cancellation only after real user demand appears.
3. Consider DB outbox only if dispatch reliability becomes a measured operational problem.
4. Consider upload sessions only if the product adds large uploads, resumable upload, drafts, or cross-device resume.

Current implementation covers durable Celery acknowledgement, heartbeat-based stuck-task recovery, orphan upload cleanup, idempotent submission, dispatch failure marking, the storage boundary, S3-compatible object storage, worker-side input materialization, and signed object access URLs. The remaining production v1 work is now narrower: operational monitoring and real-world validation.
