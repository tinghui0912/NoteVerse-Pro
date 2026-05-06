# Practice Realtime Design

## Purpose

This document defines the proposed backend design for the realtime practice
feature in the Web SaaS deployment model.

The target product shape is:

- the browser captures microphone audio in realtime
- the browser streams PCM frames to FastAPI
- the backend performs live score following against the selected score
- the backend pushes alignment updates back to the browser
- the frontend uses those updates to move the score cursor and auto-scroll
- the existing practice controls remain intact:
  - start
  - pause
  - resume
  - finish
  - request AI analysis after finishing

This design follows the current backend architecture and placement rules:

- feature code under `app/modules/*`
- shared helpers under `app/shared/*`
- DB and model entry through `app/db/*`
- heavy execution logic under `app/processing/*`
- FastAPI route aggregation through `app/api/v1/router.py`

## Scope

This design covers:

- backend module structure
- persistence model
- REST endpoints
- WebSocket protocol
- runtime session orchestration
- engine integration boundaries
- testing expectations

This design does not cover:

- detailed frontend implementation
- final Matchmaker adapter internals
- final AI report prompt design

## Deployment Assumption

This design assumes the standard Web SaaS model:

- users grant microphone permission in the browser
- the browser captures PCM frames locally
- the browser streams those frames to the backend over WebSocket
- the backend does not access a local host audio device

This is intentionally different from local-device demo architectures where the
backend reads audio directly from the machine on which it is running.

## Architecture Summary

The recommended architecture separates the feature into three layers:

### 1. Feature module layer

Placed under `app/modules/practice/*`.

Responsibilities:

- API entrypoints
- authentication and access checks
- session lifecycle orchestration
- persistence calls
- report request handling

### 2. Realtime runtime layer

Placed under `app/processing/realtime/*`.

Responsibilities:

- active in-memory session registry
- audio frame buffering
- WebSocket connection lifecycle
- state transitions for a live practice session
- forwarding audio frames into the score-following engine

### 3. Score-following engine layer

Placed under `app/processing/engines/*`.

Responsibilities:

- MusicXML timeline preparation
- Matchmaker integration or adaptation
- conversion from audio frames to alignment positions

## Why This Should Not Reuse Celery

Celery remains appropriate for:

- OCR pipelines
- file processing
- post-session report generation if needed

Celery is not a good fit for:

- low-latency bidirectional streaming
- persistent WebSocket state
- session-local memory buffers
- near-realtime cursor updates

Realtime practice sessions should therefore run in-process in the FastAPI
application, not on the Celery task queue.

## Proposed Directory and File Layout

### New feature module

Add:

- `app/modules/practice/__init__.py`
- `app/modules/practice/router.py`
- `app/modules/practice/service.py`
- `app/modules/practice/repository.py`
- `app/modules/practice/dependencies.py`
- `app/modules/practice/schemas.py`

### New realtime runtime package

Add:

- `app/processing/realtime/__init__.py`
- `app/processing/realtime/audio_buffer.py`
- `app/processing/realtime/session_runtime.py`
- `app/processing/realtime/message_codec.py`

### New engine support files

Add:

- `app/processing/engines/matchmaker_live.py`
- `app/processing/engines/score_timeline.py`

### Existing files to update

Update:

- `app/api/v1/router.py`
- `app/shared/constants.py`
- `app/db/models/__init__.py`

Add migration:

- `alembic/versions/<timestamp>_add_practice_sessions.py`

### New tests

Add:

- `tests/test_practice_api_smoke.py`
- `tests/test_practice_service_regressions.py`
- `tests/test_practice_websocket_flow.py`

## Data Model

### New table: `practice_sessions`

This feature should use a dedicated table instead of reusing the current
`files` table.

Reason:

- the current `files` table is task-output oriented
- it assumes one task owns one set of stored artifacts
- a single score may be practiced many times
- practice session state is not the same domain concept as task output files

### Suggested columns

- `id`: `BIGINT` primary key
- `session_uuid`: `VARCHAR(36)` unique, not null
- `task_id`: `BIGINT` foreign key to `tasks.id`, not null
- `user_id`: `BIGINT` foreign key to `users.id`, nullable
- `share_token`: `VARCHAR(64)`, nullable
- `source_type`: `VARCHAR(16)`, not null
- `state`: `VARCHAR(32)`, not null
- `sample_rate`: `INTEGER`, not null
- `channels`: `INTEGER`, not null
- `frame_format`: `VARCHAR(32)`, not null
- `started_at`: `DATETIME`, nullable
- `finished_at`: `DATETIME`, nullable
- `last_event_index`: `INTEGER`, nullable
- `last_measure_index`: `INTEGER`, nullable
- `last_beat_position`: `FLOAT`, nullable
- `last_confidence`: `FLOAT`, nullable
- `audio_path`: `VARCHAR(512)`, nullable
- `report_status`: `VARCHAR(32)`, not null
- `report_payload`: `TEXT` or JSON-capable column, nullable
- `error`: `TEXT`, nullable
- `created_at`: `DATETIME`, not null
- `updated_at`: `DATETIME`, not null

### Suggested enums

#### PracticeSessionState

- `CREATED`
- `STREAMING`
- `PAUSED`
- `FINISHED`
- `FAILED`

#### PracticeReportStatus

- `NOT_REQUESTED`
- `PENDING`
- `READY`
- `FAILED`

### Suggested indexes

- unique index on `session_uuid`
- index on `(user_id, created_at)`
- index on `(task_id, created_at)`
- index on `state`

### ORM placement

Add a new model file:

- `app/db/models/practice.py`

Export it from:

- `app/db/models/__init__.py`

## Access Model

The practice feature must support both of these access modes:

### 1. Owner session

An authenticated user starts practice on a task they own.

### 2. Shared-access session

An authenticated user starts practice from a shared score link with a valid
`share_token`.

This is important because the frontend already routes users into practice from
the shared-score page.

### Rule

Practice access is granted when:

- the authenticated user owns the task
- or the authenticated user presents a valid share token for the task

If future product policy needs it, the share model can later gain a separate
`can_practice` flag. That is not required for the first implementation.

## REST API Design

### 1. Create practice session

`POST /api/v1/practice/sessions`

Purpose:

- validate task access
- load source score
- create a DB session row
- prepare the score timeline
- return the session identifier and WebSocket endpoint

#### Request body

```json
{
  "task_id": "task-uuid",
  "source": "final",
  "share_token": "optional-share-token",
  "sample_rate": 16000,
  "channels": 1,
  "frame_format": "pcm_s16le"
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "session_id": "session-uuid",
    "state": "CREATED",
    "ws_url": "/api/v1/practice/sessions/session-uuid/stream"
  }
}
```

### 2. Get practice session

`GET /api/v1/practice/sessions/{session_id}`

Purpose:

- return persistent state
- expose last known alignment position
- expose report status

### 3. Pause practice session

`POST /api/v1/practice/sessions/{session_id}/pause`

Purpose:

- mark session as paused
- stop alignment advancement without deleting runtime

### 4. Resume practice session

`POST /api/v1/practice/sessions/{session_id}/resume`

Purpose:

- transition from `PAUSED` back to `STREAMING`

### 5. Finish practice session

`POST /api/v1/practice/sessions/{session_id}/finish`

Purpose:

- finalize the live session
- flush and close the runtime
- optionally persist the captured audio path

### 6. Request practice report

`POST /api/v1/practice/sessions/{session_id}/report`

Purpose:

- trigger AI analysis after session completion

Initial implementation options:

- synchronous service call for MVP
- later migration to Celery if report latency becomes large

### 7. Get practice report

`GET /api/v1/practice/sessions/{session_id}/report`

Purpose:

- fetch the stored analysis result

## WebSocket Design

### Route

`WS /api/v1/practice/sessions/{session_id}/stream`

### Authentication

Do not reuse `OAuth2PasswordBearer` directly.

Instead:

- add a WebSocket-specific auth helper in `app/modules/practice/dependencies.py`
- support either:
  - bearer token auth
  - or a valid practice session created using a `share_token`

### Message types

The protocol should distinguish:

- control messages as JSON
- audio frames as binary payloads

### Client to server messages

#### `client.init`

Sent once after WebSocket connect.

```json
{
  "type": "client.init",
  "payload": {
    "sample_rate": 16000,
    "channels": 1,
    "frame_samples": 640
  }
}
```

#### `client.pause`

```json
{
  "type": "client.pause"
}
```

#### `client.resume`

```json
{
  "type": "client.resume"
}
```

#### `client.finish`

```json
{
  "type": "client.finish"
}
```

#### `client.heartbeat`

```json
{
  "type": "client.heartbeat",
  "payload": {
    "t": 123456789
  }
}
```

#### Binary audio frame

The client sends raw PCM bytes as a binary WebSocket message.

Recommended MVP format:

- PCM 16-bit signed little-endian
- mono
- 16000 Hz
- 20ms to 40ms per frame

### Server to client messages

#### `session.ready`

```json
{
  "type": "session.ready",
  "payload": {
    "session_id": "session-uuid",
    "state": "STREAMING"
  }
}
```

#### `alignment.update`

```json
{
  "type": "alignment.update",
  "payload": {
    "event_index": 182,
    "measure_index": 24,
    "measure_number": 25,
    "beat_position": 96.5,
    "confidence": 0.92,
    "timestamp_ms": 15320
  }
}
```

This message should remain music-semantic rather than layout-semantic.

The backend should not return:

- page numbers
- viewport coordinates
- DOM positioning data

Those belong to the frontend renderer.

#### `session.state_changed`

```json
{
  "type": "session.state_changed",
  "payload": {
    "state": "PAUSED"
  }
}
```

#### `session.warning`

```json
{
  "type": "session.warning",
  "payload": {
    "code": "low_confidence",
    "message": "alignment confidence dropped"
  }
}
```

#### `session.error`

```json
{
  "type": "session.error",
  "payload": {
    "code": "practice_alignment_failed",
    "message": "engine failure"
  }
}
```

#### `session.finished`

```json
{
  "type": "session.finished",
  "payload": {
    "state": "FINISHED"
  }
}
```

## Runtime Design

### Realtime session registry

`app/processing/realtime/session_runtime.py` should maintain an in-memory
registry:

- `session_id -> PracticeSessionRuntime`

The runtime object should contain:

- `session_id`
- `task_id`
- `state`
- `audio_buffer`
- `engine`
- `timeline`
- `websocket`
- `lock`
- `background_task`
- `last_alignment`
- optional `recording_writer`

### Runtime lifecycle

1. REST create endpoint creates the DB row
2. score timeline is prepared from MusicXML
3. WebSocket connects
4. `client.init` transitions runtime into `STREAMING`
5. binary PCM frames are pushed into the audio buffer
6. the engine consumes frames and emits alignment updates
7. alignment updates are written to memory and occasionally persisted to DB
8. finish closes the runtime and finalizes metadata

### Persistence frequency

Do not write every frame to the database.

Suggested approach:

- keep latest alignment in memory
- persist every fixed interval, such as every 500ms to 1000ms
- always persist on pause, finish, and failure

## Engine Integration Design

### `score_timeline.py`

Purpose:

- load MusicXML
- normalize score events
- produce a stable event timeline

The output should map:

- `event_index`
- `measure_index`
- `measure_number`
- `beat_position`
- optional note metadata

This layer is critical because the frontend cursor will ultimately track this
semantic position.

### `matchmaker_live.py`

Purpose:

- act as an adapter between the incoming PCM stream and Matchmaker
- return alignment positions against the prepared timeline

It should hide Matchmaker-specific setup from the feature module.

Expected responsibilities:

- session-local engine startup
- PCM frame ingestion
- conversion to the engine's expected input format
- incremental alignment calls
- returning the best current position plus confidence

### Important note about Matchmaker

The demo architecture provided by Matchmaker projects is a strong reference for:

- score-following architecture
- backend-driven alignment updates
- FastAPI and WebSocket orchestration

But the input layer in this project must be adapted for Web SaaS:

- the backend will not access a machine-local audio device
- the browser is the realtime audio source

That means the integration should treat Matchmaker as an engine dependency, not
as a drop-in full-stack solution.

## Practice Module Responsibilities

### `router.py`

Should contain:

- REST handlers
- WebSocket route
- protocol plumbing only

Should not contain:

- alignment logic
- buffer logic
- DB query logic

### `service.py`

Should contain:

- session creation orchestration
- access validation
- pause/resume/finish transitions
- report generation requests

### `repository.py`

Should contain:

- create session row
- get session by UUID
- update session state
- update latest alignment fields
- persist report payload

### `dependencies.py`

Should contain:

- `get_practice_service`
- session resolution helpers
- WebSocket authentication helpers

### `schemas.py`

Should contain:

- request and response models for REST
- typed payloads for runtime messages where useful
- TypedDict results for repository and service returns

## Error and Success Codes

### New error codes

Add to `app/shared/constants.py`:

- `PRACTICE_SESSION_NOT_FOUND`
- `PRACTICE_SESSION_INVALID_STATE`
- `PRACTICE_STREAM_NOT_READY`
- `PRACTICE_STREAM_CLOSED`
- `PRACTICE_AUDIO_FORMAT_UNSUPPORTED`
- `PRACTICE_ALIGNMENT_FAILED`
- `PRACTICE_REPORT_FAILED`
- `NO_PRACTICE_ACCESS`

### New success codes

Add to `app/shared/constants.py`:

- `PRACTICE_SESSION_CREATED`
- `PRACTICE_SESSION_PAUSED`
- `PRACTICE_SESSION_RESUMED`
- `PRACTICE_SESSION_FINISHED`
- `PRACTICE_REPORT_READY`

### Exception style

Continue using canonical app exceptions:

- `ValidationException`
- `UnauthorizedException`
- `ResourceNotFoundException`
- `AppException`

Do not introduce ad-hoc response JSON or unstructured WebSocket error payloads.

## File Storage Plan

If session audio is persisted, store it under a dedicated practice workspace.

Suggested path:

- `TEMP_FOLDER/practice/<session_uuid>/`

Suggested files:

- `audio.raw` or `audio.wav`
- optional `trace.json`
- optional `report.json`

Do not store repeated practice-session recordings in the current task-output
locations that are used for OCR artifacts.

## Aggregation and Registration Changes

### Update `app/api/v1/router.py`

Add:

- `from app.modules.practice.router import router as practice`
- `api_router.include_router(practice, prefix="/practice", tags=["Practice"])`

### Update model exports

Update:

- `app/db/models/__init__.py`

So the practice ORM model is exported through the canonical model entrypoint.

## Testing Plan

### `tests/test_practice_api_smoke.py`

Cover:

- unauthenticated create-session requests are rejected
- invalid session ids return `404`
- unauthorized task access returns `403`

### `tests/test_practice_service_regressions.py`

Cover:

- session creation persists expected values
- pause and resume follow valid state transitions
- finish closes the session correctly
- invalid transitions raise the correct business code
- share-token access works when valid

### `tests/test_practice_websocket_flow.py`

Cover:

- `client.init` produces `session.ready`
- sending PCM frames produces mocked `alignment.update`
- pause, resume, and finish messages change state correctly
- engine failures produce `session.error`

### Testing strategy

The first testable implementation should use a fake or mocked alignment engine.

Reason:

- it allows protocol and lifecycle development before Matchmaker integration is complete
- it reduces risk while the streaming contract is still stabilizing

## Suggested Implementation Order

### Phase 1

- add the `practice_sessions` table
- add ORM model and migration
- add the new `practice` module skeleton
- register the router

### Phase 2

- implement REST session lifecycle endpoints
- implement repository and service state handling

### Phase 3

- implement WebSocket runtime registry
- implement JSON control messages
- implement binary PCM ingest

### Phase 4

- implement a fake alignment engine
- push deterministic `alignment.update` messages
- validate the full browser-to-backend-to-browser loop

### Phase 5

- integrate the Matchmaker live adapter
- replace the fake engine with real alignment output

### Phase 6

- implement post-session AI report generation
- optimize persistence and cleanup

## MVP Recommendation

The first practical MVP should include:

- authenticated session creation
- share-token session creation
- WebSocket PCM streaming
- mocked or basic alignment updates
- pause, resume, finish
- stored session metadata

The Matchmaker integration should come only after the protocol, persistence,
and session lifecycle are already stable.

## Bottom Line

The recommended design is:

- add a dedicated `practice` feature module
- add a dedicated `practice_sessions` persistence model
- keep realtime state in-process in FastAPI
- place alignment and buffering under `app/processing/*`
- use WebSocket for MVP live streaming
- keep Celery for non-realtime follow-up work such as report generation

This approach matches the existing backend structure, preserves clean feature
boundaries, and creates a safe path from protocol MVP to full Matchmaker-based
live score following.
