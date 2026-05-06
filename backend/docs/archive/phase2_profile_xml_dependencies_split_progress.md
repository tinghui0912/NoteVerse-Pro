# Phase 2 Profile XML Dependencies Split Progress

## Completed

- Added `app/modules/profile/dependencies.py` and moved avatar-service provisioning into the profile module boundary.
- Added `app/modules/xml/dependencies.py` and moved XML-service provisioning into the XML module boundary.
- Updated `app/api/endpoints/profile.py` to consume `get_avatar_service` from `app.modules.profile.dependencies`.
- Updated `app/api/endpoints/xml.py` to consume `get_xml_service` from `app.modules.xml.dependencies`.
- Updated `app/api/endpoints/profile.py` and `app/api/endpoints/xml.py` to type against module service imports.
- Updated `app/api/deps.py` compatibility providers so `get_avatar_service()` and `get_xml_service()` now forward into their feature modules.
- Exported the new dependency helpers from:
  - `app/modules/profile/__init__.py`
  - `app/modules/xml/__init__.py`

## Validation

- `py_compile` passed for:
  - `app/modules/profile/dependencies.py`
  - `app/modules/xml/dependencies.py`
  - `app/modules/profile/__init__.py`
  - `app/modules/xml/__init__.py`
  - `app/api/endpoints/profile.py`
  - `app/api/endpoints/xml.py`
  - `app/api/deps.py`

## Outcome

- `app/api/deps.py` no longer instantiates profile or XML services directly.
- `profile` and `xml` now match the same module dependency shape already established for `tasks` and `shares`.

## Next Recommended Step

- Review whether `files` needs its own `dependencies.py`, or move on to deeper extraction inside the feature modules such as repository cleanup and service boundary tightening.
