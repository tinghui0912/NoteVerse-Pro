# Phase 3 Logging Style Progress

## Completed

- Removed emoji from runtime logging and startup output.
- Added a `UnicodeEncodeError` fallback in `app/core/logger.py` to avoid GBK console crashes.
- Unified core runtime log wording to concise English phrases across:
  - `app/main.py`
  - `app/core/middleware.py`
  - `app/worker/tasks.py`
  - `app/pipeline/context.py`
  - `app/pipeline/base.py`
  - `app/pipeline/steps/text.py`
  - `app/pipeline/steps/finalize.py`
- Unified processor-layer logs in:
  - `app/processing/processors/text_recognition.py`
  - `app/processing/processors/text_integration.py`
- Unified engine and pipeline-step logs in:
  - `app/processing/engines/audiveris.py`
  - `app/processing/engines/musescore.py`
  - `app/processing/engines/pianoplayer.py`
  - `app/processing/engines/paddle.py`
  - `app/processing/extractors/mxl.py`
  - `app/pipeline/steps/normalize.py`
  - `app/pipeline/steps/input.py`
  - `app/pipeline/steps/pdf.py`
  - `app/pipeline/steps/audiveris.py`
  - `app/pipeline/steps/xml.py`
  - `app/pipeline/steps/preview.py`
  - `app/pipeline/files_recorder.py`

## Current Style

- Request lifecycle:
  - `REQUEST ...`
  - `OK ...`
  - `WARN ...`
  - `ERROR ...`
  - `EXCEPTION ...`
- App lifecycle:
  - `Starting ...`
  - `Stopping ...`
- Pipeline lifecycle:
  - `Step started: ...`
  - `Step completed: ...`
  - `Step failed: ...`
  - `Step rollback failed: ...`

## Verified

- Updated files pass `py_compile`.
- Core behavior smoke still passes after the wording changes.
- No emoji remain in active runtime log messages under `backend/app` and `backend/run.py`.

## Remaining Follow-up

- Many processor and pipeline modules still contain mixed Chinese/English comments and docstrings.
- A good next slice is:
  - `app/pipeline/context.py` docstrings/comments if full language consistency is desired
  - `app/pipeline/steps/finalize.py` docstrings/comments if full language consistency is desired
  - `app/pipeline/steps/text.py` docstrings/comments if full language consistency is desired
  - `app/core/*` comments/docstrings if full language consistency is desired

## Recommendation

- Keep user-facing API error payloads consistent with product language decisions.
- Keep internal logs short, searchable, and mostly English for tooling consistency.
