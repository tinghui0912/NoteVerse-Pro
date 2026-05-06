# Practice Frontend Integration Checklist

## Purpose

This document validates the current frontend practice implementation against
the new backend realtime practice contract.

It is intended to answer one practical question:

- what can already connect cleanly
- what is still mismatched
- what the frontend must change before the realtime practice flow can work

## Validation Summary

The frontend practice page has now started moving onto the backend realtime
contract, but it is still not finished end to end.

Current status:

- the frontend now creates backend practice sessions
- the frontend now opens the practice WebSocket
- the frontend now streams PCM frames through a lightweight browser pipeline
- the frontend now consumes `alignment.update`
- the frontend still uses `MediaRecorder` for local playback capture
- the frontend now requests backend practice reports
- the score area is still a placeholder component

This means the session and protocol layers are now connected, but the frontend
still needs rendering and audio-pipeline hardening before the full product goal
is met.

## Files Reviewed

Frontend files reviewed for this validation:

- [page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/practice/[id]/page.tsx)
- [practice.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/lib/api/practice.ts)
- [api.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/types/api.ts)
- [score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx)
- [api-client.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/lib/api-client.ts)

Backend files reviewed for contract comparison:

- [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/practice/router.py)
- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/practice/service.py)
- [message_codec.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/processing/realtime/message_codec.py)
- [practice_realtime_design.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/practice_realtime_design.md)

## Confirmed Backend Contract

### REST contract

The backend now supports:

- `POST /api/v1/practice/sessions`
- `GET /api/v1/practice/sessions/{session_id}`
- `POST /api/v1/practice/sessions/{session_id}/pause`
- `POST /api/v1/practice/sessions/{session_id}/resume`
- `POST /api/v1/practice/sessions/{session_id}/finish`
- `POST /api/v1/practice/sessions/{session_id}/report`
- `GET /api/v1/practice/sessions/{session_id}/report`

### WebSocket contract

The backend now supports:

- `WS /api/v1/practice/sessions/{session_id}/stream`
- auth via bearer token in header or `?token=...`
- JSON control messages:
  - `client.init`
  - `client.pause`
  - `client.resume`
  - `client.finish`
  - `client.heartbeat`
- binary PCM frames
- server messages:
  - `session.ready`
  - `alignment.update`
  - `session.state_changed`
  - `session.warning`
  - `session.error`
  - `session.finished`

### Audio expectations

The backend MVP expects:

- PCM 16-bit signed little-endian
- mono
- 16000 Hz
- binary WebSocket frames

## Frontend Gaps

### 1. Practice API surface

Current frontend API:

- [practice.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/lib/api/practice.ts)

It now exposes:

- `createPracticeSession(...)`
- `getPracticeSession(...)`
- `pausePracticeSession(...)`
- `resumePracticeSession(...)`
- `finishPracticeSession(...)`
- `requestPracticeReport(...)`
- `getPracticeReport(...)`

This gap is now addressed.

### 2. Recording path still needs hardening

Current frontend page:

- [page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/practice/[id]/page.tsx)

It currently uses:

- `navigator.mediaDevices.getUserMedia(...)`
- `MediaRecorder`
- `AudioContext + ScriptProcessorNode`
- browser-side chunk buffering into `audio/webm`

This is now enough for the backend MVP contract, but it is not yet the final
recommended implementation for a production-quality realtime practice flow.

Remaining improvements:

- keep microphone permission via `getUserMedia`
- replace `ScriptProcessorNode` with `AudioWorklet`
- validate longer-session buffering stability
- keep PCM16LE binary frame transport

### 3. Practice session lifecycle wiring

The frontend page now:

- creates a backend session before starting
- keeps a `session_id`
- uses the backend `ws_url`
- transitions state from backend session messages

Needed frontend state additions:

- `sessionId`
- `sessionState`
- `wsRef`
- `streamingReady`
- `latestAlignment`
- `reportStatus`

This gap is now largely addressed.

### 4. WebSocket usage

The current page now opens a WebSocket and follows the expected control flow:

1. call `POST /practice/sessions`
2. open `ws_url`
3. send `client.init`
4. wait for `session.ready`
5. ship PCM binary frames
6. react to `alignment.update`
7. send `client.pause`, `client.resume`, `client.finish`

### 5. Score display is still a placeholder

Current score component:

- [score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx)

It currently shows:

- placeholder text only
- maximize/minimize UI only

It does not yet:

- load real MusicXML
- render a score
- map `alignment.update` to cursor movement
- auto-scroll or auto-page

This is a frontend-critical blocker for the product goal.

### 6. Report request path

Current page behavior after finish:

- calls `POST /practice/sessions/{session_id}/report`
- reads structured report payloads from the backend

The report payload is structured as:

- `summary`
- `metrics`
- `recommendations`

This gap is now addressed at the API level, though the presentation can still
be polished.

## Required Frontend Refactor

### Step 1. Replace the practice API helper

Add a new frontend API helper that mirrors the backend contract exactly.

Suggested file:

- `frontend/src/lib/api/practice.ts`

Suggested exported functions:

- `createPracticeSession`
- `getPracticeSession`
- `pausePracticeSession`
- `resumePracticeSession`
- `finishPracticeSession`
- `requestPracticeReport`
- `getPracticeReport`

### Step 2. Add practice session types

Update:

- `frontend/src/types/api.ts`

Add types for:

- practice session summary
- practice session detail
- practice report payload
- practice WebSocket message payloads

### Step 3. Replace `MediaRecorder` realtime flow

On the practice page:

- keep mic permission handling
- keep optional local playback if you still want the finished audio preview
- introduce a realtime PCM pipeline for streaming

Recommended MVP:

- use `AudioContext`
- use `AudioWorklet`
- downsample or configure to 16000 Hz
- convert float samples to PCM16LE
- send raw `ArrayBuffer` frames through WebSocket

### Step 4. Add WebSocket session orchestration

The practice page should:

1. create the session on start
2. open the WebSocket with bearer token support
3. send `client.init`
4. begin PCM streaming only after `session.ready`
5. update local UI state from backend events
6. flush finish and request report after completion

### Step 5. Replace placeholder report UI

The current three-card report layout is based on a legacy mock response.

The new backend payload should drive a new UI that shows:

- summary
- metrics
- recommendations

### Step 6. Replace placeholder score UI

The practice page cannot meet product goals until:

- real score rendering is added
- cursor movement is driven by `alignment.update`
- auto-scroll or auto-page is implemented

This should be coordinated with the score-rendering work already planned for
the practice feature.

## Integration Risks To Watch

### PCM framing mismatch

The biggest protocol risk is audio format mismatch.

The frontend must not send:

- WebM blobs
- Opus chunks
- `MediaRecorder` binary blobs

The backend expects raw PCM frames.

### Start timing

Do not start sending PCM frames before:

- the session is created
- the WebSocket is connected
- `client.init` has completed
- `session.ready` has been received

### Pause semantics

Frontend pause should not just pause a local recorder.

It must also:

- stop PCM frame forwarding
- send `client.pause`
- wait for `session.state_changed`

### Finish semantics

Frontend finish should:

- stop PCM frame forwarding
- send `client.finish`
- wait for `session.finished`
- then request the report

## Recommended Next Frontend Implementation Order

1. Replace `ScriptProcessorNode` with `AudioWorklet` for a sturdier PCM pipeline.
2. Refine WebSocket lifecycle handling for reconnect and longer session stability.
3. Replace the placeholder score viewer with real score rendering and cursor sync.
4. Polish the report presentation around the structured backend payload.

## Bottom Line

Backend assumptions are now clear and internally consistent.

The frontend now matches the backend contract at the session, WebSocket, and
report API layers, but it still does not meet the full product goal because
score rendering and a production-grade PCM pipeline are incomplete.

The next implementation step should focus on:

- upgrading the PCM pipeline
- real score rendering and cursor sync
- polishing the structured report UI
