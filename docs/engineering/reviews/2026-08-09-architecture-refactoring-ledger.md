# Architecture Refactoring Ledger

> Status: active engineering ledger
> Created: 2026-08-09
> Scope: repository structure, maintainability, production readiness, and handover readiness.
> Rule: an item is not complete until its acceptance criteria and targeted checks pass.

## How to use this ledger

- **Confirmed finding** means it was verified directly in the repository.
- **Recommendation** means it is a deliberate improvement, not proof that the current code is broken.
- **Validate before acting** means the owner must first measure or reproduce the risk; do not refactor based on aesthetics alone.
- Keep this document short enough to operate. Move completed decisions to an ADR or the archive and link them here.

## Current status and active backlog

The table below is the authoritative execution view. The following sections
retain the original findings and chronological implementation evidence; a
historical finding is not an indication that the item is still open.

| ID | Current status | Next required outcome |
| --- | --- | --- |
| ARC-001 | Complete | Maintain the root entry point as repository topology or quality commands change. |
| ARC-002 | Complete | Maintain OpenAPI generation and generated TypeScript freshness checks for HTTP contracts. |
| ARC-003 | Partially complete | Realtime alignment contracts are separated from the Matchmaker implementation; continue splitting only measured hotspots by stable responsibilities, with direct tests for each extraction. |
| ARC-004 | Partially complete | Ops async-operation read models, command retries, audit events, filters, and projections are separated; continue applying this pattern only to measured service hotspots. |
| ARC-005 | Complete | Critical score access, import execution/job lifecycle, import worker, and Practice session service have focused coverage gates; score-access architecture boundaries are also checked. |
| ARC-006 | Complete | Keep the isolated integration environment covering auth/CSRF, import submission, and authenticated Practice WebSocket handshake. |
| ARC-007 | Complete | Generated OpenAPI documents are the cross-stack trigger; backend contract freshness checks prevent an unsynchronised source change from passing. Reassess only if a new contract surface is not represented by a generated artifact. |
| ARC-008 | Complete | Keep Action SHAs immutable and let Dependabot propose reviewed updates. |
| ARC-009 | Complete | Keep the Markdown-link validator required for documentation changes. |
| ARC-010 | Complete | Keep local script indexes aligned with supported commands. |
| ARC-011 | Complete | No further work unless a new production prototype boundary appears. |
| ARC-012 | Partially complete | Continue extracting only duplicated bootstrap or settings ownership with a verified runtime boundary. |
| ARC-013 | Partially complete | Code-side ownership and Dependabot policy are complete; verify GitHub-side alerts, secret scanning, branch protection, and required reviews outside this repository. |
| ARC-014 | Open | Complete deployment-source documentation and stale-link remediation. |
| ARC-015 | Complete | Maintain the strict Practice WebSocket v1 schema, generated artifact, runtime validators, and compatibility policy for each protocol change. |
| ARC-016 | Partially complete (P1) | Maintain the protected-service policy-dependency test and expand it only when a new score-facing authorization entry point is introduced. |

## Original confirmed findings (historical baseline)

| ID | Priority | Finding | Evidence | Required outcome |
| --- | --- | --- | --- | --- |
| ARC-001 | P0 | There is no repository-root README that explains product scope, architecture, local setup, required services, quality entry points, and documentation navigation. | Root has no `README.md`; entry information is spread across `apps/README.md`, `backend/README.md`, and `docs/README.md`. | Add a concise root README with an architecture diagram, supported start path, links to docs, and ownership/quality commands. |
| ARC-002 | P0 | API contracts are maintained in more than one manual representation. The frontend owns `src/types/api/*` and `src/lib/api/*`; FastAPI exposes OpenAPI; `backend/docs/contracts/score-domain-v1.json` covers only part of the domain. | Source tree and contract tests. | Establish one authoritative API contract source and generate or validate TypeScript client/types in CI. Require breaking-change review. |
| ARC-003 | P1 | Several production files are large enough to have mixed responsibilities and high change-conflict risk. | `matchmaker_live.py` (1175 lines), `event-inspector.tsx` (1152), `editor-preview-panel.tsx` (952), `ops/service.py` (949), `musicxml/parser.ts` (789). | Split by stable responsibilities; each extracted unit must have direct tests and no behavior change before functional enhancements. |
| ARC-004 | P1 | Backend feature modules use a consistent template, but many generic `service.py` files are becoming broad orchestration hubs. | `backend/app/modules/*/service.py` and several 300-900 line service files. | Use intent-based names for new service units (for example `query_service`, `lifecycle_service`, `submission_service`) and split existing hotspots incrementally. |
| ARC-005 | P1 | Quality gates do not currently enforce coverage thresholds, architecture/dependency boundaries, or a generated full-stack API contract. | Workflows run lint, typecheck, test, build, container scans, and SBOM generation, but no matching gate was found. | Add thresholded coverage for critical domains, import-boundary tests, and contract compatibility checks. |
| ARC-006 | P1 | Browser E2E tests use mock APIs and therefore do not prove the critical real integration path. | `apps/customer-web/tests/e2e/support/api-mocks.ts`; Playwright config starts the UI only. | Add a small Docker Compose integration suite for auth/CSRF/proxy, core score flow, and practice WebSocket handshake. Keep mocked E2E tests for speed. |
| ARC-007 | P1 | CI path filters can miss cross-stack contract changes. For example, Customer Web Quality watches only `backend/app/shared/error_codes.py` from the backend. | `.github/workflows/customer-web-quality.yml`. | Trigger frontend contract checks for OpenAPI/schema/auth-protocol/client changes, or centralize them in a dedicated contract workflow. |
| ARC-008 | P1 | Action references are tag-pinned, not commit-SHA-pinned. | `.github/workflows/*.yml`. | Adopt SHA pinning plus Dependabot/Renovate updates, or document and formally accept the supply-chain trade-off. |
| ARC-009 | P1 | Documentation links are demonstrably stale. | `backend/README.md` uses another user's absolute `C:/Users/12631/...` paths; `docs/engineering/plans/practice-score-following-optimization-plan.md` contains six invalid `../backend`/`../apps` links; frontend engineering principles names a non-existent `docs/codebase-simplification-and-security-plan.md` instead of `docs/security/...`. | Replace with repository-relative links and add a Markdown-link validation job. |
| ARC-010 | P2 | Script folders have no local index or command contract. | `scripts/` (38 scripts), `backend/scripts/` (9 source scripts), `apps/customer-web/scripts/` (1 source script); no script README found. | Add concise READMEs that classify supported commands, diagnostics, one-off maintenance, inputs, safety, and CI ownership. |
| ARC-011 | P2 | Naming has isolated semantic debt. `playback-prototype.ts` is a production export and dependency. | `src/lib/score/verovio/playback.ts` exports it; the audio engine imports its types. | Rename it if production-supported; otherwise isolate it from production imports. |
| ARC-012 | P2 | Backend application bootstrap and configuration have duplication/concentration risk. | `main.py`, `practice_main.py`, and `control_plane_main.py` repeat middleware/tracing/exception setup; `core/config.py` is 499 lines. | Extract a parameterized runtime bootstrap and role-specific settings modules, while preserving the explicit security boundary of the control plane. |
| ARC-013 | P1 | Repository ownership and dependency-update automation are absent at the repository level. | No root `CODEOWNERS`, Dependabot, or Renovate configuration was found; only backend has a pre-commit configuration. | Define code owners for apps/backend/deploy/docs and configure reviewed dependency updates across npm, Python, GitHub Actions, and container bases. |
| ARC-014 | P2 | Deployment source hierarchy is intentional but difficult to infer, and several deployment README paths are stale. | `deploy/application` is a reusable template; `deploy/gitops/environments/staging/base` is a generated, digest-pinned snapshot. Their files intentionally differ. `deploy/application/README.md` and `deploy/observability/README.md` reference non-existent `docs/k8s-*.md` paths. | State the source/generation/immutability rules in every deployment index; replace plain paths with checked relative Markdown links. |
| ARC-015 | P1 | Practice WebSocket protocol is a hand-maintained TypeScript union and is not covered by the HTTP OpenAPI contract. Several payload fields intentionally accept unrestricted strings. | `apps/customer-web/src/lib/practice/protocol.ts`; Practice REST types are generated separately under `src/generated/practice-api/`. | Establish a versioned realtime schema with server/client validation, protocol-change review, test fixtures, and a documented additive/breaking-change policy. |
| ARC-016 | P1 | Score authorization is centrally implemented and behaviorally tested, but no mechanical rule currently proves that feature modules cannot bypass `ScoreAccessPolicy`. | `app.modules.score_access.policy`, focused coverage gate, and service imports; no architecture-boundary test or import rule found. | Add a focused architecture test or static import rule, plus representative route/service tests, that makes bypassing the policy fail CI. |

## Corrected findings from the first review

| ID | Correction | Evidence | Decision |
| --- | --- | --- | --- |
| COR-001 | The statement that generated frontend/backend artifacts were not ignored was incorrect when considering only root `.gitignore`. | `apps/customer-web/.gitignore` ignores `/node_modules`, `/.next/`, `/test-results`; `backend/.gitignore` ignores `.mypy_cache`, `.pytest_cache`, `.ruff_cache`; `git check-ignore -v` confirms these rules. | Do **not** duplicate every child rule in the root file. Retain scoped ignore files; standardize only policy and comments. |
| COR-002 | Separate `docs/` roots are not inherently a problem. | `docs/` holds cross-system architecture/operations/security; backend and customer web have implementation-local engineering guidance. | Keep distributed docs, but introduce clear ownership, indexes, link validation, and an explicit placement policy. |
| COR-003 | Separate `scripts/` roots are not inherently a problem. | Root scripts operate repo/platform quality and Kubernetes; backend scripts are backend diagnostics/maintenance; customer web has a frontend-specific contract script. | Keep scripts near the owning runtime. Add indexes and consistent naming rather than moving all scripts into one folder. |

## Recommendations that require validation before implementation

| ID | Priority | Recommendation | Validate first | Acceptance criteria |
| --- | --- | --- | --- | --- |
| REC-001 | P2 | Move customer-web code gradually toward feature-first colocation. | Map import graph and identify at least one feature whose components/hooks/lib are changed together. | A pilot feature has no circular imports, a documented public API, and simpler ownership than the current layout. |
| REC-002 | P2 | Enable more Ruff rules, stricter mypy settings, and a formatter. | Baseline current violations and agree an incremental adoption plan. | No mass suppression; new/changed code is held to the stricter baseline. |
| REC-003 | P2 | Trial the React Compiler on the editor/practice hotspot. | Capture build time, hydration, and interaction performance before/after. | Enable only if measured benefit outweighs build/debug cost. |
| REC-004 | P2 | Introduce a shared JavaScript package only for stable cross-application contracts. | Identify at least two versioned, jointly-owned consumers with a stable API. | Package has explicit owner, semver/versioning policy, tests, and no app-specific coupling. |
| REC-005 | P2 | Split `my_scores` into an explicit read-model/BFF query boundary if it continues to grow. | Document its write ownership and callers. | It either remains a small projection module or is renamed/restructured to make its query-only role explicit. |

## Target enterprise repository model

```text
README.md                         # one onboarding and system entry point
docs/                             # cross-cutting, normative documentation
  architecture/ adr/ engineering/ operations/ security/ product/ archive/
apps/
  customer-web/                   # deployable app; local docs/scripts only
  platform-admin/                 # deployable app; local docs/scripts only
backend/                          # deployable modular monolith; local docs/scripts only
deploy/ docker/                   # deployment assets and runtime definitions
scripts/                          # repository/platform automation only
.github/                          # CI policy, templates, ownership automation
```

### Placement policy

- Put a document in `docs/` when it is cross-runtime, normative, operational, architectural, security-related, or onboarding material.
- Put a document in `backend/docs/` or `apps/*/docs/` when it describes implementation details owned by that component. Each local docs folder must have an index and link back to the root documentation index.
- Put a script in the closest owning component when it imports or operates that component only. Put it in root `scripts/` only when it coordinates multiple components, release/deploy infrastructure, or repository quality.
- Keep `.gitignore` scoped: root for repository-wide artifacts; child files for tool/runtime artifacts created inside that child. Avoid duplicate patterns unless a root-level pattern is intentionally needed for safety.

## Execution order

1. ARC-001, ARC-009, ARC-010: make the repository navigable and mechanically verifiable.
2. ARC-002 and ARC-007: establish contract ownership before feature growth.
3. ARC-003, ARC-004, ARC-012: reduce concentrated complexity through tested incremental extraction.
4. ARC-005, ARC-006, ARC-008: harden release confidence and supply-chain governance.
5. Run and evaluate REC-001 through REC-005 only with data.

## Implementation history

### 2026-08-09: repository navigation and documentation baseline

- Added the repository-root `README.md` and indexes for root, backend, and
  Customer Web script/documentation scopes.
- Replaced confirmed stale absolute and relative documentation links.
- Added `scripts/check_markdown_links.py`, the `docs-links` repository quality
  check, and the `Documentation Quality` GitHub Actions workflow.
- Added a default `CODEOWNERS` file for the current repository maintainer.
- Validation passed locally: `python scripts/check_markdown_links.py`,
  `python -m py_compile scripts/check_markdown_links.py`, and
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/quality.ps1 -Check docs-links`.

These changes address ARC-001, ARC-009, ARC-010, and ARC-013 partially. They
do not replace the need for team-based ownership, a dependency update bot, or
broader release governance.

### 2026-08-09: OpenAPI contract baseline

- Added generated, committed OpenAPI documents for the Customer API (84 paths,
  138 schemas), Practice API (9 paths, 3 schemas), and Control Plane API (9
  paths, 23 schemas).
- Added `backend/scripts/export_openapi.py` with a non-writing `--check` mode.
- Added local and GitHub Actions contract verification through
  `backend-contracts` and `Backend Quality`.
- Documented the boundary: OpenAPI owns HTTP DTOs; the existing curated score
  domain contract owns product-level invariants; frontend view models stay
  frontend-owned.
- Validation passed locally: OpenAPI verification in matching API/practice
  Docker runtimes and `backend_quality_docker.ps1 -Check contracts`.

This advances ARC-002 and ARC-007. The next work is generated frontend types
and an incremental migration pilot; manual frontend DTOs are intentionally not
deleted by this baseline change.

### 2026-08-09: Customer Web generated-type pilot

- Added exact-version `@hey-api/openapi-ts` generation for Customer API DTOs.
- Added committed generated output under `apps/customer-web/src/generated/api/`
  and `check:api-types` freshness validation in Customer Web CI.
- Replaced manual Storage Usage and Notifications HTTP DTO declarations with
  direct generated-type imports, and deleted their compatibility re-export and
  duplicate declarations.
- Validation passed locally: generated-type freshness check, Customer Web
  TypeScript check, Billing Settings panel unit tests, and ESLint.

The initial `openapi-typescript` option was rejected because its current peer
dependency excludes this repository's TypeScript 6 baseline. The selected
generator explicitly supports TypeScript 6 and is exact-version pinned.

During the development phase, DTO migrations deliberately do not retain aliases
or compatibility import paths: a migrated caller imports generated types
directly, and the replaced hand-maintained declaration is deleted in the same
change. This prevents temporary scaffolding from becoming permanent debt.

### 2026-08-09: Auth and account contract completion

- Added explicit backend response schemas for current-user profile, profile
  updates, avatar uploads, sessions, security overview, and email-change
  confirmation; the affected FastAPI routes now publish parameterized
  `APIResponse[T]` contracts.
- Regenerated the Customer API contract and switched the Customer Web auth and
  account callers to direct generated imports.
- Deleted `src/types/api/auth.ts`, including the former duplicate request and
  response DTOs, and removed the profile-context `unknown` type assertion.

This closes the previously hidden `unknown` contract gap for the migrated
account endpoints. Backend response models are now required before frontend
DTO migration; frontend hand-written response shapes are not an acceptable
substitute.

### 2026-08-09: Library contract migration

- Replaced all Customer Web library DTO imports with direct generated contract
  types and deleted `src/types/api/library.ts`.
- Kept the user-selectable practice-state restriction as a frontend interaction
  rule derived from the generated enum, rather than duplicating an HTTP DTO.
- Replaced the backend's broad `dict[str, int]` batch-operation responses with
  explicit move, update, and add result models, then regenerated the OpenAPI
  contract and frontend types.

The library client now derives both its list-query payload and batch-result
types from OpenAPI. Cache-key and dialog-props types remain frontend-owned
because they are not HTTP representations.

### 2026-08-09: Import workflow contract migration

- Added explicit API response models for uploaded files and import-job list,
  detail, submission, retry, and batch-status endpoints.
- Replaced the Customer Web upload, import-job, review, and My Scores job DTO
  imports with direct generated types; deleted `src/types/api/files.ts` and
  `src/types/api/import-jobs.ts`.
- Tightened import taxonomy tags from arbitrary string dictionaries to the
  existing score taxonomy schema. The upload UI now validates restored tags
  against its user-selectable genre set rather than asserting their shape.

Import-job service and worker internals may still use mapping-oriented values;
the HTTP boundary is now explicit and independently generated. No deprecated
frontend DTO aliases remain for this workflow.

### 2026-08-09: Score contract migration prerequisite

The first Score API migration was intentionally not applied. Generated
`ScoreRead`, revision, and asset types currently mark fields optional that the
Customer Web treats as required, including capabilities, derived-asset status,
taxonomy confidence, and revision cursor metadata. Migrating with type
assertions, defaulting, or aliases would conceal an incomplete API contract.

Before migrating Score DTO consumers, the backend score response schemas must
declare the actual requiredness and nullability of these fields, regenerate
OpenAPI, and gain response-contract tests. The existing hand-maintained score
DTOs remain temporarily necessary until that source-of-truth correction is
complete.

### 2026-08-09: Score response-contract requiredness correction

- Removed schema defaults that incorrectly made score capabilities, derived
  assets, and taxonomy confidence optional in OpenAPI. Their construction paths
  now provide every required response field explicitly.
- Added an OpenAPI contract test for the score read models and regenerated the
  committed Customer API contract and generated Customer Web types.
- Confirmed that `ScoreRead`, `ScoreCapabilities`, `ScoreDerivedAssetRead`, and
  `ScoreTaxonomyTagRead` now generate the expected required fields.

The revision cursor remains `int | str | null` by design because the common
cursor page supports opaque string cursors. The upcoming frontend migration
must adopt that API contract directly rather than narrow it to a numeric
hand-written DTO.

### 2026-08-09: Customer Web Score core contract migration

- Replaced the Score detail, revision, revision-content, derived-asset, and
  revision-asset HTTP DTO declarations with direct imports from the generated
  Customer API contract.
- Removed their former hand-maintained declarations, including the duplicate
  fingering request/result shapes; editor hand-size annotations now derive from
  the generated `FingeringRequest` field.
- Updated Score revision pagination to accept the API's `number | string |
  null` cursor contract without narrowing or compatibility conversion.

Share, invite, grant, membership, and publication DTOs remain a separate
Score-access migration unit. They no longer duplicate the common Score read
sub-shapes removed in this change.

### 2026-08-09: Customer Web Score-access contract migration

- Replaced the share grant, invite, membership, pending-invite, and publication
  clients and consumers with their direct generated Customer API types.
- Deleted `src/types/api/scores.ts` and its barrel export. There are no
  hand-maintained Score HTTP DTOs or compatibility exports remaining.
- Preserved local UI-only types and behavior while removing only HTTP-shape
  duplication; request payloads now use generated request models as well.

### 2026-08-09: Customer Web My Scores contract cleanup

- Replaced My Scores list view, sort, and score item HTTP types with direct
  generated `MyScoresView`, `MyScoresSort`, and `ScoreRead` imports.
- Deleted `src/types/api/my-scores.ts` and its barrel export.
- Moved `MyScoresPageView` to the My Scores state module because it describes
  local UI tabs that include import-job states and is not an HTTP DTO.

### 2026-08-09: Practice runtime contract separation

- Added explicit Practice runtime response models and response annotations for
  session and report endpoints; removed the former service-return `TypedDict`
  declarations.
- Added a separately generated Customer Web Practice API contract from the
  committed `practice-api.json` document. Practice is a separate FastAPI
  runtime and is not merged into the Customer API contract.
- Moved browser WebSocket message types to `lib/practice/protocol.ts`; its
  session-state field derives from the generated Practice API enum. Deleted
  the mixed `types/api/practice.ts` module and its barrel export.

### 2026-08-09: Customer Web transport-type boundary cleanup

- Moved the generic `ApiResponse` and `PaginatedResponse` transport envelopes
  into `lib/api-client.ts`, their actual ownership boundary.
- Removed unused cursor and offset page declarations, then deleted the empty
  `src/types/api/` directory and its barrel file.
- Confirmed that no Customer Web source or test still imports the removed API
  type directory. HTTP DTOs now come only from generated contracts.

### 2026-08-09: Generated-contract quality-gate hardening

- Updated the Customer Web generated-type check to reject both untracked output
  and any output differing from `HEAD`; the former `git diff` check could miss
  a newly generated directory that was never committed.
- Added the Practice OpenAPI document to Customer Web CI path filters, so a
  Practice-contract-only change also runs generated-type validation.
- The stricter check intentionally fails in this uncommitted worktree until
  generated directories are committed; this is the desired release safeguard,
  not a runtime or type-check failure.

### 2026-08-09: Contract migration and quality-baseline completion

- Committed the generated Customer and Practice API types, OpenAPI documents,
  contract exporters, response-contract tests, and repository/documentation
  indexes in `fd05a63`.
- Removed the remaining Customer Web hand-maintained HTTP DTO modules. HTTP
  representations now come from the generated Customer or Practice contract;
  frontend interaction and view-state types stay at their owning UI boundary.
- Corrected backend response-model return types and migrated regression tests
  from obsolete dictionary assertions to explicit Pydantic-model assertions in
  `dae05cf`.
- Ran the CI-equivalent quality suite: backend Ruff, both mypy configurations,
  all three OpenAPI checks, 311 core tests, and 66 Practice tests; Customer Web
  lint, generated-type check, typecheck, i18n check, 194 tests, and production
  build; Platform Admin lint, typecheck, 3 tests, and production build; plus
  documentation, Kubernetes, and observability manifest checks.

ARC-001, ARC-002, ARC-007, ARC-009, and ARC-010 are complete. ARC-013 is
partially complete: `CODEOWNERS` exists, but automated reviewed dependency
updates are still absent. ARC-005, ARC-006, ARC-008, ARC-011, and ARC-012 are
not completed by this work.

### 2026-08-09: Frontend dependency-security baseline

- Pinned non-breaking production dependency fixes for `postcss` and `nanoid`
  in `b2619b2`, then updated compatible development-tool dependency patches in
  `36dfc07`.
- Both Customer Web and Platform Admin production dependency audits are clean;
  the complete Customer Web dependency graph is also clean after `npm ci`.
- Customer Web lint, generated API contract validation, typecheck, 194 tests,
  and production build passed after the development-tool patch update.

Dependency updates remain a manual, reviewed process until ARC-013 gains a
Dependabot or Renovate policy.

### 2026-08-09: CI dependency-update and Action-pinning policy

- Added Dependabot configuration for both npm applications, backend pip
  requirements, GitHub Actions, and Dockerfile directories in `a24c5e7`.
  Updates are weekly, reviewed, capped at three open version-update PRs per
  ecosystem, and never auto-merged.
- Replaced every GitHub Actions tag reference with the immutable commit SHA of
  the same currently selected action release. Inline release comments preserve
  readable version intent; Dependabot now owns later SHA update PRs.

ARC-008 is complete. ARC-013 remains partially complete until Dependabot alerts
and security updates are enabled in the repository's GitHub security settings.

### 2026-08-09: Verovio playback naming cleanup

- Renamed the production `VerovioPlaybackPrototype` implementation to
  `VerovioPlaybackController` and its source module from
  `playback-prototype.ts` to `playback-controller.ts`.
- Updated all production imports and tests directly; no deprecated export or
  compatibility alias remains.

ARC-011 is complete.

### 2026-08-09: Coverage-report baseline

- Added explicit Customer Web V8 coverage reporting and Docker-based backend
  coverage commands to the unified quality entry points. Backend coverage is
  configured with branch measurement and the `app` package as its source.
- Added the pinned `pytest-cov` quality-only dependency. Runtime images remain
  free of test tooling.
- Established initial passing reports without a repository-wide fail-under:
  Customer Web has 70.57% statements, 58.64% branches, 64.65% functions, and
  72.20% lines; the backend core suite has 64% total coverage (311 passing
  tests); the isolated Practice suite has 25% total coverage (66 passing
  tests).

ARC-005 is partially complete. The remaining work is to add coverage around
critical domain flows, and introduce domain-specific thresholds and
architecture-boundary checks rather than an unrepresentative global threshold.

### 2026-08-09: First critical-domain coverage gate

- Promoted the existing score-access policy test suite into an explicit quality
  gate: it measures only `app.modules.score_access` and requires at least 80%
  coverage. The current focused result is 83% across 44 passing tests.
- Kept the threshold independent from the repository-wide report, so unrelated
  modules cannot conceal regressions in score authorization behavior.

ARC-005 remains partially complete. Future gates must cover other critical
domains independently, beginning with import-job authorization and Practice
session ownership.

### 2026-08-09: Real Customer Web and backend integration foundation

- Added an isolated Docker Compose environment with disposable PostgreSQL and
  Redis services, migration and deterministic-user seed jobs, the real backend
  API, and Customer Web. It does not reuse development data stores.
- Added an external Playwright configuration and first real browser-facing
  integration scenario for Next rewrite proxying, login cookies, authenticated
  API reads, and CSRF enforcement.
- Verified the complete disposable environment from an empty PostgreSQL
  database: migrations, test-user seed, API and Customer Web health checks, and
  the real Playwright authentication scenario all pass. During this validation,
  migration `0017` was corrected to commit its PostgreSQL enum addition before
  migration `0018` references the new value.
- The remaining ARC-006 scope is the real score flow and Practice WebSocket
  handshake. They will be added to this same isolated environment rather than
  extending mocked browser suites.

### 2026-08-09: Import execution coverage gate

- Added a focused 80% quality gate for import worker execution. The existing
  reliability tests cover durable input materialization, timeout classification,
  and failure finalization; the focused result is 86% across 5 passing tests.
- At this measurement point, the API-facing import-job service (63%) and worker
  status coordinator (54%) were outside this gate. They required authorization
  and state-transition tests before a credible threshold could be introduced.

### 2026-08-09: Import-job ownership and state gate

- Added direct tests for the import-job API service: job lookup exposes stable
  not-found and access-denied responses, retry accepts only failed jobs and
  reconstructs its original request, and running jobs cannot be deleted.
- The focused import-job service result increased from 63% to 72% across 68
  relevant passing tests. It now has a 70% independent quality threshold.
- At this measurement point, the worker status coordinator was outside a
  threshold at 54%; its state transitions needed direct tests before it could
  become a credible release gate.

### 2026-08-09: Import worker state-coordination gate

- Added direct state-transition tests for the synchronous import worker service:
  progress updates, missing jobs, successful and failed completion, internal
  diagnostics, owner notifications, and creating or updating named steps.
- The focused worker service result rose from 54% to 83% across 52 relevant
  passing tests. It now has an independent 80% quality threshold.
- Artifact replacement and public detail shaping remain tested at their owning
  boundaries and are intentionally not mixed into the state-coordination gate.

### 2026-08-09: Practice ownership and lifecycle gate

- Tightened `prepare_stream_runtime` so every caller must pass session ownership
  validation even when a runtime is already cached. The WebSocket router had an
  earlier check, but the service boundary now enforces the rule itself.
- Added direct Practice service tests for missing and cross-user sessions,
  lifecycle transitions, invalid terminal states, report success and failure,
  and alignment persistence.
- The focused Practice service result rose from 20% to 68% across 74 relevant
  passing tests. It initially received a 65% threshold in the isolated Practice
  quality image; session creation and runtime-registration failures remained the
  next coverage priority.

### 2026-08-09: Practice creation and runtime-registration coverage

- Added direct tests for session creation authorization and canonical-source
  validation, runtime registration, terminal-session rejection, and the
  persisted failure state when the alignment runtime cannot be registered.
- The focused Practice service result is now 85% across 77 relevant passing
  tests, so its threshold was raised from 65% to 80%. Session-detail lookup and
  report-payload parsing remain outside these scenarios and should be covered
  before the next threshold increase.

### 2026-08-10: Real score-import entry integration flow

- Extended the disposable Customer Web/backend browser suite from auth-only
  coverage to the actual score-import entry flow: authenticated image upload,
  import-job submission, and pending-job readback through the Next proxy.
- The Compose environment now explicitly overrides asynchronous and synchronous
  database URLs, scheduler-lock database URL, Celery Redis URLs, and object
  storage to ensure the suite cannot use development or external services.
- Verified from an empty disposable PostgreSQL database: migrations, user seed,
  health checks, auth/CSRF scenario, and score-import entry scenario all pass
  (two Playwright tests).

ARC-006 now covers the real score-import entry boundary but not worker-based
score generation or the Practice WebSocket handshake. Worker completion remains
deferred until the required offline models are available.

### 2026-08-10: Import request JSON-boundary correction

- Fixed the production import path for taxonomy-tagged uploads. Validated
  Pydantic taxonomy-tag objects were previously assigned directly to the
  `import_jobs.requested_options` JSON column, causing PostgreSQL JSON
  serialization to fail before an import job could be queued.
- The submission boundary now stores JSON-compatible tag dictionaries while
  retaining the validated request model at the HTTP boundary. A regression test
  and the real Customer Web upload/import integration scenario cover the case.

### 2026-08-10: Worker model-cache completeness validation

- Strengthened the Worker Hugging Face runtime check: it now parses sharded
  model indexes and verifies every declared checkpoint shard, rather than
  accepting a snapshot with any single weight file.
- This prevents an incomplete offline model cache from passing startup checks
  only to fail later inside a user-triggered LEGATO inference subprocess. The
  failure message identifies the missing shard names for operational recovery.

### 2026-08-10: Development reload and Worker artifact isolation

- Narrowed Uvicorn development reload watches from the whole bind-mounted
  application directory to `/app/app`. Worker uploads and inference artifacts
  are written below `/app/data`, so they can no longer restart API, Practice,
  or control-plane processes during active processing.
- Documented the boundary in the Docker backend runtime runbook. The production
  startup path remains unchanged because it does not enable Uvicorn reload.

### 2026-08-10: HTTP application runtime composition baseline

- Extracted shared HTTP runtime installation into `app.core.http_runtime`:
  structured logging, optional CSRF and CORS middleware, exception handlers,
  and tracing are now installed through one tested implementation.
- Customer API, Practice API, control plane, and observability exporter retain
  their own FastAPI metadata, route trees, lifespans, and explicit security
  policy. In particular, control-plane cookie names, CSRF exemption, and CORS
  origins still originate only from control-plane settings.
- Focused API, Practice, WebSocket, public-error, and control-plane tests pass.
  The next ARC-012 step is configuration decomposition, which requires a
  measured map of consumers before moving settings out of `core/config.py`.

### 2026-08-10: Backend settings ownership map

- Measured `core/config.py` as a roughly one-hundred-field schema with about
  sixty direct backend consumers. Recorded runtime owners, cross-runtime
  dependencies, validation constraints, and a no-alias extraction contract in
  the architecture documentation.
- Chose Observability settings as the first safe extraction candidate. Database,
  queue, storage, and secret settings remain deliberately deferred because they
  cross release-critical runtime boundaries and require credential-rotation
  coordination.

### 2026-08-10: Observability settings extraction

- Moved `LOG_FORMAT` and `OTEL_*` declarations plus their normalization and
  fail-fast tracing validation into `app.core.settings.observability`.
- `Settings` composes the group directly, so environment variable names and
  consumer access remain unchanged without aliases, fallback reads, or dual
  configuration sources.
- Added direct group tests for normalization and tracing requirements. The next
  low-risk candidate is Practice diagnostics, after its consumer list and
  interval validation are verified in the same manner.

### 2026-08-10: Practice diagnostics settings extraction

- Moved the Practice diagnostics switch and its two interval settings into
  `app.core.settings.practice_diagnostics`, including the positive-interval
  validation. Existing Practice consumers continue to read one composed
  settings object, with no alias or fallback path.
- Documented the local Docker environment-file boundary: Task reliability
  tuning is appropriate in the untracked local `.env.docker` file, while
  production reliability policy belongs in reviewed, versioned deployment
  configuration and secrets remain in the deployment secret store.

### 2026-08-10: Settings architecture boundary and configuration taxonomy

- Added a static architecture contract that prevents extracted
  `app.core.settings` groups from importing application runtime modules. This
  keeps group validation independently testable and prevents circular imports
  as the settings decomposition continues.
- Documented the three configuration sources of truth: deployment/runtime
  configuration, versioned domain/algorithm profiles, and audited dynamic
  product policy. Practice audio and OCR/MusicXML profiles remain versioned
  code because their values must be reviewed and regression-tested with the
  algorithms that consume them.

### 2026-08-10: Worker model and engine settings extraction

- Moved the complete Worker model/engine group from `core/config.py` to
  `app.core.settings.worker_model_engine`: offline model locations and
  repositories, PaddleOCR deadline, LEGATO runtime selection, Verovio output
  configuration, and playback synthesis settings.
- Moved each related parser, path normalizer, field validator, and LEGATO
  cross-field validation with the group. `Settings` composes the group with no
  aliases or fallback reads; existing consumers retain one authoritative
  settings instance.
- Added isolated validation tests. Worker model smoke validation remains
  pending until the offline model snapshot download completes.

### 2026-08-10: Local Docker configuration audit

- Audited `backend/.env.docker` by key name only; no secret values were read or
  recorded. Five keys are outside the `Settings` schema: the active
  entrypoint-only `CELERY_WORKER_CONCURRENCY`, plus four obsolete email-code
  keys with no code consumer. Pydantic currently ignores the obsolete keys,
  which is silent configuration drift.
- The common Compose environment file currently injects Worker-only model and
  process settings into API, Practice, and Beat. Thirty-five schema settings
  also rely on local code defaults rather than being explicit in the Docker
  baseline. The next environment-boundary task must split role projections and
  remove the obsolete email-code contract, including its stale product
  documentation, without adding compatibility variables.

### 2026-08-10: Obsolete local email-code configuration removed

- Removed four email-code variables with no `Settings` declaration or runtime
  consumer from the untracked local Docker manifest and committed Docker
  example. Updated product documentation to describe the implemented signed
  verification and password-reset link lifetimes instead of the retired code
  flow. No compatibility variables were retained.

### 2026-08-10: Worker process environment projection

- Moved the entrypoint-only `CELERY_WORKER_CONCURRENCY` from the shared local
  Docker manifest into a Worker-only manifest. Compose now injects it only into
  the Worker service; API, Practice, Beat, and quality containers no longer
  receive it.
- Added an ignored local worker manifest, its committed example, and schema
  contract coverage for both templates. This is the first role projection;
  model and application settings remain shared until their runtime loaders are
  separated rather than being hidden through an unsafe Compose-only change.

### 2026-08-10: Playback settings ownership extraction

- Moved playback SoundFont and synthesis limits into `PlaybackSettings`.
  Playback is used by both API delivery paths and Worker-generated assets, so
  it is a shared processing configuration rather than a Worker model setting.
- Narrowed `WorkerModelEngineSettings` to OCR/model, OMR, and rendering
  parameters before the forthcoming Worker-only runtime loader extraction.

### 2026-08-10: Worker runtime-loader migration boundary measured

- Recorded the exact eight direct consumers of Worker model/engine settings and
  the required migration rule: `runtime_checks` must load Worker settings only
  inside Worker-specific checks because HTTP lifespans import that module.
- Explicitly prohibited optional Worker model fields and fallback loaders. The
  next implementation change must migrate the entire measured set, remove the
  group from shared settings, and then move its environment variables into the
  Worker-only manifest as one atomic runtime change.

### 2026-08-10: Worker runtime settings loader extracted

- Shared `Settings` no longer composes Worker model/engine fields.
  `WorkerRuntimeSettings` loads them lazily and strictly only in Worker-owned
  OCR, LEGATO, Verovio, pipeline, startup-status, and runtime-check paths.
- Migrated the measured direct consumers and their tests without retaining
  shared-setting aliases. The next change moves the corresponding Docker model
  variables into the Worker manifest and validates each non-Worker service can
  start without them.

### 2026-08-10: Worker model configuration role isolation completed

- Worker model, OCR, LEGATO, and Verovio configuration now resides in the
  Worker-only Docker manifest and is loaded only through `WorkerRuntimeSettings`.
  API, Practice, and Beat checks pass without those variables; Worker validates
  CUDA and complete offline model snapshots successfully.

### 2026-08-10: Practice runtime configuration role isolation completed

- Moved Practice SoundFont and diagnostics to `PracticeRuntimeSettings` and a
  Practice-only Docker manifest. API no longer receives Practice alignment
  configuration; API and Practice runtime checks both pass after the split.

### 2026-08-10: Database, queue, and storage migration boundary measured

- Mapped separate API/Practice async database, Worker sync database, Beat
  advisory-lock, and shared-storage projections. Deferred Compose splitting
  until typed setting groups and their fail-fast validation move with the
  measured consumers.

### 2026-08-10: Task deadline configuration ownership extracted

- Moved `MAX_PROCESSING_TIME`, `CELERY_TASK_SOFT_TIME_LIMIT`, and
  `CELERY_TASK_TIME_LIMIT` into `TaskReliabilitySettings`, including positive
  value and ordered shutdown-envelope validation. Shared `Settings` and
  `WorkerRuntimeSettings` now compose this one owner rather than duplicating
  declarations and ordering checks.
- Retained the Worker-specific invariant that PaddleOCR's subprocess deadline
  cannot exceed the shared processing deadline. The Celery runtime test now
  reads OCR timing through the strict Worker loader, so API and Beat no longer
  implicitly require Worker model configuration.

### 2026-08-10: Outbox and lifecycle policy boundary measured

- Mapped all remaining scheduling and reliability fields to six cohesive
  domain groups: import dispatch, render asset delivery, playback delivery,
  mail delivery, notification/realtime retention, and score deletion lifecycle.
- Confirmed that these policies are shared contracts, not Worker-only settings:
  domain services enforce them, Ops and metrics read the same retry ceilings,
  and Beat only triggers periodic work. They must remain in the shared base
  deployment manifest while setting groups are extracted one domain at a time.
- Selected Import dispatch as the next safe implementation unit. Its complete
  consumer set is documented; no aliases, fallbacks, or deployment-manifest
  split are needed for the extraction.

### 2026-08-10: Import dispatch policy ownership extracted

- Moved import cadence, dispatch and processing lease timeouts, retry/batch
  limits, and orphan-upload retention into `ImportDispatchSettings`, with its
  positive-integer validation. Shared `Settings` composes the group without
  changing environment variable names or deployment manifests.
- Updated the configuration test name to match its actual subject and added
  direct settings-group coverage. While running the affected regression suite,
  corrected a Practice audio test that had loaded a strict Practice setting from
  the generic quality container; it now supplies its explicit test environment
  input and clears the cached loader, without adding runtime fallback behavior.

### 2026-08-10: Render asset delivery policy ownership extracted

- Moved render Outbox cadence, dispatch/processing leases, retry and batch
  policy, derived-asset retention, and cleanup cadence into
  `RenderAssetDeliverySettings`. The group retains its distinct non-negative
  retention rule: zero historical revisions is an intentional valid policy,
  while delivery values remain strictly positive.
- Added direct group tests and Beat schedule coverage for both render delivery
  and derived-asset cleanup. Shared `Settings` continues to compose the group;
  no environment names, manifests, aliases, or fallback behavior changed.

### 2026-08-10: Playback delivery policy ownership extracted

- Moved playback Outbox cadence, dispatch/processing leases, retry backoff,
  retry limit, and batch limit into `PlaybackDeliverySettings`, with direct
  positive-value validation and group tests.
- Kept this operational policy separate from `PlaybackSettings`, which owns
  SoundFont synthesis parameters. Added shared-settings and Beat scheduling
  coverage; no deployment manifest, environment name, alias, or fallback
  behavior changed.

### 2026-08-10: Mail delivery policy ownership extracted

- Moved mail Outbox cadence, dispatch/processing leases, retry backoff, retry
  and batch limits, and completed-mail retention into `MailDeliverySettings`,
  with direct positive-value validation and tests.
- Kept this delivery policy separate from account mail-provider credentials and
  sender identity. Added shared-settings and Beat scheduling coverage; no
  deployment manifest, environment name, alias, or fallback behavior changed.

### 2026-08-10: Notification and realtime policy ownership extracted

- Moved notification cleanup/retention into `NotificationLifecycleSettings`.
  Split realtime configuration into `RealtimeStreamSettings` for HTTP SSE
  catch-up, heartbeat, and batching, and `RealtimeRetentionSettings` for
  background cleanup and retention.
- Preserved the existing strict deployment contract: realtime cleanup cadence
  and retention days remain required environment inputs rather than gaining
  newly invented defaults. Added direct group tests plus shared-settings,
  Celery, and SSE regression coverage without aliases or fallback behavior.

### 2026-08-10: Score deletion lifecycle ownership extracted

- Moved score-deletion cleanup cadence, batch size, retry backoff, and maximum
  attempts into `ScoreDeletionLifecycleSettings`, with direct positive-value
  validation and tests.
- Added shared-settings coverage and revalidated the lifecycle, Ops, storage
  usage, and Beat consumers. No environment name, deployment manifest, alias,
  fallback, or deletion workflow behavior changed.

### 2026-08-10: Fingering execution policy ownership extracted

- Moved interactive fingering concurrency, queue-wait, and input-size limits
  into `FingeringExecutionSettings`, with direct positive-value validation and
  tests.
- Confirmed this is a deployment resource-protection policy, not an algorithm
  profile: the API service and bounded executor consume it, while the fingering
  engine's algorithm implementation remains unchanged. No environment name,
  manifest, alias, or fallback behavior changed.

### 2026-08-10: Remaining account and API policy boundary measured

- Mapped four non-overlapping groups: customer session security, account
  email-link lifetimes, transactional mail-provider integration, and upload
  admission. The next implementation unit is customer session security;
  control-plane identity remains intentionally separate.
- Confirmed `FRONTEND_BASE_URL` is a shared platform URL because account links
  and score invitations both use it, so it must not move into email-link
  policy. Recorded that the Docker example exposes verification lifetime while
  password-reset lifetime currently uses its code default; no redundant
  environment variable was introduced.

### 2026-08-10: Customer session security ownership extracted

- Moved customer access/refresh lifetimes and Cookie/CSRF names, security, and
  `SameSite` policy into `CustomerSessionSecuritySettings`, with direct tests.
- Added fail-fast validation for non-positive lifetimes, blank cookie contract
  values, and unsupported `SameSite` values. Revalidated API smoke and public
  error-contract coverage; no environment name, manifest, alias, fallback, or
  control-plane configuration behavior changed.

### 2026-08-10: Account email-link lifetime ownership extracted

- Moved password-reset and email-verification/change link expiry into
  `AccountEmailLinkSettings`, with direct positive-value validation and tests.
- Revalidated registration, verification, email-change, and password-reset
  workflows. `FRONTEND_BASE_URL`, mail provider settings, and Mail Outbox
  delivery policy remain independent; no environment name, manifest, alias, or
  fallback behavior changed.

### 2026-08-10: Transactional mail-provider ownership extracted

- Moved Resend API endpoint, key, and default sender into
  `TransactionalMailProviderSettings`, with direct validation and tests.
- Preserved the explicit disabled-provider state for local development while
  rejecting a sender-only or key-only partial configuration at startup. Mail
  Outbox delivery policy remains separate; no environment name, manifest,
  alias, or fallback behavior changed.

### 2026-08-10: Upload admission policy ownership extracted

- Moved the generic score-processing upload extension allowlist into
  `UploadAdmissionSettings` and made it immutable. The group rejects empty,
  dotted, and non-lowercase extension lists before request handling.
- Revalidated file-service and API upload behavior. The account-avatar service
  keeps its intentionally narrower independent allowlist; no storage backend,
  environment name, manifest, alias, or fallback behavior changed.

### 2026-08-10: Platform HTTP and security boundary measured

- Split the remaining platform fields into five non-overlapping ownership
  candidates: token signing secret, browser CORS, trusted proxy, public
  frontend URL, and service identity/routing. Control-plane settings remain
  intentionally validated only by its isolated runtime loader.
- Confirmed that CORS origins and trusted proxy CIDRs are distinct security
  trust decisions and must not share a generic allowlist. Selected
  `TrustedProxySettings` as the next safe extraction because its CIDR parser
  and anti-`/0` validation already form a self-contained contract.

### 2026-08-10: Trusted proxy policy ownership extracted

- Moved trusted proxy CIDR JSON parsing, normalization, CIDR validation, and
  the anti-`/0` guard into `TrustedProxySettings`, with direct group tests.
- Revalidated client-address forwarding behavior and API safety coverage. The
  migration also removed the obsolete `json` import from the shared config
  module; no environment name, manifest, alias, or fallback behavior changed.

### 2026-08-10: Browser CORS policy ownership extracted

- Moved the customer API/Practice `BACKEND_CORS_ORIGINS` JSON-array/URL-list
  contract into `BrowserCorsSettings`, preserving the valid explicit empty-list
  state and keeping control-plane CORS separate.
- Direct settings and shared HTTP runtime tests passed, as did direct API and
  Practice CORS-wiring imports. The broad TestClient crash observed at the time
  was later resolved by rebuilding the local Python 3.12 quality image; it was
  not accepted as a substitute for API regression coverage.

### 2026-08-10: Token signing secret ownership extracted

- Moved `SECRET_KEY` and its strength validation into `TokenSigningSettings`.
  The group preserves the existing 32-character minimum and additionally
  rejects a pure-whitespace value at startup.
- Added direct settings and JWT sign/decode regression coverage. No algorithm,
  environment name, manifest, alias, fallback, or control-plane behavior
  changed.

### 2026-08-10: Public frontend URL ownership extracted

- Moved `FRONTEND_BASE_URL` into `PublicFrontendUrlSettings`, with direct
  validation that requires an absolute HTTP(S) URL and rejects query/fragment
  components.
- Revalidated account email-link and score-invitation consumers. No API prefix,
  CORS, environment name, manifest, alias, or fallback behavior changed.

### 2026-08-10: Service identity and routing ownership extracted

- Moved `PROJECT_NAME`, `API_V1_STR`, and environment-style `DEBUG` parsing
  into `ServiceIdentitySettings`. The group rejects blank product names and
  ambiguous customer API prefixes before app factories consume them.
- Control-plane-specific cookies and CORS remain in the isolated control-plane
  boundary. The rebuilt Python 3.12 quality image restored API regression
  coverage; no environment name, manifest, alias, or fallback behavior changed.

### 2026-08-10: Python 3.12 quality-image stability revalidated

- LEGATO requires Python 3.12, so Python 3.11 is not an acceptable backend
  runtime alternative. A temporary Python 3.11 diagnostic image was discarded
  and the local quality image was rebuilt using its default Python 3.12 base.
- On the rebuilt Python 3.12 quality image, `app.db.models` imported
  successfully in 20 independent processes; the complete `score_access.py`
  model module and the previously failing Docs/OpenAPI smoke test also passed.
  The API smoke, public-error-contract, and HTTP-runtime regression group
  passed 32 tests.
- The earlier native fault is therefore not attributable to
  `ScoreShareGrant`, the Python 3.12 baseline, or a proven Pydantic/SQLModel
  incompatibility. Treat a stale or inconsistent local quality image as the
  current cause. When this symptom recurs, rebuild the quality image before
  changing source models or pinned dependencies.

### 2026-08-10: Application-factory service-identity contract added

- Added a direct API, Practice, Control Plane, and observability composition
  test for `PROJECT_NAME` and `API_V1_STR`. It proves that customer API routing
  changes do not affect the control-plane path, and that the internal
  observability surface remains without OpenAPI.

### 2026-08-10: Control Plane environment boundary extracted

- Removed all `CONTROL_PLANE_*` fields from shared `Settings`. The isolated
  `ControlPlaneRuntimeSettings` is now the sole required environment loader
  for the operator HTTP surface, with direct validation for names, cookie
  policy, session lifetime, and non-empty CORS origins.
- Added `backend/.env.docker.control-plane.example` and made the Compose
  Control Plane profile require its untracked local counterpart. Customer API,
  Worker, Beat, Practice, and quality services do not receive this identity
  configuration.
- Kept `CONTROL_PLANE_API_PREFIX` as a source-owned versioned contract rather
  than an environment variable or an alias for `API_V1_STR`: the two APIs are
  independently hosted and may evolve independently even while both currently
  expose `/api/v1`.

### 2026-08-10: Beat scheduler validation ownership completed

- Moved all scheduler lock, keepalive, timeout, retry, and heartbeat positive
  value validation from the shared `Settings` composition root into
  `BeatSchedulerSettings`.
- Added direct group coverage for every timing field. `Settings` now composes
  typed settings groups without retaining scheduler-domain validation.

### 2026-08-10: Customer API prefix made source-owned

- Replaced environment-loaded `API_V1_STR` with the single
  `CUSTOMER_API_PREFIX` source constant. Customer API, Practice, upload URL,
  score-asset URL, OpenAPI, and CSRF consumers now use that versioned contract.
- Removed `API_V1_STR` from both the committed Docker template and the local
  Docker environment file. Deployment path topology must use gateway/root-path
  configuration rather than changing a public API version prefix at runtime.

### 2026-08-10: Configuration-governance model and provenance backlog

- Adopt the following ownership categories instead of a binary
  source-versus-environment rule: versioned public contracts; build/model
  identity manifests; immutable algorithm/output profiles; deployment topology;
  runtime capacity; bounded security/resource policy; and secrets.
- Do not mechanically move every TTL, limit, default engine, or `MAX_*` value
  out of the environment. A value remains deploy-time configurable when it
  changes capacity, topology, or an explicitly bounded security/resource
  policy. Values that change output semantics require a versioned profile or
  manifest and provenance.
- **Priority 1 — Execution manifest plus provenance:** create immutable,
  content-addressed engine/model manifests. Persist a manifest digest for an
  ImportJob when execution starts; later attach the applicable manifest/profile
  digest to render and playback artifacts. A Worker readiness check only proves
  the current process is configured correctly; it is not historical job
  provenance.
- **Data-model decision:** do not duplicate an identical full manifest JSON on
  every job. Use a normalized immutable manifest record keyed by SHA-256 and
  let jobs/artifacts reference it. A JSON snapshot is acceptable only as a
  deliberate denormalized audit copy with a documented retention purpose.
- **Priority 2 — Result-semantic profiles:** introduce immutable OMR, render,
  and playback profiles only for values whose change can alter generated
  artifacts. Keep device, concurrency, batch size, paths, and timeouts in
  deployment/runtime configuration.
- **Priority 3 — Policy boundaries:** define security/resource defaults,
  allowed override ranges, validation, and change-audit requirements for token
  lifetimes and input/resource limits. Distinguish hard implementation limits
  from lower deployment protection limits.
- Do not promise bit-for-bit reproduction merely from manifest provenance:
  record traceable execution identity first, then assess CUDA, driver, GPU,
  library, and nondeterministic-kernel controls separately if strict
  reproducibility becomes a product requirement.

### 2026-08-10: Import manifest digest made auditable

- Import-job detail responses expose only the immutable execution-manifest
  SHA-256 digest. The complete internal manifest remains in the normalized
  provenance record and is not returned through customer task-detail APIs.

### 2026-08-10: LEGATO execution identity made source-owned

- Added `LegatoExecutionManifest v1` with the supported engine commit, LEGATO
  model and processor snapshots, and required Llama Vision encoder snapshot.
  ImportJob execution manifests, OMR factory defaults, LEGATO model/processor
  defaults, model-cache checks, and asset preparation now consume this single
  source-owned identity.
- Removed runtime environment ownership of `OMR_ENGINE`, `LEGATO_REPO_COMMIT`,
  model/processor identifiers, and the Hugging Face repository list. Paths,
  offline mode, device, precision, batching, and timeouts remain deployment
  configuration.
- Worker dependency-image builds now derive the LEGATO repository URL and pinned
  commit from that manifest. Compose no longer accepts duplicate LEGATO build
  arguments; do not reintroduce build-time or runtime fallbacks.

### 2026-08-10: Verovio SVG output profile made source-owned

- Added `VerovioRenderProfile v1`, an immutable typed owner for every option
  that changes generated SVG semantics and for the preview header postprocessor.
  The renderer now consumes that profile directly.
- Removed `SCORE_RENDER_ENGINE` and all `VEROVIO_*` environment variables from
  Worker settings, local templates, and staging/production deployment manifests.
  Removed stale LEGATO identity variables from those deployment manifests too.
- The persisted `render_profile` string remains an artifact-variant selector
  (for example, `default` or `review-thumbnail`); it is not a substitute for
  the algorithm profile.

### 2026-08-10: Rendered-asset provenance linked to execution manifests

- `ScoreRenderAsset` now references the same normalized, immutable
  `execution_manifests` registry used by ImportJob. The render manifest contains
  the Verovio engine and complete `VerovioRenderProfile v1`; rendered SVG pages
  store only its foreign key, never a duplicated JSON snapshot.
- Moved canonical JSON SHA-256 and sync/async get-or-create behavior into one
  shared database helper. Import and rendering therefore use identical hashing,
  de-duplication, and transaction-ownership rules.
- Added migration `0039_score_render_asset_execution_manifest`. Existing assets
  intentionally remain nullable/unknown because their historical rendering
  profile cannot be inferred safely after the fact.

### 2026-08-10: Playback output profile and provenance linked

- Added immutable `PlaybackProfile v1` for the Verovio-to-FluidSynth output
  semantics. Sample rate and maximum generated duration now change only through
  source review and release, not environment promotion.
- Kept `PLAYBACK_SOUNDFONT_PATH` as deployment configuration because it selects
  a mounted runtime resource. The synthesizer now calculates the actual
  SoundFont SHA-256 used for each WAV and includes it in the playback execution
  manifest; a path alone is not treated as provenance.
- `ScorePlaybackAsset` now references the normalized execution-manifest registry
  through migration `0040_score_playback_asset_execution_manifest`. Historical
  rows remain nullable/unknown rather than receiving invented provenance.

### 2026-08-10: Playback processing separated from playback delivery

- Moved the pure Verovio MIDI compiler, FluidSynth synthesizer, renderer, and
  immutable playback profile into `app.processing.engines.playback`.
- Kept `app.modules.playback` for playback asset persistence, outbox lifecycle,
  authorization-aware delivery, HTTP routes, and execution-manifest binding.
  No deprecated module imports or compatibility re-exports remain.
- Do not name the future realtime-practice engine directory `practice_audio`:
  Matchmaker also owns score-following and alignment state. Use
  `practice_alignment` as the domain boundary, with audio activity detection as
  one supporting capability.

### 2026-08-10: Processing engines grouped by bounded domain

- Moved Matchmaker, its audio-activity components, and the versioned profile to
  `app.processing.engines.practice_alignment`. This names the full score-
  following and realtime-alignment responsibility rather than only one input.
- Moved PaddleOCR's subprocess launcher and worker module to
  `app.processing.engines.ocr`; the launcher now starts the new module path.
  Updated application consumers, scripts, tests, fixtures, and plans directly;
  no old-path import compatibility layer remains.

### 2026-08-10: SoundFont adapter separated from processing engines

- Moved SoundFont fingerprinting and Partitura runtime preparation to
  `app.processing.resources.soundfont`. The code manages an external runtime
  resource and package layout; it is not an OCR, rendering, playback, or
  alignment algorithm.
- Playback, practice alignment, and runtime checks now consume this one resource
  adapter through `app.processing.resources`, with no legacy engine-path export.

### 2026-08-10: Score-access boundary made mechanically visible

- Removed the synchronous, user-authorized render entry point. It duplicated
  owner/editor authorization with direct `ScoreMembership` queries instead of
  using the central asynchronous `ScoreAccessPolicy`; no HTTP or service caller
  may use it.
- Added an explicit architecture test listing every current score-facing service
  that accepts caller identity and operates on an existing score or revision.
  Each must import `ScoreAccessPolicy`; adding a new protected entry point now
  requires an intentional update to the boundary test rather than silently
  recreating authorization logic.
- This is deliberately not a blanket ban on score-related table reads. Storage
  accounting, notification recipient selection, repositories, and membership
  lifecycle code legitimately read those tables without making authorization
  decisions.

ARC-016 is partially complete. The policy dependency boundary is now checked
in CI; future work should add a narrowly justified static prohibition only when
a concrete bypass pattern appears, rather than making normal domain queries
impossible.

### 2026-08-11: Worker render boundary corrected after static verification

- The original removal incorrectly classified the Celery render-outbox task as
  having no caller. It did still invoke the deleted method, which mypy exposed
  before release.
- Replaced that stale call with `RevisionRenderService.render_for_worker`, an
  explicitly named sync-worker operation. It is not a user-facing compatibility
  method: outbox delivery is the trusted system boundary, while the operation
  verifies the active score/revision, canonical MusicXML source, and immutable
  source fingerprint before publishing replacement render assets.
- Customer/API rendering remains asynchronous and authorizes through
  `ScoreAccessPolicy`; the worker path does not recreate owner/editor checks.

### 2026-08-10: Practice WebSocket protocol v1 baseline

- Added a strict, versioned Pydantic contract for browser JSON control frames
  and server events. Every JSON frame now carries `protocol_version: 1`; the
  server rejects unversioned or malformed control frames without accepting a
  legacy fallback.
- Added a matching strict Zod validator at the Customer Web socket boundary, so
  malformed server data cannot enter practice page state through a type cast.
- Added backend and frontend protocol tests and documented the change policy:
  additive changes within a version; a new version for breaking changes; update
  both runtimes in the same change.

### 2026-08-10: Practice WebSocket contract artifact and CI freshness gate

- Added a deterministic JSON Schema exporter for the source-owned Pydantic
  protocol and committed `realtime/practice-websocket-v1.json` as the
  reviewable cross-runtime artifact.
- Added `--check` verification to Backend Quality and made Customer Web Quality
  run whenever the realtime contract artifact changes. The latter continues to
  exercise the strict Zod mirror through its normal test suite.
- The artifact declares the protocol's additive-only within-version policy and
  prohibition on legacy fallback; binary PCM remains explicitly outside the
  JSON Schema because its format is negotiated by the Practice REST session.

ARC-015 is complete. SSE has no current customer-facing protocol; if introduced,
it must use the same source-owned, generated-artifact, runtime-validation, and
compatibility-governance model.

### 2026-08-10: Real Practice WebSocket handshake integration

- Extended the disposable integration Compose stack with the real Practice
  runtime, a read-only SoundFont mount required by its startup contract, and a
  deterministic MusicXML score fixture shared through isolated local storage.
- Added a browser-facing Playwright scenario that authenticates through the
  Customer Web proxy, creates a real Practice session, upgrades through the
  same-origin WebSocket proxy, and receives the versioned `session.connecting`
  handshake event.
- Kept PCM processing and the full control-frame state machine out of this
  browser integration baseline: they remain deterministic backend WebSocket
  tests and must not make the proxy/authentication smoke test depend on a live
  score-following result.
- Fixed fresh PostgreSQL migration failure by shortening the development-stage
  revision identifiers for migrations 0038-0040 to fit Alembic's default
  32-character version table column. Their filenames and migration operations
  remain unchanged.

ARC-006 is complete. The isolated real-service suite now covers proxy auth,
CSRF, import submission, and Practice WebSocket authentication/handshake.

### 2026-08-11: Practice session-service coverage gate enforced in CI

- Revalidated the focused Practice service suite in the Practice dependency
  image: 77 tests pass and `app.modules.practice.service` has 85.37% coverage,
  above the 80% required threshold. The suite includes missing-session and
  foreign-user denial cases, and verifies that a cached runtime is never read
  before session ownership is authorized.
- Added the same thresholded command to Backend Quality CI. A local-only
  wrapper is therefore no longer the sole enforcement point.
- Corrected the remaining outdated `session.armed` regression assertion to
  require `protocol_version: 1`, matching the source-owned realtime protocol
  contract. This is a test correction, not a legacy compatibility exception.

ARC-005 is complete. Future quality work should add a focused threshold only
when a new critical boundary has a representative, intentionally scoped suite;
do not use an arbitrary repository-wide fail-under value.

### 2026-08-11: Practice alignment contracts separated from Matchmaker

- Moved the shared `AlignmentUpdate` and `AlignmentEngine` contracts from the
  1170-line Matchmaker implementation into the lightweight
  `practice_alignment.contracts` module.
- Practice service, runtime state, and WebSocket message encoding now depend on
  that contract directly rather than importing the heavy engine merely for type
  annotations. No compatibility re-export remains at the old implementation
  path.
- This was the first measured ARC-003 extraction. The independent browser PCM
  activity adapter was the next candidate and has now been moved without
  changing follower behavior.

### 2026-08-11: Browser PCM adapter separated from Matchmaker

- Moved `BrowserAudioStreamAdapter` into
  `practice_alignment.browser_audio_stream`. It now owns browser PCM framing,
  feature-queue admission, audio gates, adaptive noise calibration, activity
  state, and audio diagnostics.
- `MatchmakerLiveEngine` imports the adapter directly and retains Matchmaker
  initialization, follower-thread orchestration, score-reference mapping, and
  alignment update construction. Practice replay tests import the adapter from
  its owning module; no old-path re-export or compatibility alias remains.
- The next measured ARC-003 candidate is the pure alignment confidence and
  continuity calculation currently embedded in `MatchmakerLiveEngine`. Extract
  only stateless calculations first; retain engine-owned session state and
  logging in the engine.

### 2026-08-11: ARC-003 Practice alignment split stopping point

- Reassessed the remaining small helpers in `MatchmakerLiveEngine`. PCM decode
  is a trivial runtime adapter and is deliberately kept adjacent to byte-stream
  ingestion; reference-frame-to-beat mapping depends on the engine's score,
  tempo, frame rate, and beat-map state.
- Neither is a stable standalone ownership boundary. Further extraction would
  increase indirection and test coupling without reducing a material change
  hotspot. ARC-003 is complete for Practice alignment; revisit only when a new
  independently owned input format or reference-timeline implementation is
  introduced.

### 2026-08-11: Ops async-operation service boundaries split

- Separated operator audit-event persistence into `ops.audit_service`, async
  operation filter construction into `ops.operation_filters`, and record-to-API
  projection/status normalization into `ops.operation_projection`.
- Split the former broad async-operation service into an explicit read-model
  service (`ops.query_service`) and a retry command service
  (`ops.command_service`). The control-plane router now injects the query
  service for list/summary endpoints and the command service for retry.
- Removed the old generic service name and did not retain compatibility
  aliases. Focused validation passed for Ops lint, typing, and the existing
  async-operation test suite.
- Added an enum-coverage contract for Ops query and retry support. A new
  `AsyncOperationKind` must now update the query kind order and retryable kind
  list, or the focused Ops test suite fails.

ARC-004 is partially complete. The next measured candidate is a smaller
source-specific strategy boundary inside Ops query/retry handling only if the
per-source branches continue to grow or duplicate behavior across additional
operation kinds. Do not split each current operation kind into separate files
merely to eliminate small dispatch branches.

## Reusable completion checklist for every refactor

- [ ] Ownership and public API are documented.
- [ ] No circular or forbidden dependency is introduced.
- [ ] Unit tests cover the extracted behavior; critical flows have integration coverage.
- [ ] API/schema changes regenerate and validate client contracts.
- [ ] Relevant lint, type, test, build, container, and manifest checks pass.
- [ ] Documentation indexes and relative links remain valid.
- [ ] Migration/rollback is reversible or explicitly approved.
