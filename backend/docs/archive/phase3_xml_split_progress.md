# Phase 3 XML Split Progress

## Completed

- Replaced `app/modules/xml/router.py` with a real module router implementation.
- Replaced `app/modules/xml/schemas.py` with real XML request schemas.
- Replaced `app/modules/xml/service.py` with the canonical XML-domain implementation.
- Converted old paths into compatibility wrappers:
  - `app/services/xml_service.py`
  - `app/api/endpoints/xml.py`
  - `app/schemas/xml.py`

## Validation

- `py_compile` passed for:
  - `app/modules/xml/router.py`
  - `app/modules/xml/schemas.py`
  - `app/modules/xml/service.py`
  - `app/services/xml_service.py`
  - `app/api/endpoints/xml.py`
  - `app/schemas/xml.py`

## Outcome

- `xml` is no longer only a wrapper module.
- Router, schemas, and service now all live under `app/modules/xml/`.
- Old import paths still work through compatibility wrappers, so external callers do not need immediate changes.

## Remaining Follow-up

- `xml` does not yet have its own repository layer.
- The XML service still directly handles a mix of:
  - task/file queries
  - file persistence updates
  - rendering coordination
- A later cleanup can decide whether parts of this logic belong in:
  - `app/modules/xml/repository.py`
  - `app/modules/files/service.py`
  - `app/services/file_service.py` compatibility cleanup
