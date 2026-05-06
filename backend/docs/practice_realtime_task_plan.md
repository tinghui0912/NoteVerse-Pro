# Practice Realtime Task Plan

## Purpose

This document turns the realtime practice design into a concrete implementation
sequence for the backend.

It is intended to be executed after agreement on the higher-level design in:

- [practice_realtime_design.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/practice_realtime_design.md)

## Scope

This task plan covers backend implementation work for:

- practice session persistence
- REST session lifecycle APIs
- WebSocket streaming contract
- in-memory runtime/session registry
- fake alignment engine for MVP protocol validation
- Matchmaker live adapter integration
- post-session report plumbing
- backend validation and rollout sequencing

This task plan does not cover:

- detailed frontend implementation
- UI/UX behavior on the practice page
- production-grade Matchmaker tuning details

## Current Status

This feature is now in active implementation.

Completed prerequisites:

- the share access model is now authenticated-only
- the practice design already assumes logged-in shared access
- backend quality gates are currently green

Implementation status:

- `practice_sessions` ORM model and migration have been added
- the `practice` module skeleton has been added
- the practice router is registered under `/api/v1/practice`
- practice constants have been added to the shared constants module
- REST lifecycle endpoints are now implemented
- repository and service lifecycle handling are now implemented
- score timeline preparation is now implemented
- realtime runtime primitives are now implemented
- session creation now registers an in-memory runtime entry
- WebSocket auth and session resolution are now implemented
- WebSocket control-message handling is now implemented
- binary PCM ingest is now implemented
- fake alignment updates are now implemented
- alignment state is now persisted on a bounded cadence
- websocket regression tests now cover fake alignment behavior
- the alignment-engine boundary is now abstracted behind a shared engine contract
- runtime engine selection is now configurable
- engine failure handling is now wired through websocket error messages
- practice report payloads are now persisted as structured JSON
- the report endpoint now generates an MVP summary from session metadata

## Task Sequence

### Phase 1. Persistence and module skeleton

#### Task 1.1

Status: completed

Add the `practice_sessions` persistence model and migration.

Files:

- `backend/app/db/models/practice.py`
- `backend/app/db/models/__init__.py`
- `backend/alembic/versions/<timestamp>_add_practice_sessions.py`

Changes:

- add the ORM model for `practice_sessions`
- include all required columns from the design doc
- define indexes and foreign keys
- export the model through the canonical model package
- add the Alembic migration

Completion check:

- `alembic upgrade head` creates the new table successfully
- the ORM model is importable from `app.db.models`

#### Task 1.2

Status: completed

Add the practice feature module skeleton.

Files:

- `backend/app/modules/practice/__init__.py`
- `backend/app/modules/practice/router.py`
- `backend/app/modules/practice/service.py`
- `backend/app/modules/practice/repository.py`
- `backend/app/modules/practice/dependencies.py`
- `backend/app/modules/practice/schemas.py`

Changes:

- add the canonical module file layout
- add empty or minimally typed service/repository/dependency entrypoints
- keep the module consistent with existing `app/modules/*` conventions

Completion check:

- module imports resolve cleanly
- no unused placeholder logic leaks into runtime code

#### Task 1.3

Status: completed

Register the practice router and initial constants.

Files:

- `backend/app/api/v1/router.py`
- `backend/app/shared/constants.py`

Changes:

- register `practice` routes under `/practice`
- add initial practice success codes
- add initial practice error codes

Completion check:

- `/api/v1/openapi.json` includes the practice route group
- new constants are available through the shared constants module

### Phase 2. REST lifecycle MVP

#### Task 2.1

Status: completed

Define REST request and response schemas.

Files:

- `backend/app/modules/practice/schemas.py`

Changes:

- add request models for:
  - create session
  - pause session
  - resume session
  - finish session
  - request report
- add response/result shapes for:
  - session summary
  - session detail
  - report status
- add typed repository/service result payloads where useful

Completion check:

- router and service layers do not rely on loose ad-hoc dictionaries

#### Task 2.2

Status: completed

Implement repository methods for practice sessions.

Files:

- `backend/app/modules/practice/repository.py`

Changes:

- add create/read/update helpers for `practice_sessions`
- add methods for:
  - create session row
  - get session by UUID
  - update state
  - update last alignment fields
  - update report payload/status
- keep repository methods narrowly scoped to DB access

Completion check:

- repository methods cover the required session lifecycle without leaking business logic

#### Task 2.3

Status: completed

Implement access validation and lifecycle orchestration in the service layer.

Files:

- `backend/app/modules/practice/service.py`
- `backend/app/modules/practice/dependencies.py`

Changes:

- validate task ownership or valid authenticated share-token access
- create practice sessions
- implement pause/resume/finish state transitions
- expose session detail and report retrieval
- keep business rules in the service layer rather than the router

Completion check:

- invalid state transitions raise canonical app exceptions
- share-token access follows the authenticated share model

#### Task 2.4

Status: completed

Add REST endpoints for the practice session lifecycle.

Files:

- `backend/app/modules/practice/router.py`

Changes:

- add:
  - `POST /api/v1/practice/sessions`
  - `GET /api/v1/practice/sessions/{session_id}`
  - `POST /api/v1/practice/sessions/{session_id}/pause`
  - `POST /api/v1/practice/sessions/{session_id}/resume`
  - `POST /api/v1/practice/sessions/{session_id}/finish`
  - `POST /api/v1/practice/sessions/{session_id}/report`
  - `GET /api/v1/practice/sessions/{session_id}/report`
- keep router logic thin
- return canonical `success_response(...)`

Completion check:

- REST routes are present and wired end-to-end through router -> service -> repository

### Phase 3. Timeline preparation and runtime foundation

#### Task 3.1

Status: completed

Add a score timeline preparation helper.

Files:

- `backend/app/processing/engines/score_timeline.py`

Changes:

- load source MusicXML
- normalize note/rest/chord timing into a stable event timeline
- produce event metadata needed by alignment updates

Completion check:

- a valid score can be converted into a timeline containing at least:
  - `event_index`
  - `measure_index`
  - `measure_number`
  - `beat_position`

#### Task 3.2

Status: completed

Add realtime runtime primitives.

Files:

- `backend/app/processing/realtime/__init__.py`
- `backend/app/processing/realtime/audio_buffer.py`
- `backend/app/processing/realtime/session_runtime.py`
- `backend/app/processing/realtime/message_codec.py`

Changes:

- add a bounded audio chunk buffer
- add an in-memory runtime registry keyed by `session_id`
- add message encoding helpers for JSON control messages
- define the runtime state container

Completion check:

- runtime registry can create, resolve, and release sessions cleanly
- buffer operations are isolated from router/service code

#### Task 3.3

Status: completed

Connect REST session creation to runtime preparation.

Files:

- `backend/app/modules/practice/service.py`
- `backend/app/processing/realtime/session_runtime.py`
- `backend/app/processing/engines/score_timeline.py`

Changes:

- prepare the score timeline when a session is created
- register a runtime entry for the session
- keep heavy runtime state out of ORM models

Completion check:

- creating a practice session leaves both a DB row and a registered runtime entry

### Phase 4. WebSocket protocol MVP

#### Task 4.1

Status: completed

Add WebSocket auth and session resolution helpers.

Files:

- `backend/app/modules/practice/dependencies.py`

Changes:

- add a WebSocket-specific auth helper
- support:
  - authenticated owner access
  - authenticated share-token session access
- avoid reusing `OAuth2PasswordBearer` directly

Completion check:

- invalid or unauthorized WebSocket connections are rejected consistently

#### Task 4.2

Status: completed

Implement the WebSocket route and control-message handling.

Files:

- `backend/app/modules/practice/router.py`
- `backend/app/processing/realtime/message_codec.py`
- `backend/app/processing/realtime/session_runtime.py`

Changes:

- add `WS /api/v1/practice/sessions/{session_id}/stream`
- support:
  - `client.init`
  - `client.pause`
  - `client.resume`
  - `client.finish`
  - `client.heartbeat`
- send:
  - `session.ready`
  - `session.state_changed`
  - `session.warning`
  - `session.error`
  - `session.finished`

Completion check:

- a connected client can initialize, pause, resume, and finish a session without OCR/alignment integration

#### Task 4.3

Status: completed

Add binary PCM ingest to the runtime.

Files:

- `backend/app/modules/practice/router.py`
- `backend/app/processing/realtime/audio_buffer.py`
- `backend/app/processing/realtime/session_runtime.py`

Changes:

- accept binary WebSocket frames
- validate format expectations for MVP
- append chunks into the runtime buffer

Completion check:

- runtime buffers PCM frames without crashing or blocking the control channel

### Phase 5. Fake alignment engine MVP

#### Task 5.1

Status: completed

Add a fake alignment engine for end-to-end protocol validation.

Files:

- `backend/app/processing/engines/matchmaker_live.py`
  or a temporary fake engine file if you prefer to keep Matchmaker integration separate
- `backend/app/processing/realtime/session_runtime.py`

Changes:

- implement a deterministic fake alignment source
- advance along the score timeline based on received audio frames or simple timing
- emit `alignment.update` events using the real protocol shape

Completion check:

- the backend can produce realistic alignment updates without Matchmaker installed

#### Task 5.2

Status: completed

Persist alignment state on a bounded cadence.

Files:

- `backend/app/modules/practice/service.py`
- `backend/app/modules/practice/repository.py`
- `backend/app/processing/realtime/session_runtime.py`

Changes:

- keep latest alignment in memory
- persist at a controlled interval
- always persist on pause, finish, and failure

Completion check:

- DB writes do not occur for every audio frame
- session state stays accurate after finish or disconnect

#### Task 5.3

Status: completed

Expose fake-engine behavior through tests before Matchmaker integration.

Files:

- `backend/tests/test_practice_websocket_flow.py`
- `backend/tests/test_practice_service_regressions.py`

Changes:

- cover the end-to-end contract with the fake engine
- verify:
  - `session.ready`
  - `alignment.update`
  - pause/resume/finish transitions
  - error propagation

Completion check:

- the browser-to-backend streaming contract is testable without the real engine

### Phase 6. Matchmaker live adapter

#### Task 6.1

Status: completed

Implement the Matchmaker adapter boundary.

Files:

- `backend/app/processing/engines/matchmaker_live.py`

Changes:

- accept PCM frames from the browser-originated stream
- adapt the stream into Matchmaker-compatible input
- emit semantic alignment positions against the prepared timeline

Completion check:

- fake engine can be swapped for Matchmaker without changing router contracts

#### Task 6.2

Status: completed

Integrate Matchmaker into the runtime behind a narrow interface.

Files:

- `backend/app/processing/realtime/session_runtime.py`
- `backend/app/modules/practice/service.py`

Changes:

- select engine implementation at runtime
- keep engine-specific setup out of router code
- preserve the same `alignment.update` payload shape

Completion check:

- the runtime can use either fake or Matchmaker-backed alignment with the same external API

#### Task 6.3

Status: completed

Handle engine failures and degraded-confidence behavior cleanly.

Files:

- `backend/app/processing/engines/matchmaker_live.py`
- `backend/app/processing/realtime/session_runtime.py`
- `backend/app/shared/constants.py`

Changes:

- surface `session.warning` for low confidence
- surface `session.error` for hard failures
- ensure runtime cleanup on engine failure

Completion check:

- Matchmaker-specific failures do not leave orphaned runtime state

### Phase 7. Post-session report support

#### Task 7.1

Status: completed

Add report persistence and retrieval plumbing.

Files:

- `backend/app/modules/practice/service.py`
- `backend/app/modules/practice/repository.py`
- `backend/app/modules/practice/schemas.py`

Changes:

- store report status and payload
- expose report status through REST
- keep the API shape stable whether report generation is sync or async

Completion check:

- finished sessions can return report status and stored payload consistently

#### Task 7.2

Status: completed

Implement an MVP report-generation path.

Files:

- `backend/app/modules/practice/service.py`
- optional helper under `backend/app/processing/*` if report assembly needs separation

Changes:

- trigger report generation only after session finish
- keep the first implementation simple
- defer Celery migration unless latency requires it

Completion check:

- `POST /report` updates state and produces a persisted result for completed sessions

### Phase 8. Validation and rollout

#### Task 8.1

Status: completed

Add API smoke coverage for the practice module.

Files:

- `backend/tests/test_practice_api_smoke.py`

Changes:

- cover authentication rejection
- cover not-found behavior
- cover access rejection for unauthorized tasks or invalid share-token access

Completion check:

- unauthenticated or unauthorized practice access fails predictably

#### Task 8.2

Status: completed

Run backend quality gates after each completed implementation slice.

Files:

- no code file; execution task

Changes:

- run:
  - `.\venv\Scripts\python.exe -m ruff check app tests`
  - `.\venv\Scripts\python.exe -m mypy --config-file pyproject.toml --cache-dir NUL`
  - `.\venv\Scripts\python.exe -m mypy --config-file mypy-model-layer.ini`
  - `.\venv\Scripts\python.exe -m pytest tests -q`

Completion check:

- backend quality gates remain green after each milestone

#### Task 8.3

Status: in progress

Verify backend assumptions with frontend integration.

Files:

- `backend/docs/practice_frontend_integration_checklist.md`

Changes:

- confirm the frontend can:
  - create a practice session
  - open the WebSocket
  - send `client.init`
  - stream PCM frames
  - receive alignment updates
  - pause/resume/finish correctly
- document any contract mismatches before frontend implementation begins

Completion check:

- backend protocol matches real frontend usage without contract mismatches
- or the remaining mismatches are explicitly documented for frontend follow-up

## Suggested First Batch

The best first implementation batch is:

1. add `practice_sessions` persistence and migration
2. add the `practice` module skeleton and router registration
3. implement REST create/get/pause/resume/finish endpoints
4. add API smoke tests and service regression tests

This gives you a stable non-streaming backbone before introducing WebSocket and
engine complexity.

Current progress:

- Phase 1 is complete
- Phase 2 is complete
- Phase 3 is complete
- Phase 4 is complete
- Phase 5 is complete
- Phase 6 is structurally complete
- Phase 7 is complete
- Phase 8 is partially complete
- the next active implementation slice is Task 8.3 frontend integration validation
- a frontend integration checklist now documents the current contract gaps
- the frontend now implements the practice REST contract and initial WebSocket flow

## Suggested MVP Milestone

The first end-to-end MVP should stop at:

- authenticated session creation
- authenticated share-token session creation
- runtime registry
- WebSocket control protocol
- binary PCM ingest
- fake alignment updates
- pause/resume/finish
- persistent session metadata

This milestone is valuable because it validates the hardest contract boundary
without waiting for Matchmaker integration.

## Validation Checklist

Run after each meaningful slice:

```powershell
cd backend
.\venv\Scripts\python.exe -m ruff check app tests
.\venv\Scripts\python.exe -m mypy --config-file pyproject.toml --cache-dir NUL
.\venv\Scripts\python.exe -m mypy --config-file mypy-model-layer.ini
.\venv\Scripts\python.exe -m pytest tests -q
```

Practice-specific validation should include at least:

- create a session as an owner
- create a session from an authenticated share page using `share_token`
- reject unauthenticated session creation
- reject unauthorized task access
- open a practice WebSocket successfully
- send `client.init` and receive `session.ready`
- stream binary audio frames
- receive `alignment.update`
- pause and resume without losing session state
- finish and persist final session metadata
- request a report after finish

## Definition Of Done

This task plan is complete when:

- `practice_sessions` persistence exists and is migrated
- the practice module is registered in the API router
- session lifecycle REST endpoints are implemented
- WebSocket streaming is implemented
- the runtime registry and audio buffer are in place
- fake alignment updates work end-to-end
- Matchmaker integration is wired behind the same contract
- post-session report support exists
- backend quality gates pass
- frontend integration can use the backend protocol successfully

## Start Here

The recommended next active task is:

- Task 8.3 frontend integration validation

Within that phase, start with:

1. verify the frontend can open the practice session REST and WebSocket flows against this contract
2. confirm the browser-side PCM framing matches backend expectations
