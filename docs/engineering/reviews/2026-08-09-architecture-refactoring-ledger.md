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
| ARC-003 | Partially complete | Backend realtime alignment is no longer the largest hotspot; next measured candidates are Customer Web `event-inspector.tsx`, `editor-preview-panel.tsx`, and `musicxml/parser.ts`. |
| ARC-004 | Partially complete | Backend service hotspots have named collaborators and stop points; continue only for measured backend services with a clear business boundary and direct tests. |
| ARC-005 | Complete | Critical score access, import execution/job lifecycle, import worker, and Practice session service have focused coverage gates; score-access architecture boundaries are also checked. |
| ARC-006 | Complete | Keep the isolated integration environment covering auth/CSRF, import submission, and authenticated Practice WebSocket handshake. |
| ARC-007 | Complete | Generated OpenAPI documents are the cross-stack trigger; backend contract freshness checks prevent an unsynchronised source change from passing. Reassess only if a new contract surface is not represented by a generated artifact. |
| ARC-008 | Complete | Keep Action SHAs immutable and let Dependabot propose reviewed updates. |
| ARC-009 | Complete | Keep the Markdown-link validator required for documentation changes. |
| ARC-010 | Complete | Keep local script indexes aligned with supported commands. |
| ARC-011 | Complete | No further work unless a new production prototype boundary appears. |
| ARC-012 | Partially complete | Continue extracting only duplicated bootstrap or settings ownership with a verified runtime boundary. |
| ARC-013 | Partially complete | Code-side ownership and Dependabot policy are complete; verify GitHub-side alerts, secret scanning, branch protection, and required reviews outside this repository. |
| ARC-014 | Complete | Maintain deployment source/GitOps/observability documentation as deployment topology changes. |
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
| REC-006 | P2 | Remove Chinese code comments, emoji-style symbols, and mojibake/unreadable glyphs from production code. | Separate user-facing localized strings from source comments/constants; inventory where Chinese text is actual product copy such as email templates or locale files. | Production source comments are English or removed; decorative symbols are either ASCII labels or explicit design assets; no `?` placeholders or mojibake glyphs remain in hand-maintained code. |
| REC-007 | P1 | Move the Customer Web score editor away from `blank = MusicXML <forward>` as a domain entity. | Use the current code inventory and the dedicated plan in `docs/engineering/plans/editor-domain-model-refactoring-plan.md` to confirm the migration scope before deleting types. | `Blank` is removed from the editor domain model; MusicXML `<forward>`/`<backup>` are adapter cursor operations; empty-space editing is represented by caret/gap selections; note/chord share one pitched-event model; no compatibility aliases or legacy dual model remain. |

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

### 2026-08-11: Deployment configuration templates aligned with source-owned profiles

- Removed stale `API_V1_STR` values from staging/production application
  ConfigMaps and the promoted staging GitOps snapshot. Customer API path
  versioning is source-owned by `CUSTOMER_API_PREFIX`; deployment topology must
  use gateway/root-path configuration instead of mutating the API prefix.
- Removed Practice audio tuning fields from staging/production application
  ConfigMaps and the promoted staging GitOps snapshot. The realtime alignment
  tuning profile is source-owned by `PracticeAudioProfile`; only diagnostics
  toggles and intervals remain deployment configuration.
- Removed obsolete `HF_MODEL_REPOSITORIES` injection from Backend Quality and
  removed manual LEGATO URL/commit inputs from the worker-image workflow. The
  worker dependency image now derives LEGATO identity from
  `legato_manifest.py`, and that manifest participates in the dependency image
  fingerprint.

Kubernetes application rendering, GitOps rendering, and Markdown-link checks
passed after the cleanup. Future profile or manifest migrations must update
local Docker templates, deployment ConfigMaps, release package inputs, and
GitOps snapshots in the same change.

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

### 2026-08-11: Kubernetes runtime ConfigMaps split by ownership

- Split Kubernetes deployment configuration into a shared backend ConfigMap
  plus role-specific Worker and Practice ConfigMaps. API, Beat, migration, and
  observability exporter continue to consume only the shared backend baseline;
  Worker consumes shared + Worker config; Practice consumes shared + Practice
  config; Control Plane consumes shared + Control Plane config.
- Moved model cache paths, PaddleOCR/LEGATO runtime locations, Hugging Face
  offline runtime flags, PaddleOCR timeout, and Worker concurrency out of the
  broad `backend-config.env` files into `backend-worker-config.env`.
- Moved Practice soundfont path and Practice diagnostics toggles out of the
  broad `backend-config.env` files into `backend-practice-config.env`.
- Kept the model-cache agent's online Hugging Face overrides inline because
  cache warming/download has different runtime semantics from normal offline
  Worker execution.
- Updated the release-package promotion allowlist so the new role-specific
  env files can be promoted into GitOps desired state. This prevents GitOps
  from silently retaining the old broad ConfigMap shape after application
  overlays are cleaned up.
- Added a repository guard that fails CI if clear Worker/model-asset or
  Practice realtime keys drift back into the broad `backend-config.env` files,
  or if the role-specific env files stop being referenced by the deployment
  overlays.
- Corrected the settings ownership follow-through: playback soundfont path is
  no longer part of global `Settings`; it belongs to `WorkerRuntimeSettings`
  and is read only by Worker playback/model-asset paths. This prevents API,
  Beat, and Control Plane processes from requiring Worker model-asset config
  after the Kubernetes ConfigMap split.
- Tightened the soundfont ownership boundary: Worker/model-asset config owns
  `PLAYBACK_SOUNDFONT_PATH`; Practice config owns `PRACTICE_SOUNDFONT_PATH`.
  The model-asset preparation check now validates the Worker playback renderer
  rather than requiring Practice runtime settings in Worker configuration.
- Renamed the misleading Worker database settings/session modules to sync
  database settings/session modules. `SYNC_DATABASE_URL` remains in the shared
  backend config because both API import-job paths and Worker tasks use the
  synchronous SQLAlchemy session.
- Clarified model-cache ownership for soundfonts: Worker runtime uses
  `PLAYBACK_SOUNDFONT_PATH`, Practice runtime uses `PRACTICE_SOUNDFONT_PATH`,
  and the model-cache agent now consumes both role-specific ConfigMaps to
  prepare and validate both soundfont targets without leaking Practice settings
  into Worker pods.
- Extracted the Celery Beat schedule map from the broader Celery app
  configuration. The schedule intervals remain in shared runtime settings
  because their retry/timeout/max-attempt companions are read by API/Ops
  projections and Worker dispatch services; Beat owns only the recurring task
  trigger mapping.
- Extracted Celery runtime options from the Celery app assembly module. The
  app module now creates the Celery instance, computes the Beat state file, and
  registers framework signals; the runtime-options module owns serialization,
  broker/backend timeout policy, task acknowledgement behavior, worker
  lifecycle limits, task deadlines, and Beat schedule wiring.
- Extracted shared Celery task runtime helpers from the broad task-entrypoint
  module. Task context binding, operation logger binding, attempt tracing, and
  scheduler lock/observability wrapping now live in `app.worker.task_runtime`;
  `app.worker.tasks` remains the Celery task registration surface.
- Extracted the transactional-mail outbox execution body from
  `app.worker.tasks` into `app.worker.execution.mail_outbox`. The Celery task
  name and registration path remain unchanged, while claim/send/failure/sent
  handling now has an owning execution module.
- Extracted playback outbox execution from `app.worker.tasks` into
  `app.worker.execution.playback_outbox`. The task entrypoint remains registered
  at the old Celery task name, while render/fail/complete and derived-asset
  realtime event publication are owned by the playback execution module.
- Extracted render outbox execution from `app.worker.tasks` into
  `app.worker.execution.render_outbox`. The task entrypoint remains registered
  at the old Celery task name, while score-revision preview rendering,
  review-thumbnail rendering, outbox fail/complete transitions, and preview
  realtime event publication are owned by the render execution module.
- Extracted import-job execution from `app.worker.tasks` into
  `app.worker.execution.import_job`. The task entrypoint remains registered at
  the existing Celery task name, while dispatch claim, pipeline execution,
  import attempt tracing, completion acknowledgement, and import status logging
  are owned by the import execution module.
- Extracted periodic maintenance scan execution from `app.worker.tasks` into
  `app.worker.execution.maintenance`. Celery task names remain unchanged, while
  job cleanup, dispatch recovery, notification/realtime cleanup, derived-asset
  retention, score deletion cleanup, and outbox maintenance callbacks now live
  in the maintenance execution module.
- Updated scheduler-lock tests to target `app.worker.task_runtime`
  directly. This removes the stale assumption that scheduler scan internals are
  owned by the Celery task registration module.
- Added `backend/app/worker/README.md` to document the Worker package ownership
  boundaries after the task/execution/dispatch/runtime split. Removed stale
  Celery task-route comments that referenced deleted historical task names.
- Added a Worker architecture contract test that keeps `app.worker.tasks` as a
  Celery registration surface, blocks direct domain/database service imports in
  the task-entrypoint module, and prevents `app.worker.execution` modules from
  importing task entrypoints.
- Split the broad maintenance execution module into
  `app.worker.execution.maintenance_dispatch` and
  `app.worker.execution.maintenance_cleanup`. Dispatch maintenance now owns
  recovery-and-publish scans for import/render/playback/mail durable work, while
  cleanup maintenance owns deletion, expiry, retention, and lifecycle cleanup
  scans.
- Extracted shared durable-dispatch producer behavior into
  `app.worker.dispatch.runtime`. Import/render/playback/mail dispatch modules
  now keep flow-specific mark/trace/release details and delegate Celery
  `send_task`, producer span creation, success/failure logging, and
  release-on-failure handling to the dispatch runtime helper.
- Extended the Worker architecture contract test so concrete dispatch modules
  cannot bypass `app.worker.dispatch.runtime` with direct Celery `send_task` or
  producer-tracing imports.
- Kept the public durable trace-context lookup functions explicit by operation
  kind, but extracted their shared SQL lookup/fallback behavior into a small
  private helper in `app.worker.dispatch.tracing`. This removes duplicate row
  handling without replacing readable operation-specific function names with a
  generic call-site API.
- Added `app.modules.async_operations.delivery_policy` for small pure timing
  helpers shared by render, playback, and mail durable deliveries. The refactor
  centralizes exponential retry-delay and lease-expiry calculations without
  introducing a generic ORM outbox base class, preserving each service's
  domain-specific state transitions and diagnostics.
- Kept `RevisionRenderService`'s async API render path and sync Worker render
  path separate because their database APIs and callers differ, but extracted
  small private helpers for render-asset usage snapshots and best-effort storage
  cleanup. This reduces local duplication without creating a broad async/sync
  abstraction layer.
- Kept `PlaybackService`'s async API render path and sync Worker render path
  separate for the same reason, while extracting small private helpers for
  playback storage-key construction, previous asset usage snapshots, and
  best-effort storage cleanup. The asset-writing transaction flow remains
  explicit in each path.
- Split render/playback outbox payload construction into narrow private
  operation-specific helpers. `claim()` now stays focused on claim eligibility
  and processing-state transition, while revision preview, review thumbnail,
  audio payload construction, and resource-exhaustion diagnostics remain
  explicit without introducing a generic outbox base class.

### 2026-08-11: Deployment source hierarchy documented

- Added a deployment index at `deploy/README.md` that defines the ownership
  boundary between reusable application templates, GitOps desired-state
  snapshots, platform prerequisites, and observability values.
- Clarified that `deploy/application` is source template material while
  `deploy/gitops/environments/*` is promoted, digest-pinned desired state.
- Replaced stale or plain-text deployment documentation paths with checked
  relative Markdown links in application, production overlay, observability,
  and GitOps indexes.

ARC-014 is complete. Future deployment topology changes must update the
deployment index and the nearest owning README in the same change.

### 2026-08-11: Process endpoint bootstrap extracted

- Extracted the repeated health and metrics route installation from the API,
  Practice, Control Plane, and Observability composition roots into
  `backend/app/api/runtime_endpoints.py`.
- Kept service-specific FastAPI metadata, business routers, CSRF policy, CORS
  origins, static mounts, and lifespan roles explicit in each composition root.
  This avoids over-abstracting the runtime boundary while giving the shared
  process endpoints one owner.
- Observability remains the only runtime that enables database-backed metrics
  and disables Redis/storage-quota readiness checks; customer-facing runtimes
  continue exposing process-only metrics.

ARC-012 remains partially complete. Continue extracting only duplicated
bootstrap responsibilities with a stable owner and an observable behavior test.

### 2026-08-11: Role runtime settings projections moved out of config

- Moved the strict Worker runtime projection from `backend/app/core/config.py`
  to `backend/app/core/settings/worker_runtime.py`.
- Moved the strict Practice runtime projection from `backend/app/core/config.py`
  to `backend/app/core/settings/practice_runtime.py`.
- Updated production code, operational scripts, and tests to import the new
  owner modules directly. No compatibility re-export remains in `config.py`.
- Kept the global `Settings` composition in `config.py`; this change only
  removes role-specific runtime projection logic from the shared settings
  composition entry point.
- Updated Practice regression tests to provide the required
  `PRACTICE_SOUNDFONT_PATH` explicitly and clear the runtime settings cache,
  preserving the strict no-fallback startup contract.

ARC-012 remains partially complete. The next settings step should inspect
whether `config.py` still imports setting groups that are no longer part of the
shared API/process contract before extracting more behavior.

### 2026-08-11: Task reliability ownership moved out of shared settings

- Removed `TaskReliabilitySettings` from the global `Settings` composition
  because `MAX_PROCESSING_TIME`, `CELERY_TASK_SOFT_TIME_LIMIT`, and
  `CELERY_TASK_TIME_LIMIT` describe the Worker/Celery task shutdown envelope,
  not a shared API/process contract.
- Added `get_task_reliability_settings()` in
  `backend/app/core/settings/task_reliability.py` so Worker, Beat, pipeline
  context, Celery runtime options, and runtime checks can load only the task
  deadline projection without requiring Worker model/engine settings.
- Kept `WorkerRuntimeSettings` as the stricter Worker-owned aggregate that
  validates PaddleOCR timeout against the task processing deadline.
- Moved the task reliability environment variables from the shared Docker env
  template to the Worker-specific Docker env template, and made the same change
  in the local Docker env files.

ARC-012 remains partially complete, but the remaining `config.py` groups now
need another measured consumer map before more migration; do not move settings
just because their names sound feature-specific.

### 2026-08-11: Remaining shared settings consumer map reviewed

- Re-ran a field-level consumer map for every settings group still composed by
  the global `Settings` object. The review covered production code and backend
  operational scripts, excluding tests as ownership evidence.
- No additional settings group was selected for migration in this pass.
- Keep the following groups in shared settings for now because they are used by
  more than one runtime or by shared infrastructure:
  `AsyncDatabaseSettings`, `BrowserCorsSettings`,
  `CustomerSessionSecuritySettings`, `ImportDispatchSettings`,
  `MailDeliverySettings`, `NotificationLifecycleSettings`,
  `ObservabilitySettings`, `PlaybackDeliverySettings`,
  `PublicFrontendUrlSettings`, `QueueSettings`, `RealtimeRetentionSettings`,
  `RealtimeStreamSettings`, `RenderAssetDeliverySettings`,
  `ScoreDeletionLifecycleSettings`, `ServiceIdentitySettings`,
  `StorageSettings`, `SyncDatabaseSettings`, `TokenSigningSettings`,
  `TransactionalMailProviderSettings`, and `TrustedProxySettings`.
- `BeatSchedulerSettings` remains shared because Beat owns the lock, while
  observability reads the leader-heartbeat interval to project durable scheduler
  health. Splitting it would require a dedicated scheduler-runtime projection
  and an observability contract, not a mechanical move.
- `FingeringExecutionSettings` is not moved yet. It looks feature-specific, but
  its fields span API admission (`FINGERING_MAX_CONTENT_BYTES`) and execution
  controls (`FINGERING_MAX_CONCURRENCY`, `FINGERING_QUEUE_WAIT_SECONDS`). Move
  it only after the fingering API/execution boundary is reviewed as one unit.
- `UploadAdmissionSettings` and `AccountEmailLinkSettings` remain in shared
  settings because they are customer API domain policy, not process runtime
  configuration.

ARC-012 should pause after this point unless a concrete single-runtime settings
owner emerges. The next architecture work should return to measured service or
engine hotspots rather than continuing configuration movement for its own sake.

### 2026-08-11: Storage usage accounting rules extracted

- Selected `backend/app/modules/storage_usage/service.py` as a measured ARC-004
  hotspot because it owns both async API reservations and sync Worker
  accounting while duplicating quota classification, quota validation,
  reservation construction, and usage-event construction.
- Extracted pure storage accounting rules to
  `backend/app/modules/storage_usage/accounting.py`: default plan code, quota
  categories, quota inclusion, quota availability validation, reservation
  construction, and usage-event construction.
- Updated runtime checks to import the default storage plan from the accounting
  owner instead of the service facade.
- Kept `StorageUsageService` as the public orchestration facade used by API,
  Worker, import, revision, playback, review, and score lifecycle modules. No
  old-path compatibility export or fallback behavior was added.

ARC-004 remains partially complete. The next safe storage-usage step, if any,
is to look for a stable transaction-script boundary across reserve/commit/release
before splitting async and sync orchestration; do not create separate files only
because both execution modes exist.

### 2026-08-11: Storage usage state transitions centralized

- Continued the measured storage-usage extraction by moving account, counter,
  and reservation state transitions into
  `backend/app/modules/storage_usage/accounting.py`.
- Added helpers for reservation holds, committing reserved usage, releasing
  reserved usage, and releasing used usage. These helpers operate on already
  loaded ORM objects only; they do not own database reads, row locks, commits,
  or async/sync execution mode.
- Kept `StorageUsageService` responsible for transaction scripts, repository
  calls, lock selection, commits, and the public async/sync facade. This avoids
  the premature split into separate async and sync services while removing the
  duplicated mutation logic.

ARC-004 remains partially complete. Stop the storage-usage split here unless a
future change introduces new reservation states, additional quota plans, or a
third execution path that makes the transaction scripts themselves a measured
hotspot.

### 2026-08-11: Review confirmation asset promotion extracted

- Selected `backend/app/modules/review/service.py` as the next measured ARC-004
  hotspot after stopping the storage-usage split.
- Extracted review-confirmation asset promotion to
  `backend/app/modules/review/confirmation_assets.py`: copying the review
  thumbnail into the confirmed score revision, promoting original uploads to
  score input assets, and returning the promoted usage records needed by the
  existing storage accounting flow.
- Kept `ReviewService.confirm()` as the transaction owner for job locking,
  score/revision/source creation, taxonomy/library updates, notification
  attachment, storage quota reservation, and cleanup. The extraction does not
  split the review transaction or introduce compatibility exports.
- While validating the related review tests, found an existing
  `RenderOutboxService` status overwrite: stale review-thumbnail outboxes are
  completed by the review-thumbnail payload builder and then overwritten as
  failed by the generic unavailable-resource handler. Fix this as a separate
  change, not as part of the review asset extraction.

ARC-004 remains partially complete. Continue only with small, behavior-covered
extractions or concrete regression fixes uncovered by those checks.

### 2026-08-11: Review-thumbnail stale outbox completion preserved

- Fixed a regression uncovered while validating the review-confirmation
  extraction: stale review-thumbnail render outboxes were marked completed by
  the review-thumbnail payload builder, then overwritten as failed by the
  generic unavailable-resource exhaustion handler.
- `RenderOutboxService._build_payload()` now preserves a target-specific
  `COMPLETED` decision and only exhausts unavailable resources when no payload
  was built and the outbox was not completed by the target-specific builder.
- This is a behavior fix, not a broader render-outbox refactor.

ARC-004 remains partially complete. Treat target-specific terminal decisions in
outbox builders as intentional domain policy before applying generic fallback
handling.

### 2026-08-11: Library folder-tree rules extracted

- Selected `backend/app/modules/library/service.py` as the next ARC-004
  hotspot because its folder operations mixed API orchestration with pure
  folder-tree calculations: parent UUID projection, recursive entry counts,
  descendant collection, folder depth, and subtree height.
- Extracted those pure rules to
  `backend/app/modules/library/folder_tree.py`.
- Kept `LibraryService` responsible for database access, authorization-facing
  behavior, folder mutation transactions, entry updates, commits, and domain
  exceptions. The extraction does not introduce compatibility aliases or a
  generic tree utility layer.
- Added focused tests in `backend/tests/test_library_folder_tree.py` for
  recursive folder counts, parent UUID projection, descendant lookup, depth,
  and subtree height.

ARC-004 remains partially complete. Stop the library split here unless future
changes add additional folder invariants or library read-model variants; the
remaining service methods are still readable transaction/application
orchestration rather than an obvious separate subsystem.

### 2026-08-11: Score invite domain rules extracted

- Selected `backend/app/modules/score_invites/service.py` as the next measured
  ARC-004 hotspot because it mixed invite/member transaction orchestration with
  pure invite rules.
- Extracted invite token hashing/generation, role ranking, display status,
  acceptability checks, and locale-specific role labels to
  `backend/app/modules/score_invites/rules.py`.
- Updated existing tests to import `hash_invite_token` from the new rule owner;
  no compatibility re-export remains in `service.py`.
- Added focused rule tests in `backend/tests/test_score_invite_rules.py`.
- Kept `ScoreInviteService` responsible for authorization, invite and member
  writes, notification creation, mail outbox queueing, commits, refreshes, and
  domain exceptions.

ARC-004 remains partially complete. Do not split `ScoreInviteService` further
until membership lifecycle, invite delivery, or notification behavior grows
enough to justify a separately testable owner; the current service complexity
is mostly application orchestration.

### 2026-08-11: Score deletion cleanup records named

- Reviewed `backend/app/modules/scores/lifecycle_service.py` as the next
  ARC-004 hotspot.
- Did not split the core score-deletion transaction. The service still needs to
  coordinate score rows, revisions, sources, derived assets, input uploads,
  optional originating import jobs, practice sessions, storage-usage releases,
  and best-effort object deletion in a single carefully ordered cleanup flow.
- Replaced raw storage-release tuples with
  `backend/app/modules/scores/cleanup_records.py::StorageUsageReleaseRecord`
  so category, bytes, object identity, storage key, and delete-storage intent
  are named explicitly.
- Removed the unused `user_id` parameter from the originating import-job cleanup
  helper instead of preserving dead signature surface.

ARC-004 remains partially complete. Stop this lifecycle split here unless a
future change introduces a separately testable cleanup owner, such as a full
import-job deletion policy or a dedicated object-storage retry queue; do not
extract the main transaction merely to reduce file length.

### 2026-08-11: Revision read model extracted

- Selected `backend/app/modules/revisions/service.py` as the next ARC-004
  hotspot because it mixed revision transaction workflows with read-model
  projection for revision actors, restore metadata, and revision notes.
- Extracted read projection to
  `backend/app/modules/revisions/read_model.py::RevisionReadModel`.
- Kept `RevisionService` responsible for authorization, create/restore
  transactions, MusicXML validation, source storage, storage quota reservation
  lifecycle, derivative enqueueing, notifications, realtime publication,
  retention cleanup, note writes, and content retrieval.
- Added focused coverage for the read model in
  `backend/tests/test_score_revision_services.py`.

ARC-004 remains partially complete. Do not split `create()` or `restore()` until
the duplicated source-write/quota workflow can be extracted without weakening
the current rollback and storage-reservation semantics.

### 2026-08-11: Review detail read model extracted

- Revisited `backend/app/modules/review/service.py` after the previous review
  confirmation asset extraction.
- Extracted the review detail query/projection path to
  `backend/app/modules/review/read_model.py::ReviewReadModel`: job ownership
  checks, pending-review validation, confirmed-job projection, review MusicXML
  artifact loading, and original upload projection.
- Kept `ReviewService` responsible for review confirmation and review update
  transactions, MusicXML validation before writes, storage usage reservation
  and accounting, thumbnail outbox creation, score/revision/source creation,
  library/taxonomy updates, and notification attachment.
- Existing review detail and confirmation regression tests cover the extracted
  behavior through the public service API.

ARC-004 remains partially complete. Do not split `confirm()` further unless a
new, independently testable transaction participant emerges; after this pass,
the remaining review service complexity is mostly write orchestration.

### 2026-08-11: Playback delivery read model extracted

- Selected `backend/app/modules/playback/service.py` as the next ARC-004
  hotspot because delivery lookup and fallback projection were mixed with
  audio rendering and storage-accounting workflows.
- Extracted delivery DTO and read model to
  `backend/app/modules/playback/delivery.py`: authenticated score-revision
  delivery, revision asset lookup, previous-revision fallback lookup, storage
  existence checks, and `PlaybackDelivery` projection.
- Updated tests to import `PlaybackDelivery` from the delivery owner instead of
  the service module. No compatibility re-export was added.
- Kept `PlaybackService` responsible for render/render_sync orchestration,
  MusicXML source lookup, renderer invocation, playback asset writes,
  execution manifest creation, storage usage allocation/release, share/public
  access entrypoints, and storage cleanup.

ARC-004 remains partially complete. Do not merge or extract `render()` and
`render_sync()` mechanically; the async/sync split crosses transaction,
execution-manifest, and storage-usage APIs and needs a dedicated design pass
before any shared writer is introduced.

### 2026-08-11: Render outbox payload builder extracted

- Selected `backend/app/modules/score_assets/render_outbox_service.py` as the
  next ARC-004 hotspot because payload construction for score-revision renders
  and review-thumbnail renders was mixed with the outbox status machine.
- Extracted payload DTOs and target-specific payload construction to
  `backend/app/modules/score_assets/render_payloads.py`.
- Replaced direct status mutation inside review-thumbnail payload construction
  with an explicit `terminal_completed` build result. `RenderOutboxService`
  remains the owner of terminal status transitions through `complete()`.
- Updated Worker render execution to import `RenderOutboxPayload` from the new
  payload owner. No compatibility re-export remains in the outbox service.
- Kept `RenderOutboxService` responsible for claiming, attempt accounting,
  processing/failed/completed/dispatched transitions, stale delivery recovery,
  retry timing, and diagnostic projection.

ARC-004 remains partially complete. Stop this split at the payload boundary
unless a future change adds more target types or a separately testable render
delivery state policy; do not split the status machine itself.

### 2026-08-11: Ops async-operation summary query extracted

- Selected `backend/app/modules/ops/query_service.py` as the next ARC-004
  hotspot because async-operation summary SQL aggregation and response
  projection were mixed with operation list pagination.
- Extracted summary row queries and status aggregation to
  `backend/app/modules/ops/operation_summary.py`.
- Kept `OpsAsyncOperationQueryService` responsible for public list/summary
  entrypoints, filter construction, operation-kind selection, offset pagination,
  and per-kind operation listing.
- Kept retry/admin write workflows in `backend/app/modules/ops/command_service.py`
  untouched.

ARC-004 remains partially complete. Do not split ops command/retry behavior as
part of query refactoring; only revisit query-side extraction if new operation
kinds add enough duplicated list-row queries or summary predicates.

### 2026-08-11: Practice session read model extracted

- Selected `backend/app/modules/practice/service.py` as the next ARC-004
  hotspot, but limited the cut to response/read-model construction because the
  lifecycle and runtime-registration flows are still readable as one
  orchestration boundary.
- Extracted API-facing session summary/detail and report payload projection to
  `backend/app/modules/practice/read_model.py`.
- Kept `PracticeService` responsible for session creation, access checks,
  stream lifecycle transitions, runtime registration/release, report generation
  state changes, and alignment persistence.
- Added focused read-model coverage in `backend/tests/test_practice_read_model.py`
  and updated service tests to inject a fake read model instead of patching
  removed private helpers.

ARC-004 remains partially complete. Stop the practice split here unless a future
change makes session lifecycle transitions or runtime registration independently
complex enough to deserve a named collaborator.

### 2026-08-11: Import-job deletion cleanup service extracted

- Selected `backend/app/modules/import_jobs/service.py` as the next ARC-004
  hotspot because import-job deletion and binary-artifact cleanup duplicated
  orphan upload/blob discovery, row deletion, object-storage deletion, and
  storage-usage release behavior.
- Extracted that side-effect policy to
  `backend/app/modules/import_jobs/deletion_service.py`.
- Kept `ImportJobService` responsible for submit/retry/list/detail/batch-status
  public entrypoints, user ownership checks, running-job deletion guards, and
  artifact download authorization.
- Added focused deletion-service orchestration coverage in
  `backend/tests/test_import_job_deletion_service.py` and service delegation
  coverage in `backend/tests/test_import_job_service_access.py`.

ARC-004 remains partially complete. Stop this import-job split here unless retry
request reconstruction, sync detail projection, or artifact download delivery
accumulates new rules that justify separate named collaborators.

### 2026-08-11: Playback asset record construction extracted

- Revisited `backend/app/modules/playback/service.py` after the delivery
  read-model split. The remaining large duplication is between async `render()`
  and sync `render_sync()` asset creation, but those paths intentionally use
  different session APIs and transaction semantics.
- Extracted only pure record semantics to
  `backend/app/modules/playback/asset_records.py`: revision-scoped playback
  storage keys, previous-asset usage snapshots, and `ScorePlaybackAsset`
  construction from renderer/storage metadata.
- Kept `PlaybackService` responsible for authorization-facing delivery methods,
  source validation, renderer invocation, storage writes, manifest persistence,
  async/sync transaction boundaries, usage allocation/release calls, and
  best-effort old-object deletion.
- Added focused coverage in `backend/tests/test_playback_asset_records.py`.

ARC-004 remains partially complete. Do not merge async and sync playback render
transactions mechanically; revisit only if both paths can share a transaction
port without hiding rollback and storage-cleanup behavior.

### 2026-08-11: Score deletion failure policy extracted

- Selected `backend/app/modules/scores/lifecycle_service.py` as the next
  ARC-004 hotspot, but avoided splitting the main `cleanup_deleting_score()`
  transaction because it intentionally coordinates score rows, revision assets,
  input uploads/blobs, originating import jobs, practice sessions, usage
  release, and best-effort object deletion.
- Extracted failed-cleanup retry state and async-operation diagnostics to
  `backend/app/modules/scores/deletion_failure_policy.py`.
- Removed the unused `PracticeCleanupService` dependency from
  `ScoreLifecycleService`; the sync cleanup path owns its current practice-row
  deletion logic directly.
- Removed the unused async `_single_score_originating_job_uuid()` helper instead
  of keeping an uncalled compatibility path.
- Added focused failure-policy coverage in
  `backend/tests/test_score_deletion_failure_policy.py`.

ARC-004 remains partially complete. Do not split `cleanup_deleting_score()`
further until there is a concrete named transaction boundary; candidate future
cuts are usage-release collection or originating-import-job cleanup, but only
with direct integration tests around deletion ordering.

### 2026-08-11: Render asset record construction extracted

- Selected `backend/app/modules/score_assets/render_service.py` after the
  playback asset-record split because render output storage keys, replacement
  usage snapshots, and `ScoreRenderAsset` construction were pure record
  semantics embedded in the render orchestration.
- Extracted those pure helpers to
  `backend/app/modules/score_assets/render_asset_records.py`.
- Kept `RevisionRenderService` responsible for authorization, source lookup,
  renderer invocation, temporary work directories, storage uploads, async/sync
  transaction boundaries, usage allocation/release calls, and best-effort
  cleanup of replaced or rolled-back objects.
- Added focused record-construction coverage in
  `backend/tests/test_render_asset_records.py`.

ARC-004 remains partially complete. Do not extract the renderer invocation or
async/sync transaction flow unless a future change introduces a tested render
execution port; the current orchestration is clearer when the IO and rollback
sequence stays visible.

### 2026-08-11: Hotspot rescan after backend service extractions

- Re-scanned production source line counts after the ARC-004 backend service
  extractions. Generated clients such as
  `apps/customer-web/src/generated/api/types.gen.ts` are excluded from refactor
  targeting because they are contract outputs, not hand-maintained source.
- Current largest hand-maintained Customer Web hotspots:
  `apps/customer-web/src/components/editor/event-inspector.tsx` (~1227 lines),
  `apps/customer-web/src/components/editor/editor-preview-panel.tsx` (~1100
  lines), and `apps/customer-web/src/lib/musicxml/parser.ts` (~900 lines).
- Current largest backend hotspots are no longer generic catch-all services:
  `backend/app/core/runtime_checks.py` (~645 lines),
  `backend/app/observability/async_operation_metrics.py` (~633 lines),
  `backend/app/processing/engines/practice_alignment/matchmaker_live.py` (~554
  lines), and several feature services in the 300-500 line range with recent
  named collaborators and explicit stop points.
- Decision: do not keep cutting backend services solely by line count. The next
  ARC-003 candidate should be a Customer Web editor/musicxml hotspot with a
  stable semantic boundary and focused tests.

Next recommended candidate: `apps/customer-web/src/components/editor/event-inspector.tsx`.
Before modifying it, identify pure display helpers, event-detail projection, or
subsections that can move without changing the editor interaction model.

### 2026-08-11: Event Inspector connection projection extracted

- Started the Customer Web ARC-003 pass with
  `apps/customer-web/src/components/editor/event-inspector.tsx`, the largest
  current hand-maintained source hotspot after excluding generated API clients.
- Extracted pure tie/slur connection detail projection and endpoint pitch
  resolution to
  `apps/customer-web/src/components/editor/event-inspector-connections.ts`.
- Kept `EventInspectorPanel` responsible for React state, editor mutations,
  toast handling, XML updates, and opening connection endpoints for editing.
- Added focused unit coverage in
  `apps/customer-web/tests/unit/event-inspector-connections.test.ts` and kept
  the existing Verovio surface migration test green.

ARC-003 remains partially complete. Continue the Event Inspector split only
around similarly stable boundaries such as score metadata controls or
note-property field groups; do not extract stateful editor mutation callbacks
until a tested hook boundary is obvious.

### 2026-08-11: Score Inspector metadata panel extracted

- Continued the Customer Web ARC-003 pass by extracting the score-level metadata
  inspector from `apps/customer-web/src/components/editor/event-inspector.tsx`.
- Moved `ScoreInspectorPanel`, key-signature, time-signature, tempo picker, and
  staff-preview UI to
  `apps/customer-web/src/components/editor/event-score-inspector.tsx`.
- Kept `EventInspector` responsible for choosing between score-level and
  event-level inspector modes, and kept `EventInspectorPanel` responsible for
  selected-event editing state and XML mutation callbacks.
- Replaced copied mojibake metadata labels in the extracted picker constants
  with explicit readable key labels and musical symbols, so the extracted file
  remains parseable and maintainable.
- Added focused helper coverage in
  `apps/customer-web/tests/unit/event-score-inspector.test.ts` and updated the
  surface-migration test to assert the metadata editor remains in the right
  inspector via the new module.

ARC-003 remains partially complete. The next Event Inspector cut, if any, should
target event note-property field groups or pitch-edit helpers; avoid moving
editor mutation callbacks until a smaller hook boundary is proven by tests.

### 2026-08-11: Event Score Inspector unreadable glyph cleanup

- Confirmed that `apps/customer-web/src/components/editor/event-score-inspector.tsx`
  contained literal `?` placeholder strings in tempo-unit and key-signature
  display constants after the extraction, not merely a font-rendering issue.
- Replaced those constants with ASCII labels (`1/4`, `#`, `bb`, etc.) so the
  file remains readable in terminals, diffs, CI logs, and AI/code-review tools.
- Added REC-006 to track a broader cleanup pass for Chinese code comments,
  emoji-style symbols, and mojibake/unreadable glyphs in hand-maintained
  production code. Product copy and localization files must be inventoried
  separately before removal.

### 2026-08-11: Event Inspector event model helpers extracted

- Continued the Customer Web ARC-003 pass by extracting event-level pure helpers
  from `apps/customer-web/src/components/editor/event-inspector.tsx`.
- Moved pitch parsing, pitch part updates, accidental suffix mapping,
  entity-save conversion, summary labels/icons, and event editing constants to
  `apps/customer-web/src/components/editor/event-inspector-event-model.ts`.
- Replaced unreadable note/rest/chord glyphs in the event inspector summary and
  accidental buttons with ASCII labels, consistent with REC-006.
- Kept `EventInspectorPanel` responsible for React state, editor mutations, XML
  updates, beam/connection operations, and field layout.
- Added focused coverage in
  `apps/customer-web/tests/unit/event-inspector-event-model.test.ts`.

ARC-003 remains partially complete. Stop extracting pure helpers from
`event-inspector.tsx` here; the next cut should either extract a cohesive
note-properties component with manageable props or move to
`editor-preview-panel.tsx`.

### 2026-08-11: Editor Preview track visibility projection extracted

- Continued the Customer Web ARC-003 pass with
  `apps/customer-web/src/components/editor/editor-preview-panel.tsx`.
- Extracted the pure track-visibility projection from score data and visible
  track ids to
  `apps/customer-web/src/components/editor/editor-preview-track-visibility.ts`.
- Moved hidden source id collection, hidden tie/slur endpoint pair projection,
  and fully hidden staff-key detection out of the React component.
- Kept `EditorPreviewPanel` responsible for DOM hit testing, Verovio SVG class
  application, score click/mouse handlers, playback wiring, and editor state.
- Added focused coverage in
  `apps/customer-web/tests/unit/editor-preview-track-visibility.test.ts` and
  updated the Verovio surface migration guard to follow the extracted module.

ARC-003 remains partially complete. The next `editor-preview-panel.tsx` cut
should target a similarly cohesive DOM helper boundary, such as metadata
placeholder mounting or selected-entity SVG highlighting. Avoid extracting the
add-mode click/mouse handlers until insertion placement has stronger focused
coverage.

### 2026-08-11: Editor Preview selected entity highlighting extracted

- Continued the Customer Web ARC-003 pass with another small
  `editor-preview-panel.tsx` DOM boundary.
- Extracted selected Verovio element class/style application to
  `apps/customer-web/src/components/editor/editor-preview-selection-highlight.ts`.
- Kept `EditorPreviewPanel` responsible for deriving the selected source ids,
  resolving the track color, observing Verovio SVG mutations, and invoking the
  highlighter after render changes.
- Added jsdom coverage in
  `apps/customer-web/tests/unit/editor-preview-selection-highlight.test.ts` for
  clearing stale selections, selecting elements by `data-id`/`id`, and applying
  the CSS selection color variable.
- Updated the Verovio surface migration guard to assert the new helper owns the
  DOM class/style mechanics.

ARC-003 remains partially complete. The next safe `editor-preview-panel.tsx`
cut is metadata placeholder mounting. Continue avoiding extraction of add-mode
pointer placement until its DOM geometry behavior has more focused tests.

### 2026-08-11: Editor Preview metadata placeholders extracted

- Continued the Customer Web ARC-003 pass by extracting score metadata
  placeholder mounting from
  `apps/customer-web/src/components/editor/editor-preview-panel.tsx`.
- Moved stale placeholder cleanup, first score-page selection, missing metadata
  projection, and placeholder button creation to
  `apps/customer-web/src/components/editor/editor-preview-metadata-placeholders.ts`.
- Kept `EditorPreviewPanel` responsible for effect timing, loading-state gating,
  translated label resolution, and passing current `ScoreData` into the DOM
  helper.
- Added jsdom coverage in
  `apps/customer-web/tests/unit/editor-preview-metadata-placeholders.test.ts`
  for descriptor projection, stale cleanup, button mounting, all-present
  metadata, and missing page/score-data behavior.
- Updated the Verovio surface migration guard so the placeholder DOM boundary is
  explicit.

ARC-003 remains partially complete. The next `editor-preview-panel.tsx` work
should pause before extracting pointer insertion handlers; first add focused
coverage for insert placement geometry or extract only another self-contained
DOM helper with minimal props.

### 2026-08-11: Score type comments cleaned for REC-006

- Started the REC-006 source-comment cleanup with
  `apps/customer-web/src/types/score-types.ts`, because this shared type file is
  frequently read by editor, MusicXML, and preview code.
- Replaced Chinese/mojibake comments with concise English JSDoc where the
  comment carried useful domain meaning, and removed redundant comments where
  the type/member name was already self-explanatory.
- Kept all exported type names and field shapes unchanged; this was a
  documentation/readability-only change.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs.

REC-006 remains partially complete. Follow-up cleanup should be batched by
module, starting with `apps/customer-web/src/lib/musicxml/` comments, because
that area contains many domain-heavy Chinese comments and should be translated
carefully rather than deleted mechanically.

### 2026-08-11: MusicXML backup comments cleaned for REC-006

- Continued REC-006 with `apps/customer-web/src/lib/musicxml/backup.ts`, the
  smallest MusicXML file with focused existing transformation coverage.
- Replaced mojibake comments with concise English explanations for backup
  normalization, consecutive-backup merging, and duration recalculation.
- Kept the implementation logic unchanged; this was a readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified the existing MusicXML transformation tests still pass.

REC-006 remains partially complete. Continue with small MusicXML batches. Good
next candidates are `connections.ts` or `elements.ts`; defer `parser.ts` until
after smaller files are clean because its comments encode more parsing policy.

### 2026-08-11: MusicXML connection comments cleaned for REC-006

- Continued REC-006 with `apps/customer-web/src/lib/musicxml/connections.ts`.
- Replaced Chinese/mojibake comments with concise English descriptions for tie
  and slur XML mutation helpers.
- Removed one stale orphan comment about note lookup that no longer described
  the following function.
- Kept the implementation logic unchanged; this was a readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified the existing MusicXML core tests still pass.

REC-006 remains partially complete. Continue with `elements.ts` next, then
`core.ts` or `flatten.ts`; keep `parser.ts` for a dedicated pass because its
comments describe parsing policy and timing behavior.

### 2026-08-11: MusicXML element comments cleaned for REC-006

- Continued REC-006 with `apps/customer-web/src/lib/musicxml/elements.ts`.
- Replaced Chinese/mojibake comments with concise English descriptions for note
  element update, creation, and lookup helpers.
- Kept the implementation logic and exported API unchanged; this was a
  readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified the existing MusicXML domain/core tests still pass.

REC-006 remains partially complete. Continue with `core.ts` or `flatten.ts`
next. Keep `parser.ts` for a dedicated later pass because its comments describe
voice reconstruction, timing cursors, and connection pairing policy.

### 2026-08-11: MusicXML core comments cleaned for REC-006

- Continued REC-006 with `apps/customer-web/src/lib/musicxml/core.ts`.
- Replaced Chinese/mojibake comments with concise English explanations for XML
  serialization formatting and entity-group projection.
- Preserved the useful policy comments around MusicXML declaration handling,
  tag indentation, forward-as-blank grouping, and chord member grouping.
- Kept the implementation logic and exported API unchanged; this was a
  readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified the existing MusicXML core/domain tests still pass.

REC-006 remains partially complete. Continue with `flatten.ts` next. Keep
`parser.ts` for a dedicated later pass because it is larger and its comments
describe timing cursor and connection pairing behavior.

### 2026-08-11: MusicXML flatten comments cleaned for REC-006

- Continued REC-006 with `apps/customer-web/src/lib/musicxml/flatten.ts`.
- Replaced Chinese/mojibake comments with concise English explanations for
  staff voice normalization, per-voice timeline cursors, chord grouping,
  forward/backup rebuilding, and cleanup behavior.
- Kept the implementation logic and exported API unchanged; this was a
  readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified the existing MusicXML transformation tests still pass.

REC-006 remains partially complete. The remaining MusicXML cleanup is now mostly
`parser.ts`; handle it as a dedicated pass because it encodes parser policy,
timing cursor behavior, and tie/slur/beam pairing strategy.

### 2026-08-11: MusicXML parser top-level comments cleaned for REC-006

- Started the dedicated `apps/customer-web/src/lib/musicxml/parser.ts` REC-006
  pass with the top-level parser options, parser state, metadata extraction, and
  expected-voice preservation comments.
- Replaced Chinese/mojibake comments with concise English explanations for
  preserved empty voices, connection metadata parsing, creator/credit metadata
  lookup, and stable editor voice ordering.
- Replaced raw circled fingering glyph keys in `FINGERING_TEXT_MAP` with ASCII
  Unicode escape sequences, and updated the parser unit fixture to use an XML
  character entity. Runtime behavior is unchanged, but terminals, diffs, and CI
  logs no longer render those symbols as mojibake.
- Kept parser behavior and exported APIs unchanged.
- Confirmed the first 230 lines of `parser.ts` and the parser unit test file no
  longer contain Chinese characters or mojibake glyphs, and verified parser/core
  tests still pass.

REC-006 remains partially complete. Continue `parser.ts` in small batches. The
next batch should cover the `parseMeasures()` timing cursor and note/chord/rest
projection comments before moving to tie/slur/beam connection pairing.

### 2026-08-11: MusicXML parser measure comments cleaned for REC-006

- Continued the dedicated `apps/customer-web/src/lib/musicxml/parser.ts`
  REC-006 pass with `parseMeasures()`.
- Replaced Chinese/mojibake comments with concise English explanations for
  voice timeline cursors, backup rewinds, note/chord/rest projection, fingering
  alignment, forward-as-blank handling, and stave/voice assembly.
- Kept parser behavior and exported APIs unchanged; this was a
  readability-only cleanup.
- Confirmed the `parseMeasures()` range no longer contains Chinese characters
  or mojibake glyphs, and verified parser/core tests still pass.

REC-006 remains partially complete. Continue `parser.ts` with the
`parseConnections()` section next, especially entity lookup-map construction and
tie/slur/beam pairing comments.

### 2026-08-11: MusicXML parser connection comments cleaned for REC-006

- Completed the dedicated `apps/customer-web/src/lib/musicxml/parser.ts`
  REC-006 pass with `parseConnections()`.
- Replaced Chinese/mojibake comments with concise English explanations for
  entity lookup-map construction, entity display metadata, global start-tick
  ordering, `noteConnections` initialization, and tie/slur/beam two-pass
  pairing.
- Kept parser behavior and exported APIs unchanged; this was a
  readability-only cleanup.
- Confirmed the full `parser.ts` file no longer contains Chinese characters,
  mojibake glyphs, or raw circled fingering glyphs, and verified parser/core
  tests still pass.

REC-006 remains partially complete outside MusicXML. Before expanding further,
run a fresh Customer Web source scan and choose the next module batch by
frequency of use and comment density.

### 2026-08-11: Editor score lookup comments cleaned for REC-006

- Ran a fresh Customer Web source scan after completing the MusicXML comment
  cleanup batches.
- Selected `apps/customer-web/src/lib/editor/score-lookup.ts` because it is a
  high-frequency editor utility used by inspector, history, and connection
  flows, and it still contained mojibake comments.
- Replaced mojibake comments with concise English descriptions for entity and
  metadata lookup helpers.
- Kept implementation logic and exported APIs unchanged.
- Added focused coverage in `apps/customer-web/tests/unit/score-lookup.test.ts`
  for entity lookup, metadata lookup, and missing/null inputs.

REC-006 remains partially complete. Good next batches are editor contexts
(`src/contexts/*`) or API wrapper comments (`src/lib/api/*`). Treat the visible
Chinese language option label in navigation as product UI copy, not a cleanup
target.

### 2026-08-12: Editor context comments cleaned for REC-006

- Continued REC-006 with the core Customer Web editor context files:
  `apps/customer-web/src/contexts/editor-history-context.tsx`,
  `apps/customer-web/src/contexts/score-data-context.tsx`, and
  `apps/customer-web/src/contexts/editor-state-context.tsx`.
- Replaced Chinese/mojibake comments with concise English descriptions for XML
  history, parsed score data, expected voice preservation, editor tool state,
  selected entity state, and tool-change callbacks.
- Kept implementation logic and exported APIs unchanged; this was a
  readability-only cleanup.
- Confirmed the cleaned context files no longer contain Chinese characters or
  mojibake glyphs, and verified lint, typecheck, route-shell, and Verovio
  surface migration tests still pass.

REC-006 remains partially complete. Good next batches are the remaining editor
hooks with dense domain comments, especially `use-connection-operations.ts` and
`use-metadata-editor.ts`; API wrapper comments can wait because they are thinner
and less domain-heavy.

### 2026-08-12: Editor connection operation comments cleaned for REC-006

- Continued REC-006 with
  `apps/customer-web/src/hooks/editor/use-connection-operations.ts`, a
  high-frequency editor hook that owns tie/slur selection and mutation rules.
- Replaced Chinese/mojibake comments with concise English explanations for
  operation result/selected-target types, tie/slur selection state, deletion
  flows, adjacency checks, same-staff tie rules, cross-staff slur rules, and
  start/stop ordering delegation to MusicXML helpers.
- Kept implementation logic and exported hook shape unchanged; this was a
  readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified lint, typecheck, Verovio surface migration, and MusicXML core
  tests still pass.

REC-006 remains partially complete. Continue with
`apps/customer-web/src/hooks/editor/use-metadata-editor.ts` next because it
contains dense MusicXML credit/layout policy comments.

### 2026-08-12: Metadata editor comments cleaned for REC-006

- Continued REC-006 with
  `apps/customer-web/src/hooks/editor/use-metadata-editor.ts`.
- Replaced Chinese/mojibake comments with concise English explanations for the
  score metadata editing hook, the A4 MusicXML credit layout profile, typed
  `<credit>` lookup/upsert behavior, structural metadata synchronization, and
  project ordering inside `<identification>`.
- Kept implementation logic, exported hook shape, and MusicXML output behavior
  unchanged; this was a readability-only cleanup.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified lint, typecheck, Verovio surface migration, and MusicXML core
  tests still pass.

REC-006 remains partially complete. Continue with a fresh Customer Web source
scan and prioritize remaining editor hooks/components by domain density. Avoid
touching user-facing localized copy unless it is malformed mojibake rather than
intentional UI text.

### 2026-08-12: Editor provider and basic hook comments cleaned for REC-006

- Continued REC-006 with the remaining high-frequency editor provider/basic
  hook entry points:
  `apps/customer-web/src/contexts/editor-provider.tsx`,
  `apps/customer-web/src/hooks/editor/use-history-editor.ts`,
  `apps/customer-web/src/hooks/editor/use-xml-updater.ts`, and
  `apps/customer-web/src/hooks/editor/use-entity-editor.ts`.
- Replaced Chinese/mojibake comments with concise English descriptions for
  combined editor context access, History/ScoreData initialization, undo/redo
  control, XML update action labeling, and entity add/update/delete ownership.
- Kept implementation logic, provider composition, hook exports, and editor
  behavior unchanged.
- Confirmed the cleaned files no longer contain Chinese characters or mojibake
  glyphs, and verified lint, typecheck, Verovio surface migration, and MusicXML
  core tests still pass.

REC-006 remains partially complete. Continue with `use-voice-editor.ts` next
because it still contains dense voice deletion/empty-voice preservation comments
that explain important MusicXML editor behavior.

### 2026-08-12: Voice editor comments cleaned for REC-006

- Continued REC-006 with
  `apps/customer-web/src/hooks/editor/use-voice-editor.ts`.
- Replaced Chinese/mojibake comments with concise English explanations for
  voice add/clear/delete ownership, MusicXML note/forward removal, XML
  reparsing after voice mutation, and the empty-voice restoration rule needed
  because the parser only emits voices that contain elements.
- Kept implementation logic, hook exports, and editor behavior unchanged.
- Confirmed the file no longer contains Chinese characters or mojibake glyphs,
  and verified lint, typecheck, Verovio surface migration, and MusicXML core
  tests still pass.

REC-006 remains partially complete. Continue with the focused entity-editor
submodule comments next:
`apps/customer-web/src/hooks/editor/entity-editor/index.ts`,
`insert-entity.ts`, and `update-existing-entity.ts`.

### 2026-08-12: Voice editor dead local-voice operations removed

- Rechecked the current voice-layer call graph after the REC-006 voice editor
  cleanup.
- Confirmed `apps/customer-web/src/lib/editor/tracks.ts` and its tests define
  the current product semantics as one global editor track per MusicXML voice
  number across the score; `getEditorTrackId()` intentionally ignores
  `staffIndex`.
- Removed unused local-measure/staff voice operations from
  `apps/customer-web/src/hooks/editor/use-voice-editor.ts`:
  `handleAddVoice`, `handleClearVoice`, `handleDeleteVoice`, and their
  private single-measure XML removal helper.
- Renamed the remaining real operation to `handleDeleteVoiceTrack(xmlVoice)` and
  updated `apps/customer-web/src/components/editor/voice-layer.tsx` to call it
  without passing a misleading staff index.
- Kept the existing runtime behavior for deleting non-empty tracks: it removes
  matching MusicXML `note` and `forward` elements for the selected voice number
  across all measures, recalculates backups per measure, reparses XML, and
  records history.
- Empty tracks are still handled by `useEditorTracks.removeEmptyTrack()`, which
  removes the empty score-data-only voice from every measure/staff; parser-level
  `expectedVoices` remains responsible for preserving intentional empty voices
  during XML edit/reparse cycles.

REC-006 remains partially complete. Continue with the focused entity-editor
submodule comments next:
`apps/customer-web/src/hooks/editor/entity-editor/index.ts`,
`insert-entity.ts`, and `update-existing-entity.ts`.

### 2026-08-12: Entity editor submodule comments cleaned for REC-006

- Continued REC-006 with the focused entity-editor submodule:
  `apps/customer-web/src/hooks/editor/entity-editor/index.ts`,
  `apps/customer-web/src/hooks/editor/entity-editor/insert-entity.ts`, and
  `apps/customer-web/src/hooks/editor/entity-editor/update-existing-entity.ts`.
- Replaced Chinese/mojibake JSDoc with concise English descriptions for barrel
  exports, pure MusicXML insertion/update helpers, and result semantics.
- Kept implementation logic, exported function/type names, and MusicXML editing
  behavior unchanged.
- Confirmed the cleaned files no longer contain Chinese characters or mojibake
  glyphs, and verified lint, typecheck, entity-editor unit tests, Verovio
  surface migration, and MusicXML core tests still pass.

REC-006 remains partially complete. Continue with remaining non-domain-heavy
Customer Web comments, starting with authentication/profile API wrappers and
auth context comments. Keep intentional localized UI labels such as the language
selector text untouched.

### 2026-08-12: Auth/profile comments cleaned for REC-006

- Continued REC-006 with non-domain-heavy Customer Web auth/profile files:
  `apps/customer-web/src/contexts/auth-context.tsx`,
  `apps/customer-web/src/lib/api/auth.ts`,
  `apps/customer-web/src/lib/api/profile.ts`, and
  `apps/customer-web/src/hooks/queries/use-profile-mutations.ts`.
- Replaced Chinese/mojibake comments with concise English descriptions for auth
  context state/actions, API user mapping, session refresh behavior, auth API
  wrappers, profile API wrappers, avatar URL construction, and profile mutation
  hooks.
- Kept implementation logic, API endpoints, generated DTO types, hook names, and
  runtime behavior unchanged.
- Confirmed the cleaned files no longer contain Chinese characters or mojibake
  glyphs, and verified lint, typecheck, route-shell, Verovio surface migration,
  and event-inspector model tests still pass.

Entity model clarification from the same pass:

> Historical note: this was the state observed on 2026-08-12 before REC-007
> was accepted and implemented. It is not the current target architecture.

- `ScoreEntityType` currently has four parsed/editor entities: `note`, `chord`,
  `rest`, and `blank`.
- `blank` is the Customer Web representation of a MusicXML `<forward>` element:
  an occupied timeline gap/space in a voice, not a visible rest.
- The Inspector edit model intentionally has three editable pitch states:
  zero pitches saves as rest, one pitch saves as note, multiple pitches save as
  chord. Existing blank entities are selectable and can have duration/dotted
  edited while remaining blank; adding a pitch converts them into notes.

REC-006 remains partially complete. Continue scanning remaining Customer Web
source comments, but treat localized UI copy and valid musical glyphs as product
content rather than cleanup targets.

### 2026-08-12: Verovio blank/space editing boundary corrected

> Historical note: this fix was valid for the pre-REC-007 model. The later
> REC-007 decision superseded it: MusicXML `<forward>` is now adapter cursor
> state, not an ordinary editable `blank` entity.

- Rechecked the editor entity model after a product-semantics question about
  `blank`/MusicXML `<forward>` entities.
- Confirmed `ScoreEntityType` still has four internal entities: `note`, `chord`,
  `rest`, and `blank`; `blank` is the parsed representation of MusicXML
  `<forward>` and is useful for timeline spacing, insertion anchoring, and
  editing intentional gaps.
- Corrected the previous hit-test tightening: Verovio `[data-class="space"]`
  should resolve as a blank editable entity when Verovio provides a concrete
  space element id. Otherwise users cannot change a forward duration, such as
  converting a one-beat forward into a two-beat forward.
- Fixed `apps/customer-web/src/hooks/editor/entity-editor/update-existing-entity.ts`
  so forward-backed blank entities use a dedicated update path instead of being
  treated as `<note>` elements. The editor can now update forward duration while
  preserving `<forward>`, or replace a blank forward with note/rest/chord XML
  when the user changes the event kind.
- Added regression coverage in
  `apps/customer-web/src/hooks/editor/entity-editor/update-existing-entity.test.ts`
  and `apps/customer-web/src/lib/editor/verovio-entity-map.test.ts`.

### 2026-08-12: Remaining Customer Web comments cleaned for REC-006

- Cleaned the remaining non-localized Customer Web source comments in:
  `apps/customer-web/src/lib/api/index.ts`,
  `apps/customer-web/src/components/media/original-image-viewer.tsx`,
  `apps/customer-web/src/components/editor/draft-recovery-dialog.tsx`,
  `apps/customer-web/src/components/editor/editor-sidebar.tsx`, and
  `apps/customer-web/src/app/[locale]/(auth)/auth/login/page.tsx`.
- Confirmed the Customer Web source scan now only reports the intentional
  language selector label `中文` in
  `apps/customer-web/src/components/navigation/nav-actions.tsx`.
- Verified lint, typecheck, Verovio entity mapping tests, route-shell tests,
  Verovio surface migration tests, event-inspector model tests, and MusicXML core
  tests still pass.

REC-006 is complete for `apps/customer-web/src` source comments under the
current policy: remove Chinese/mojibake comments, preserve intentional localized
UI text and valid musical glyphs. Continue with a broader repository scan only
if the next pass expands REC-006 beyond Customer Web source files.

### 2026-08-12: Editor domain model refactoring plan added for REC-007

- Added `docs/engineering/plans/editor-domain-model-refactoring-plan.md` after
  reviewing the current Customer Web editor code paths that expose
  `blank = MusicXML <forward>` across parsed score types, MusicXML grouping,
  insert/update helpers, Inspector conversion, and Verovio hit mapping.
- Recorded the target architecture: NoteVerse editor domain events should model
  voices, rhythmic positions, pitched events, explicit rests, derived gaps, and
  selections; MusicXML `<forward>`, `<backup>`, `divisions`, and chord encoding
  belong to import/export and render adapter layers.
- The plan intentionally avoids fallback aliases and long-lived compatibility
  logic because the project is still in development.

REC-007 is now the recommended next major Customer Web refactor. Start with
the ADR and domain type skeleton before deleting `Blank` or changing Inspector
behavior.

### 2026-08-12: Editor domain ADR and invariant tests added for REC-007

- Added ADR 0007 to record the accepted boundary: editor domain events model
  musical concepts, while MusicXML cursor instructions stay in adapter layers.
- Added the initial `apps/customer-web/src/lib/editor-domain/` type skeleton
  and focused invariant tests for pitched events, explicit rests, timeline gaps,
  delete semantics, and MusicXML cursor movement.
- Kept current editor UI behavior and legacy `ScoreEntity` code untouched in
  this phase; these new types are the target model, not compatibility aliases.

REC-007 should continue with a dedicated MusicXML-to-domain importer that
parses `<forward>` and `<backup>` as cursor movement only.

### 2026-08-12: MusicXML-to-editor-domain importer started for REC-007

- Added a dedicated Customer Web editor-domain MusicXML importer separate from
  the legacy UI parser.
- The importer creates NoteVerse domain `PitchedEvent` and `ExplicitRestEvent`
  records, derives timeline gaps, and treats MusicXML `<forward>`/`<backup>` as
  cursor movement rather than persisted editor events.
- Added importer tests for pitched notes, explicit rests, forward gaps, backup
  voice placement, and MusicXML chord encoding into one pitched event.
- Current UI behavior remains untouched; this is the new-model migration path,
  not a compatibility facade over `ScoreEntity`.

REC-007 should continue by expanding importer fixtures for cross-staff voice
ownership, dotted duration, accidentals/fingering, and stable domain/render
anchors before replacing existing editor selection code.

### 2026-08-12: Editor-domain importer source metadata and notation fields expanded

- Extended the new editor-domain model with source metadata that records
  imported MusicXML element ids separately from domain ids.
- Expanded the MusicXML-to-domain importer to preserve note-level accidentals,
  normalized fingering values, dotted notation, and chord member source ids.
- Added importer tests for cross-staff voice ownership: one MusicXML voice can
  keep a stable `voiceId` while individual events use different `staffId`
  values.
- Current UI behavior remains untouched; these fields prepare the importer for
  future Inspector and render-anchor migration.

REC-007 should continue with a render/domain anchor model and then a
domain-to-MusicXML exporter projection.

### 2026-08-12: Render/domain anchor boundary added for REC-007

- Added a pure editor-domain render-anchor model that maps disposable Verovio
  render ids to stable domain anchors.
- The new model explicitly separates render ids, imported MusicXML source ids,
  and domain anchors. Resolving by render id does not treat MusicXML ids as
  domain identity.
- Added tests for render-id resolution, source-id fan-out, and selecting all
  render ids for the same domain anchor.
- Current legacy `verovio-entity-map.ts` remains unchanged; this is the target
  replacement boundary for the future selection migration.

REC-007 should continue with a domain-to-MusicXML exporter projection, including
generation of `<forward>`, `<backup>`, explicit rests, and MusicXML chord
serialization from `PitchedEvent.notes`.

### 2026-08-12: Editor-domain MusicXML exporter projection started

- Added a dedicated editor-domain-to-MusicXML exporter separate from the legacy
  XML mutation helpers.
- The exporter serializes `PitchedEvent` as MusicXML notes, serializes
  multi-note pitched events with MusicXML `<chord/>` members, serializes
  `ExplicitRestEvent` as `<note><rest/></note>`, emits `<forward>` for gaps, and
  emits `<backup>` before writing a second voice.
- Added focused exporter tests for single notes, chords, explicit rests, gaps,
  and multi-voice output.
- Current save/render UI remains untouched. The importer/exporter pair now
  proves the target adapter boundary in both directions.

REC-007 should continue by adding round-trip domain invariant tests and then
using the importer/exporter pair to design the replacement editor selection and
Inspector command path.

### 2026-08-12: Editor-domain MusicXML round-trip invariants added

- Added round-trip tests for the new editor-domain adapter boundary:
  `MusicXML -> editor domain -> MusicXML -> editor domain`.
- The tests prove event semantics, chord grouping, explicit rests, derived gaps,
  multiple voices, and current notation fields remain stable through the
  importer/exporter pair.
- The tests also prove MusicXML `<forward>` and `<backup>` remain serialization
  details rather than becoming domain events after re-import.

REC-007 can now move from adapter-boundary proof toward selection and command
model design. The next safe implementation target is a domain selection adapter
that converts domain anchors into editor selections without touching the legacy
`ScoreEntity` Inspector yet.

### 2026-08-12: Editor-domain selection adapter added

- Added a pure selection adapter for converting domain anchors into editor
  selections and back.
- The adapter supports event, note atom, timeline gap, derived rest, caret, and
  notation selections without depending on legacy `ScoreEntity`.
- Measure and staff anchors intentionally do not become fake Inspector
  selections; they return `null` until a concrete UI behavior exists.
- Added tests for selectable anchor conversion, non-selectable structural
  anchors, and classification of Inspector versus insertion-capable selections.

REC-007 should continue with the command model skeleton: insert pitched event,
insert explicit rest, delete event to gap, add note atom, and remove note atom
without silently converting the event to a rest.

### 2026-08-12: Editor-domain command model skeleton added

- Added pure editor-domain commands for inserting pitched events, inserting
  explicit rests, deleting voice events, adding note atoms, and removing note
  atoms.
- The command tests enforce the target semantics: deleting an event derives
  gaps instead of creating a rest; adding a note atom turns a note-shaped
  `PitchedEvent` into a chord-shaped `PitchedEvent`; removing the final note
  atom is rejected instead of silently converting the event to a rest.
- Commands return explicit success/error results and do not depend on legacy
  `ScoreEntity`, `entityIndex`, or MusicXML `<forward>` entities.

REC-007 should continue by adding a minimal domain Inspector view-model adapter
for `PitchedEvent`, `ExplicitRestEvent`, `TimelineGap`, and `DerivedRest`
without wiring it into the legacy React Inspector yet.

### 2026-08-12: Editor-domain Inspector view-model adapter added

- Added a pure editor-domain Inspector view-model adapter that maps domain
  selections to Inspector-ready semantic models.
- The adapter exposes `PitchedEvent` with `displayKind: note | chord`, selected
  `NoteAtom`, `ExplicitRestEvent`, `TimelineGap`, and `DerivedRest` as distinct
  Inspector concepts.
- The adapter intentionally returns `null` for caret, range, and notation
  selections until concrete Inspector behavior exists; it does not manufacture
  fake editable entities.
- Added tests proving that chords remain one pitched event with multiple note
  atoms, explicit rests remain first-class rest events, and timeline gaps /
  derived rests are not represented as legacy `blank` or zero-pitch rests.

REC-007 should continue with a domain Inspector edit-draft / command adapter
before touching React UI. The next step should define editable drafts for
pitched events, note atoms, explicit rests, timeline gaps, and derived rests,
then apply those drafts through the pure command model instead of through the
legacy `ScoreEntity` mutation path.

### 2026-08-12: Editor-domain Inspector draft command adapter added

- Added pure command support for updating pitched events, updating selected
  note atoms, updating explicit rests, and materializing timeline gaps /
  derived rests as explicit rests.
- Added an Inspector draft adapter that converts Inspector view models into
  edit drafts and applies explicit draft actions through the domain command
  model.
- Gap and derived-rest drafts default to `inspectOnly`; they do not invent
  event ids, default notation, or mutate the score unless the caller provides
  an explicit `materializeExplicitRest` action.
- Added tests proving omitted note-atom fields are preserved, explicit clears
  are intentional, rest edits go through the command model, and gap-derived
  rests are not edited as legacy `blank` entities.

REC-007 should continue by adding a legacy editor dependency inventory /
boundary test that identifies all remaining Customer Web code still importing
or relying on `ScoreEntity`, `Blank`, and Verovio `[data-class="space"]`.
After that inventory is executable, begin replacing one narrow UI integration
path at a time.

### 2026-08-12: Customer Web editor legacy dependency inventory added

- Added `npm run inventory:editor-legacy` and
  `npm run check:editor-legacy-inventory` for Customer Web.
- Generated
  `docs/engineering/reviews/2026-08-12-customer-web-editor-legacy-inventory.md`
  as the executable REC-007 migration inventory.
- Current inventory baseline: 89 matching lines across 23 files.
  - `ScoreEntity`: 52 matching lines.
  - `Blank`: 6 matching lines.
  - lowercase `blank`: 29 matching lines.
  - Verovio `data-class="space"`: 2 matching lines.
- Added an `editor-domain` architecture boundary test proving the new domain
  package does not import legacy score editor types, legacy editor helpers,
  MusicXML UI parser helpers, or React editor components.

REC-007 should continue by replacing one narrow legacy integration seam. The
recommended next target is the non-React legacy editable-event conversion path
(`src/lib/editor/editable-event.ts` and
`src/components/editor/event-inspector-event-model.ts`) because it currently
bridges Inspector UI and `ScoreEntity` mutation semantics while being smaller
and safer than `editor-preview-panel.tsx`.

### 2026-08-12: First legacy Inspector and Verovio hit seams narrowed

- Removed the `Blank` preservation branch from the legacy Inspector save
  adapter. Saving an empty-pitch edit now goes through the normal rest path
  instead of deliberately keeping the old `blank` entity.
- Preserved original entity metadata in the Inspector save adapter so converting a
  legacy blank selection into a rest does not lose the source entity id or
  location metadata.
- Updated the legacy summary icon behavior so blank selections do not fall
  through to the note icon.
- Removed Verovio `[data-class="space"]` from ordinary editable event hit
  detection and added an explicit guard so fallback id lookup cannot reselect
  it as a normal event.
- Updated the executable inventory wording from "space hit target" to
  "space handling" because the remaining `data-class="space"` references now
  document the adapter exclusion behavior rather than editable blank hits.

REC-007 should continue by moving the remaining Inspector edit view-model
helpers out of `src/lib/editor/editable-event.ts` and into the new
`editor-domain` model, then replacing `event-inspector.tsx` state updates with
domain Inspector drafts.

### 2026-08-12: Legacy editable-event helper moved out of core editor lib

- Moved the old Inspector editable-event view model from
  `src/lib/editor/editable-event.ts` to
  `src/components/editor/event-inspector-editable-event.ts`.
- Removed the old `src/lib/editor/editable-event.ts` file, its test, and its
  barrel export from `src/lib/editor/index.ts`.
- Updated `event-inspector.tsx`, `event-inspector-event-model.ts`, and the
  relevant unit tests to import the helper from the Inspector component
  boundary.
- Simplified `use-entity-editor.ts` add mode so it constructs the default
  quarter rest directly instead of depending on the Inspector editable-event
  helper.
- This does not finish the Inspector migration, but it narrows ownership:
  the helper is now explicitly legacy Inspector UI glue rather than a core
  editor-domain model.

REC-007 should continue by replacing `event-inspector.tsx` local editable-event
state with the new `editor-domain` Inspector view-model and draft adapter.
After that, the legacy helper can be deleted rather than merely localized.

### 2026-08-13: Inspector save path now emits domain draft intent

- Added `event-inspector-domain-adapter.ts` as an explicit temporary bridge
  from legacy `ScoreEntity` selections and Inspector edit state to
  `editor-domain` Inspector drafts.
- The Inspector save projection now creates a domain Inspector draft first, then projects
  that draft back to the current XML updater's legacy writable entity shape.
- The bridge maps empty-pitch legacy blank edits to `ExplicitRest` draft
  intent; it does not preserve `blank` as a save target.
- Removed `updateExistingEntity` support for writing an updated `blank` entity
  back to MusicXML `<forward>`. A forward target can still be replaced, but the
  replacement must be a note, chord, or explicit rest.
- Removed `insertEntity` support for inserting `blank` entities. MusicXML
  `<forward>` remains available inside the adapter only for cursor movement
  when inserting into an empty voice at a non-zero tick.
- Added `WritableEntity = Note | Chord | Rest` to the legacy score types to
  distinguish writable/editable XML mutation targets from parser-output score
  events during the transition.

REC-007 should continue by migrating the MusicXML parser away from emitting
`Blank` for `<forward>`. The parser should instead expose timeline gaps through
the new `editor-domain` importer/render-anchor path or omit forward cursor
instructions from legacy `ScoreData` entirely once the UI no longer depends on
them.

### 2026-08-13: Legacy `Blank` entity removed from Customer Web score types

- Removed `Blank` from the parsed score event type union.
- The legacy MusicXML parser no longer emits `Blank` entities for
  MusicXML `<forward>`; forward elements now advance the voice cursor only.
- `getEntityGroupsFromMeasure` no longer returns forward groups by default, so
  editable `entityIndex` values align with parser output that contains only
  notes, chords, and explicit rests.
- Automatic beam repair can still request `includeForwardGroups: true` because
  beam timing needs cursor gaps; this keeps MusicXML `<forward>` as an adapter
  timing detail, not as an editable entity.
- Removed update/insert paths that wrote `blank` entities back to MusicXML.
- Added tests proving parser output omits forward-as-blank entities while
  preserving note `startTick`, and proving entity groups exclude forward by
  default but can include it for timing adapters.
- Inventory after this step: `Blank` type references are down to 0 and
  lowercase `blank` references are down to explanatory/test wording only.

REC-007 continued by reducing the remaining old score-entity naming surface.
The next high-value target is splitting parser output types from editor UI
types so `ScoreData` no longer presents itself as the long-term editor domain
model.

### 2026-08-13: Legacy `ScoreEntity` name removed from Customer Web source

- Replaced the old parser/UI DTO name `ScoreEntity` with `ParsedScoreEvent`.
- Replaced `ScoreEntityType` with `ParsedScoreEventType`.
- Kept `WritableEntity = Note | Chord | Rest` as the explicit temporary XML
  updater boundary. This avoids suggesting that parser output is the long-term
  editor domain model.
- Renamed the Inspector bridge projection from the old score-entity vocabulary
  to the temporary writable-entity boundary.
- Renamed the legacy Inspector helper `toScoreEntity` to `toWritableEntity`.
- Renamed the Verovio lookup helper `findScoreEntityById` to
  `findParsedScoreEventByRenderId`.
- Removed Verovio `[data-class="space"]` from the preview panel's ordinary
  editable-event container selector. The remaining `VEROVIO_SPACE_SELECTOR`
  reference is an intentional adapter guard, not an editable blank hit target.
- Refreshed the executable legacy inventory:
  - legacy `ScoreEntity` model references: 0;
  - legacy `Blank` type references: 0;
  - lowercase `blank` discriminator matches: 1 non-editor metadata comment;
  - Verovio space handling references: 1 intentional guard.

REC-007 should continue by replacing `ParsedScoreEvent` / `ScoreData` consumer
paths with editor-domain projections and commands. Avoid adding compatibility
aliases; the project is still in development and should not preserve the old
model as a second vocabulary.

### 2026-08-13: Transitional `Voice.notes` renamed to `Voice.events`

- Renamed the transitional Customer Web `ScoreData` voice collection from
  `Voice.notes` to `Voice.events`.
- Updated the legacy MusicXML parser, editor preview, track derivation,
  connection lookup, measure status, entity lookup, entity editor helpers, and
  related unit fixtures to use `events`.
- Left `PitchedEvent.notes` unchanged in `editor-domain` because there it
  correctly means the note atoms inside one pitched event/chord.
- Left playback timeline `notes` unchanged because it correctly means rendered
  playback notes.
- This is a semantic cleanup only; runtime editor behavior is intended to stay
  unchanged.

REC-007 continued by shrinking `ParsedScoreEvent` / `ScoreData` consumer paths
toward editor-domain projections. The next target became selection and lookup
naming around the transitional Verovio parsed-event hit boundary, because that
helper still sits in a render-adapter layer that should eventually resolve
domain anchors.

### 2026-08-13: Verovio parsed-event hit boundary renamed around render ids

- Replaced the transitional `VerovioEntityHit` name with
  `VerovioParsedEventHit`.
- Renamed `getVerovioElementIdFromTarget` to
  `getVerovioRenderElementIdFromTarget` so callers do not confuse disposable
  Verovio render ids with domain identity.
- Renamed `findParsedScoreEventById` to `findParsedScoreEventByRenderId`.
- Changed hit payloads from `{ entity, location }` to
  `{ event, location, renderElementId }`.
- Updated editor preview connection/edit/delete click flows and tests to use
  the new names.
- This is still a transitional parsed-event lookup, not the final target. The
  final boundary should resolve render ids to editor-domain anchors.

REC-007 should continue by introducing a small adapter that converts the
current parsed-event hit into a domain-anchor-shaped selection object. Do this
only where it improves readability; avoid abstracting every preview click
branch prematurely.

### 2026-08-13: Thin parsed-event selection adapter introduced

- Added `apps/customer-web/src/lib/editor/parsed-event-selection.ts`.
- The adapter converts a transitional `VerovioParsedEventHit` into
  `ParsedEventSelection`.
- Moved connection source-id extraction for parsed event selections out of the
  React preview component.
- Updated `editor-preview-panel.tsx` so click and add-preview flows consume
  `selection.event` / `selection.location` instead of raw Verovio hit payloads.
- Added focused unit coverage for missing hits, selection wrapping, and chord
  member connection source-id resolution.
- This adapter is deliberately thin. It does not invent domain ids and does not
  belong in `editor-domain`; it is a temporary bridge until render ids resolve
  to real domain anchors.

REC-007 should continue by reducing the remaining direct `ScoreData` dependency
inside `editor-preview-panel.tsx`. The next small step should extract visual
insert placement helpers into a non-React helper only if doing so makes the
preview component easier to read without hiding editor behavior behind a vague
service object.

### 2026-08-13: Visual insert placement extracted from editor preview

- Added `apps/customer-web/src/lib/editor/visual-insert-placement.ts`.
- Moved pure visual insertion placement logic out of
  `editor-preview-panel.tsx`, including:
  - direct staff horizontal bounds;
  - target staff event detection;
  - borrowed visible voice anchors;
  - rendered event bounds;
  - nearest insertion slot selection.
- Kept React event handling, caret style calculation, mobile confirmation, and
  editor tool dispatch inside `editor-preview-panel.tsx`.
- Added focused tests for staff bounds, staff event detection, and nearest
  visual insertion slot selection.
- This is intentionally not a generic editor service. It is a small pure helper
  around the current transitional `ScoreData` + Verovio render surface.

REC-007 should continue by reducing another narrow preview responsibility only
when the extraction has a crisp name and tests. A good next target is the
measure/staff hit geometry helpers if they remain tightly coupled to insertion
placement; otherwise move toward replacing parsed-event selections with real
render-domain anchors.

### 2026-08-13: Verovio measure/staff geometry extracted

- Added `apps/customer-web/src/lib/editor/verovio-geometry.ts`.
- Moved direct measure/staff DOM queries, measure horizontal bounds,
  point-to-measure lookup, measure index lookup, and nearest-staff lookup out of
  `editor-preview-panel.tsx`.
- Updated `visual-insert-placement.ts` to reuse `getMeasureHorizontalBounds`
  from the geometry helper instead of owning that concern.
- Added focused tests for direct measure/staff filtering, staff-based measure
  bounds, point-to-measure lookup, measure index lookup, and staff hit geometry.
- Fixed the direct-measure filtering semantics while extracting: nested
  measure-like elements are no longer returned as top-level rendered measures.

REC-007 should continue by avoiding further mechanical preview extraction until
there is a clear domain or adapter boundary. The next meaningful step is to
inspect whether `editor-preview-panel.tsx` still has independent concerns that
deserve named helpers, or whether effort should move to replacing
`ParsedEventSelection` with real render-domain anchors.

### 2026-08-13: Delete entity XML mutation extracted from `use-entity-editor`

- Added `apps/customer-web/src/hooks/editor/entity-editor/delete-entity.ts`.
- Added focused delete tests in
  `apps/customer-web/src/hooks/editor/entity-editor/delete-entity.test.ts`.
- Updated the `entity-editor` barrel export to expose delete params/results.
- Moved delete MusicXML DOM mutation, backup recalculation, automatic beam
  repair, serialization, and reparsing out of `use-entity-editor.ts`.
- `use-entity-editor.ts` now orchestrates add/update/delete through the
  `entity-editor` helper boundary and keeps responsibility for React state,
  history, current XML refs, and Inspector visibility.
- This is still the legacy XML mutation pipeline. It is now better isolated,
  which makes the later replacement with editor-domain commands/exporter less
  risky.

REC-007 should continue by reviewing whether `insert-entity.ts`,
`update-existing-entity.ts`, and `delete-entity.ts` share enough XML mutation
plumbing to justify a small shared helper. Do not extract a broad service unless
the duplicated code has a precise name and tests.

### 2026-08-13: Shared XML mutation context added for entity editor helpers

- Added
  `apps/customer-web/src/hooks/editor/entity-editor/musicxml-mutation-context.ts`.
- Added focused tests for opening a mutation target, missing measure handling,
  and serialize/reparse behavior.
- Centralized the repeated parse/current-location/measure lookup logic in
  `openEntityMutationTarget`.
- Centralized serialize + reparse result creation in
  `serializeEntityMutationResult`.
- Updated `insert-entity.ts`, `update-existing-entity.ts`, and
  `delete-entity.ts` to use the shared context helpers.
- Kept the helper deliberately narrow. It does not own entity semantics,
  command behavior, or React orchestration; those remain in the existing
  mutation helpers and hook boundaries.

REC-007 should continue by checking whether the remaining XML mutation helpers
still have confusing names or responsibilities. If the remaining duplication is
only low-level MusicXML element construction, leave it local until the
editor-domain exporter replaces the legacy mutation pipeline.

### 2026-08-13: Unused Inspector `toWritableEntity` helper removed

- Removed `toWritableEntity` from
  `apps/customer-web/src/components/editor/event-inspector-editable-event.ts`.
- Removed the tests that only exercised that unused conversion helper.
- Kept one Inspector save conversion path, backed by
  `event-inspector-domain-adapter.ts`.
- This prevents future maintainers from seeing two similar editable-event to
  writable-entity conversion paths and guessing which one is authoritative.

REC-007 should continue by reviewing the remaining Inspector boundary and
removing misleading legacy vocabulary where it represents current behavior
rather than historical evidence.

### 2026-08-13: Inspector save projection public names clarified

- Renamed `toEntityForSave` to `toWritableEntityFromInspectorEvent`.
- Renamed the public Inspector draft bridge helpers to
  `toInspectorDomainDraft` and `toWritableEntityFromInspectorDraft`.
- Updated Inspector usage and tests without keeping compatibility aliases.
- Left narrow private helpers such as `toLegacyDuration` local to the adapter
  because they explicitly map domain draft values back to the transitional
  MusicXML/score-types representation and are not public vocabulary.

REC-007 should continue by checking whether `event-inspector-event-model.ts`
still mixes too many unrelated concerns. Only split it if there is a crisp
boundary, for example separating Inspector option constants from save
projection helpers; avoid extracting a generic service that hides readable UI
logic.

### 2026-08-13: Last-pitch deletion no longer becomes an implicit rest conversion

- Updated the Inspector editable-event helper so `removePitch` is a no-op when
  a pitched event has only one pitch left.
- Disabled the per-pitch delete button for the final remaining pitch.
- Updated the empty-pitch Inspector copy to describe an explicit rest instead
  of implying that pitch deletion is a normal way to save a rest.
- Refreshed tests so pitch add/delete covers rest-to-pitched and chord-to-note
  transitions, while the final pitch cannot silently become a rest.

REC-007 should continue by keeping explicit rest creation as a named command
or selected-rest edit path. Do not reintroduce pitch-count-only conversion as a
generic editor command; it may remain inside the temporary Inspector view model
only until the domain Inspector path owns pitched events and explicit rests
directly.

### 2026-08-13: Inspector editable-event kind checks centralized

- Replaced direct `event.pitches.length` kind checks in `event-inspector.tsx`
  and the Inspector domain adapter with named helpers:
  `isExplicitRestEditableEvent`, `isPitchedEditableEvent`, and
  `getEditableEventDisplayKind`.
- Renamed the transitional display kind vocabulary from `rest` / `note` /
  `chord` to `explicitRest` / `singleNote` / `chord`.
- Kept the pitch-count implementation local to the temporary Inspector
  editable-event view model. This makes the remaining transitional rule visible
  and prevents it from spreading across React UI and save projection code.

### 2026-08-13: Add-mode rest insertion wording clarified

- Rechecked `use-entity-editor.ts` add mode. It writes an explicit
  `WritableEntity` rest (`type: 'rest'`), not a `blank` or a separate
  empty-pitch domain entity.
- Updated the add-mode comment to say it inserts an explicit quarter rest and
  keeps it selected for Inspector editing.
- Updated insert and Inspector test names that still described explicit rest
  behavior as "empty-pitch" editing.
- Did not extract a one-use factory. The inline `WritableEntity` rest literal
  is readable and scoped; over-extracting it would not improve the current
  boundary.

REC-007 should continue by moving from this transitional `EditableEvent`
display shape toward domain Inspector drafts as the React state shape. The next
safe target is to inspect whether the writable XML mutation helpers still
permit impossible transitional states, such as an empty chord, and enforce those
as explicit guard clauses or tests at the helper boundary.

### 2026-08-13: Empty chord mutation states guarded

- Added an explicit `updateExistingEntity` guard that rejects
  `{ type: 'chord', pitches: [] }` before mutating the target MusicXML group.
- Added update coverage proving empty chord updates return `{ success: false }`
  instead of deleting the existing XML notes.
- Added insert coverage for the existing empty chord insert rejection path.
- This keeps the helper boundary aligned with the target domain invariant that
  a pitched event/chord must contain at least one note atom.

REC-007 should continue by reviewing other mutation-helper invalid states that
can be rejected cheaply, especially mismatched chord metadata arrays
(`fingerings` / `accidentals`) and parsed-event summaries that assume empty
chords are displayable.

### 2026-08-13: Chord per-note metadata shape validated

- Added a narrow writable-entity shape validator for the entity-editor mutation
  boundary.
- Chords are now rejected before XML mutation if:
  - `pitches` is empty;
  - `fingerings` is provided as a non-empty array whose length differs from
    `pitches.length`;
  - `accidentals` is provided as a non-empty array whose length differs from
    `pitches.length`.
- Missing or empty optional metadata arrays remain valid because they mean "no
  per-note metadata", not partial metadata.
- This is an internal DTO integrity rule, not a music-theory rule. A real chord
  may show fingering or explicit accidentals on only some notes; when the DTO
  carries any such per-note metadata, the array must remain index-aligned with
  `pitches` and use empty values for notes without visible metadata.
- `insertEntity` and `updateExistingEntity` now share this validation, with
  focused tests for empty chords, partial metadata rejection, and metadata-free
  chord updates.

REC-007 should continue by reviewing display/read paths for empty or malformed
chords. Mutation helpers now reject impossible chord writes, but parser,
summary, and connection code should still fail clearly or normalize input if a
malformed imported score is encountered.

### 2026-08-13: Malformed MusicXML chord member no longer creates a single-note chord

- Tightened the legacy MusicXML parser's chord-member branch.
- A `<note><chord/></note>` member without a pitch no longer converts the
  previous note into a chord.
- Added parser coverage proving the original note remains a note and keeps its
  original source id when the chord member is malformed.
- This reduces the chance that downstream summary, connection, or Inspector
  read paths see impossible chord shapes.

REC-007 should continue by reviewing parsed-event display helpers for whether
they need explicit malformed-input assertions. The current write and import
paths now prevent empty chords and single-note chords from normal flows, so
avoid adding broad defensive abstractions unless a real imported-score fixture
shows the need.

### 2026-08-13: Connection pitch summary handles malformed empty chords

- Reviewed parsed-event display and connection read paths after tightening
  chord writes/imports.
- Added a narrow fallback in `getEntitySourcePitch` so a malformed empty chord
  cannot render as an empty connection endpoint label.
- Did not add broad display fallbacks to `getEntitySummaryPitch`; normal write
  and import paths now prevent empty chords, and pretending a malformed chord is
  a rest would be misleading.

REC-007 should continue by moving up one level from guard clauses to the
remaining transitional model boundary: inspect whether `ParsedScoreEvent`
summary helpers and Inspector state should now be split into option constants,
pitch-edit helpers, and save projection, or whether that would be over-
extraction at this stage.

### 2026-08-13: Editor domain refactoring plan status rechecked

- Re-read the editor domain refactoring plan against current Customer Web
  source.
- Updated the plan status from "proposed" to "in progress".
- Added a completion assessment: Phase 1 through Phase 3 are mostly in place,
  while Phase 4 through Phase 7 remain incomplete because React editor state,
  preview selection, Inspector save, XML mutation, and downstream projections
  still consume transitional `ParsedScoreEvent` / `ScoreData` paths.
- Split Inspector option constants into
  `event-inspector-options.ts`, leaving `event-inspector-event-model.ts` focused
  on pitch parsing, summaries, and save projection.

REC-007 should continue with one of the remaining high-value transitions:
either replace `ParsedEventSelection` with real render/domain anchors, or move
Inspector React state from the transitional `EditableEvent` shape to domain
Inspector drafts. The render/domain anchor path is broader; the Inspector draft
path is likely the safer next slice.

### 2026-08-13: Inspector React state moved to domain draft bridge

- Introduced `InspectorEditState` for the React Inspector panel.
- The panel now stores a domain `InspectorDraft` as the primary edit intent and
  derives the temporary `EditableEvent` UI shape from that state for rendering.
- Kept `stemDirection` in an explicit `notation` supplement because the current
  domain `InspectorDraft` does not model stem direction yet. This avoids
  silently losing an existing Inspector feature while still making the
  non-domain remainder visible.
- Removed the old direct `toWritableEntityFromInspectorEvent` save entry point;
  saves now project through `InspectorEditState`.
- Added tests for draft-backed save projection and notation state preservation.

REC-007 should continue by deciding whether stem direction belongs in the
editor-domain notation model or remains a MusicXML/rendering adapter concern.
Until that decision is made, keep it explicit as supplemental notation state
rather than hiding it inside generic editable-event conversion.

### 2026-08-13: Notation control layer introduced for stem/beam/tie/slur concerns

- Reviewed stem, beam, tie, and slur usage across Customer Web.
- Confirmed that stem direction, beam direction, tie orientation, and slur
  placement are notation controls anchored to musical objects or relationships,
  not core `PitchedEvent` identity.
- Added a small editor-domain notation model with:
  - event notation controls for stem direction;
  - tie notation controls for tie placement;
  - slur notation controls for slur placement;
  - beam notation controls for beam membership and direction.
- Updated the Inspector's transitional `notation.stemDirection` supplement to
  use the domain `StemDirection` type instead of deriving the type from the UI
  editable-event shape.
- Updated ADR 0007 and the editor-domain refactoring plan with the notation
  layer decision.

REC-007 should continue by wiring notation controls only where behavior is
already covered. The next safe step is to keep `stemDirection` in the Inspector
supplement while adding import/export tests or adapters for notation controls,
rather than moving all beam/tie/slur XML mutation into domain commands in one
large change.

### 2026-08-13: Notation override semantics clarified

- Tightened the notation model terminology from generic stem direction to
  `StemDirectionOverride`.
- `StemDirectionOverride` now matches MusicXML's explicit stem values:
  `up`, `down`, `none`, and `double`.
- Missing notation control state now means automatic engraving; `auto` is not a
  persisted override value.
- Updated the Inspector draft bridge so the current UI's "automatic" stem
  choice maps to a missing notation override, while the legacy writable XML DTO
  still receives `stemDirection: 'none'` to remove the current `<stem>`
  override.
- Updated ADR 0007 and the refactoring plan to distinguish:
  - musical facts and relationships;
  - explicit notation intent/overrides;
  - renderer-computed engraving results.
- Documented that tie/slur/beam existence must remain separate from their
  visual placement or geometry controls.

REC-007 should continue with a narrow stem-direction import/export slice:
prove that missing `<stem>` imports as no override, explicit `up/down/none/double`
imports as notation intent, and exporting without an override does not create a
new `<stem>` element.

### 2026-08-13: Stem direction notation control import/export slice added

- Added `notationControls` to `ScoreDocument`.
- The editor-domain MusicXML importer now converts explicit MusicXML
  `<stem>up</stem>`, `<stem>down</stem>`, `<stem>none</stem>`, and
  `<stem>double</stem>` values into event-level notation controls.
- Missing `<stem>` imports as no notation override.
- The editor-domain MusicXML exporter now writes `<stem>` only when an
  event-level stem notation override exists.
- Chord stem override export is anchored to the root note only.
- Deleting a voice event now removes event-level notation controls anchored to
  that deleted event, preventing dangling notation state.
- Added importer, exporter, notation-model, and command tests for the above
  behavior.

REC-007 should continue by keeping the stem notation slice narrow until the
React editor uses the domain importer/exporter path. The next safe step is to
add a helper for reading/updating event-level notation controls in
`editor-domain` commands, instead of manually editing `notationControls` arrays
from future UI code.

### 2026-08-13: Event stem notation command helper added

- Added `setEventStemDirectionOverride` to the editor-domain command layer.
- The helper:
  - validates that the target event exists;
  - sets a new event-level stem override;
  - replaces an existing event-level stem override for the same event;
  - clears the override when called without `stemDirection`.
- Added command tests for set, replace, clear, and missing-event rejection.
- This keeps future UI or adapter code from hand-mutating the
  `notationControls` array and preserves the rule that missing override means
  automatic engraving.

REC-007 should continue by adding the read-side companion helper for
event-level notation controls, then deciding when the transitional Inspector
stem supplement should call the command helper instead of projecting through
legacy `WritableEntity`.

### 2026-08-13: Event notation read helpers added

- Added `getEventNotationControl` and `getEventStemDirectionOverride` to the
  editor-domain notation model.
- Updated the editor-domain MusicXML exporter to read event-level stem
  overrides through the shared notation helper instead of scanning
  `notationControls` locally.
- Added notation-model tests for event notation and stem override reads.
- Kept the command write helper implementation simple and local; replacing its
  clear/set filter with another abstraction would not improve readability yet.

REC-007 should continue by deciding whether the transitional Inspector stem
supplement should remain a bridge-only concern or start using the domain
notation command helper in a test-only domain command path before React is
rewired to the domain exporter.

### 2026-08-13: Stem notation command-to-export contract locked

- Added a domain exporter contract test that applies
  `setEventStemDirectionOverride`, exports the resulting document to MusicXML,
  and verifies that `<stem>` is emitted.
- The same test clears the override through the command helper and verifies
  that exporting no longer emits `<stem>`.
- This proves the first notation-control vertical slice now has a domain command
  write path and an exporter read path without React or legacy XML mutation
  involvement.

REC-007 should continue by adding a matching import-to-command/export
round-trip for stem overrides only if it reveals useful behavior. Otherwise,
the next higher-value slice is to prepare the transitional Inspector stem
supplement to map to the domain notation command once the React editor can work
against `ScoreDocument`.

### 2026-08-13: Editor-domain test fixture builder added

- Added a small editor-domain test fixture helper for constructing the standard
  single-part, single-staff, single-voice `ScoreDocument` used by command and
  inspector draft tests.
- Migrated `commands.test.ts` and `inspector-drafts.test.ts` away from local
  repeated document builders.
- The fixture intentionally stays test-focused and is not exported as part of
  the production editor-domain public API.

REC-007 should continue by using this helper only where it removes obvious
`ScoreDocument` boilerplate. Do not turn it into a broad test factory layer
unless future tests repeatedly need richer score topologies.

### 2026-08-13: Inspector stem notation transition boundary narrowed

- Rechecked the current React Inspector boundary against the new
  `editor-domain` notation command layer.
- Confirmed the Inspector still edits through transitional parsed-event /
  MusicXML mutation state, not a full `ScoreDocument`, so directly calling
  `setEventStemDirectionOverride` here would create a fake domain update path.
- Renamed the Inspector state supplement from generic `notation` to
  `notationOverrides`.
- Narrowed the current Inspector-writable stem override type to `up | down`;
  missing override means automatic engraving. MusicXML `none` / `double` remain
  import/export notation values until the UI can represent them deliberately.
- Renamed the save adapter's stem-only argument to
  `notationOverrides`, avoiding the misleading implication that a full editor
  event is being passed.
- Added coverage that the Inspector's automatic stem choice is stored as a
  missing notation override while still projecting `stemDirection: 'none'` to
  the legacy XML updater so old `<stem>` overrides are removed.

REC-007 should continue by moving the React editor toward a real `ScoreDocument`
state source before wiring Inspector notation changes to
`setEventStemDirectionOverride`. Until then, keep this bridge explicit and do
not add compatibility aliases or fake domain documents.

### 2026-08-13: Read-only editor-domain document hook added

- Added `useEditorDomainDocument` as a read-only React hook that derives a real
  editor-domain `ScoreDocument` from the current MusicXML string.
- Added `deriveEditorDomainDocument` as a pure helper so the transition can be
  tested without React context.
- The hook exposes `{ document, gaps, error }` and does not fall back to legacy
  `ScoreData` when domain import fails.
- Re-exported the hook from the editor provider boundary for future editor
  integrations.
- Added coverage for successful XML import, parser error exposure, and hook
  refresh when `currentXml` changes.

REC-007 should continue by using this read-only domain source in one narrow
React integration point. The safest next candidate is an Inspector lookup helper
that resolves the currently edited legacy entity id to its matching domain
`VoiceEvent`, without changing save behavior yet.

### 2026-08-13: Editing legacy entity can resolve to domain voice event

- Added editor-domain source lookup helpers that find a `VoiceEvent` by the
  MusicXML element ids represented by that event.
- The source lookup stays inside `editor-domain` and does not import legacy
  `ParsedScoreEvent` or UI types.
- Added `useEditingDomainEvent`, a read-only React hook that maps the current
  legacy `editingEntity.meta.sourceIds` / `meta.id` to the matching domain
  `VoiceEvent` from `useEditorDomainDocument`.
- Re-exported the hook from the editor provider boundary for future Inspector
  integrations.
- Added coverage for pitched/chord source-id lookup, missing document behavior,
  and resolving the currently edited legacy chord to a real domain pitched
  event.
- Save behavior is unchanged; this is a read-side migration seam only.

REC-007 should continue by consuming `useEditingDomainEvent` in the Inspector as
diagnostic/read-side state first, for example deriving the domain Inspector view
model next to the existing legacy editable UI state. Do not replace save
behavior until the UI can edit against domain drafts directly.

### 2026-08-13: Inspector consumes domain view model read-side

- Added `useEditingDomainInspectorViewModel`, which derives the editor-domain
  Inspector view model for the currently edited legacy entity.
- The hook builds on the read-only `useEditingDomainEvent` bridge and keeps
  save behavior unchanged.
- The React Inspector now consumes this domain view model as invisible
  diagnostic state via `data-domain-inspector-*` attributes.
- Added hook coverage for deriving an explicit-rest domain Inspector view model
  from the currently edited legacy entity.
- This proves the Inspector can read the real domain model next to its legacy
  UI state without introducing fake `ScoreDocument` writes or compatibility
  aliases.

REC-007 should continue by comparing the legacy editable Inspector state with
the domain Inspector view model in a pure adapter test. Once the two views are
provably equivalent for note/chord/rest basics, the UI can start rendering from
the domain view model instead of `EditableEvent`.

### 2026-08-13: Domain Inspector view model equivalence adapter added

- Added a component-boundary adapter that projects a domain
  `InspectorViewModel` into the current legacy `EditableEvent` UI shape for
  note, chord, and explicit-rest basics.
- Kept this adapter outside `editor-domain` because it intentionally depends on
  the transitional Inspector UI shape.
- Added an equivalence status helper returning `matched`, `mismatched`, or
  `unavailable`.
- Updated the React Inspector diagnostic attributes to report whether the
  current legacy editable state matches the read-only domain projection.
- Added tests for single-note, chord, rest, and mismatch detection.
- Save behavior remains unchanged.

REC-007 should continue by using the domain projection to replace one narrow
Inspector render input at a time, starting with read-only summary fields rather
than editable controls. Editable controls should move later, after save writes
can target the domain command/export path.

### 2026-08-13: Inspector read-only summary fields moved to domain projection

- Added editable-event summary helpers for pitch text and summary icon.
- Removed the old parsed-event summary helpers from the Inspector event model.
- The Inspector summary now reads event type, pitch summary, icon, and duration
  summary from the domain Inspector projection when it is available.
- Editable controls and save behavior still use the existing Inspector edit
  state; this step only moves read-only summary inputs.
- Kept the domain projection adapter at the component boundary because it
  intentionally maps domain view models to the transitional `EditableEvent`
  shape.
- Added coverage for the new summary helpers and preserved the domain/legacy
  projection equivalence tests.

REC-007 should continue by moving another read-only Inspector section to domain
input only if it has a crisp boundary. The next safe candidate is the selection
metadata display, using domain `position`, `voiceId`, and `staffId` for read
side only while leaving connection and beam editing on the legacy XML path.

### 2026-08-13: Inspector selection metadata reads from domain summary

- Added a domain selection summary adapter that derives display metadata from
  domain Inspector view models:
  - measure number from `position.measureId` / `start.measureId`;
  - voice number from `voiceId`;
  - staff index from `staffId`.
- The Inspector now uses this domain-derived measure and voice summary when the
  domain view model is available.
- Legacy `editingEntity.meta` remains a read-only display fallback when the
  domain view model is unavailable.
- Added diagnostic `data-domain-inspector-staff-index` so staff migration can be
  inspected without adding new UI copy yet.
- Editable controls, connection editing, beam editing, and save behavior remain
  on the existing legacy XML path.
- Added tests for normal domain ids and fallback parsing defaults.

REC-007 should continue by identifying the next read-only Inspector section
with a clean domain source. Avoid migrating connection or beam controls until
their domain models and write commands exist; those are notation/relationship
concerns, not simple event summary fields.

### 2026-08-13: Inspector remaining legacy areas classified

- Rechecked `event-inspector.tsx` after the read-side domain projection work.
- Updated the editor-domain refactoring plan with an Inspector migration
  checkpoint table.
- Confirmed the following areas are now read-side migrated when a domain view
  model is available:
  - event type label;
  - pitch summary;
  - summary icon;
  - duration summary;
  - measure / voice display metadata.
- Confirmed the following areas should not be migrated yet because they still
  require domain command/exporter or relationship/notation-control write models:
  - pitch, accidental, fingering, duration, dotted, and stem editable controls;
  - beam controls;
  - tie/slur lists and placement controls;
  - connection endpoint navigation;
  - save/delete/add XML mutation paths.
- This checkpoint prevents premature migration of direct MusicXML mutation
  behavior into fake domain state.

REC-007 should continue outside Inspector controls unless a domain write path is
available. The next higher-value target is render-id-to-domain-anchor selection:
replace another small piece of `ParsedEventSelection`/Verovio lookup with
domain anchors, then use that anchor path to feed Inspector and preview
selection consistently.

### 2026-08-13: Source-id render anchor bridge added

- Added `createSourceRenderAnchorsFromDocument` to build domain render anchors
  from `ScoreDocument` source ids.
- Added `resolveDomainAnchorFromRenderOrSourceId` so a Verovio/source id can be
  resolved to a domain anchor without legacy `ScoreData`.
- Pitched note source ids resolve precisely to `noteAtom` anchors while still
  allowing the same source id to be queried for its event anchor.
- Explicit rest source ids resolve to event anchors.
- Event-level fallback anchors are created only for source ids not already
  owned by note atoms, avoiding duplicate anchor entries.
- Updated the editor-domain refactoring plan with a selection migration
  checkpoint.
- The preview click path still uses `ParsedEventSelection`; this step only adds
  the domain read-side bridge and tests.

REC-007 should continue by adding a React hook that builds source render anchors
from `useEditorDomainDocument`, then consuming that hook diagnostically in
`editor-preview-panel.tsx` before replacing any click behavior.

### 2026-08-13: Preview consumes domain render anchors diagnostically

- Added `useEditorDomainRenderAnchors`, which derives source render anchors
  from the current editor-domain `ScoreDocument`.
- The hook exposes the anchor list, domain import error, and a resolver for
  render/source ids.
- Re-exported the hook from the editor provider boundary.
- `editor-preview-panel.tsx` now consumes the hook diagnostically:
  - exposes `data-domain-anchor-count`;
  - exposes `data-domain-anchor-error`;
  - records the last resolved `data-domain-anchor-kind` on click / hover.
- Existing preview behavior still uses `ParsedEventSelection` and legacy
  `findParsedScoreEventByRenderId`; no click/add/delete/tie/slur behavior was
  replaced in this step.
- Added hook tests for successful anchor derivation and XML import error
  exposure.

REC-007 should continue by replacing one low-risk preview branch with the
domain anchor path. The safest candidate is select-mode diagnostics or
event-level edit selection resolution; avoid add-mode placement and
tie/slur/beam actions until gap/caret and relationship anchors are ready.

### 2026-08-13: Parsed event selection carries domain anchor companion

- Extended the transitional `ParsedEventSelection` with `domainAnchor`.
- `toParsedEventSelection` now accepts an optional domain anchor companion while
  still returning `null` for missing legacy hits.
- `editor-preview-panel.tsx` resolves the domain anchor from the same render id
  used by the legacy parsed-event lookup and attaches it to the selection.
- Existing preview behavior remains legacy-driven:
  - edit still calls `handleEditEntity(selection.event, selection.location)`;
  - delete/add/tie/slur branches still use legacy event/location data.
- Updated tests to prove the domain anchor is attached without replacing the
  legacy selection payload.

REC-007 should continue by replacing the select/edit branch only after a small
adapter can turn `DomainAnchor(event | noteAtom)` back into the currently needed
Inspector input. Do not migrate add placement or tie/slur operations yet.

### 2026-08-13: Domain anchor to Inspector companion adapter added

- Added `createDomainSelectionCompanion` under the legacy editor adapter layer.
- The adapter takes a `ScoreDocument` and a `DomainAnchor`, then derives the
  matching domain Inspector view model through the existing domain selection and
  Inspector view-model helpers.
- Event anchors produce event Inspector companions.
- Note-atom anchors produce note-atom Inspector companions.
- Structural anchors such as measure/staff do not manufacture fake Inspector
  inputs.
- The adapter intentionally lives outside `editor-domain` because it is a
  transition bridge for current preview/Inspector integration.
- Preview behavior remains unchanged; `handleEditEntity(selection.event,
  selection.location)` is still the active select/edit path.

REC-007 should continue by consuming this companion diagnostically in
`editor-preview-panel.tsx` for select/edit clicks. After that diagnostic is
stable, the edit branch can be changed to prefer domain selection/view-model
input.

### 2026-08-13: Preview select/edit path consumes domain companion diagnostically

- Extended `useEditorDomainRenderAnchors` to expose the current derived
  `ScoreDocument`, avoiding duplicate MusicXML domain imports in preview.
- `editor-preview-panel.tsx` now creates a `DomainSelectionCompanion` during
  score click handling from the same `ParsedEventSelection.domainAnchor`.
- Added diagnostic `data-domain-companion-kind` to the preview wrapper.
- Existing behavior still calls `handleEditEntity(selection.event,
  selection.location)` and keeps add/delete/tie/slur branches on the legacy
  selection payload.
- Updated surface migration coverage to lock this dual-read selection path.

REC-007 should continue by validating domain companion parity for selected
events. The next safe step is a pure adapter that can compare the legacy
selection's event/location with the companion's domain Inspector view model,
then report whether select/edit is ready to switch.

### 2026-08-13: Legacy/domain selection parity adapter added

- Added `getDomainSelectionParityStatus` to compare a legacy
  `ParsedEventSelection` with a `DomainSelectionCompanion`.
- The parity check reports `matched`, `mismatched`, or `unavailable`.
- Covered parity for:
  - legacy rest selection vs explicit-rest domain view model;
  - legacy chord selection vs pitched-event domain view model;
  - clicked chord member vs note-atom domain view model;
  - mismatched pitch/location;
  - missing selection or companion.
- `editor-preview-panel.tsx` now exposes diagnostic
  `data-domain-selection-parity` on click.
- Preview behavior still uses the legacy selection payload for all actions.

REC-007 should continue by observing or testing that select/edit clicks produce
`matched` parity in normal fixtures. After that, the select/edit branch can
start preferring domain companion input while retaining legacy payload only for
the still-legacy Inspector save path.

### 2026-08-13: Preview select/edit transition adapter added

- Added `createSelectEditSelection` under `apps/customer-web/src/lib/editor/`.
- The adapter combines the transitional `ParsedEventSelection` and
  `DomainSelectionCompanion` into one select/edit input.
- It preserves the current legacy `event` and `location` payload required by
  `handleEditEntity`, while carrying the domain companion and
  legacy/domain parity beside it.
- `editor-preview-panel.tsx` now uses this adapter for the ordinary select/edit
  branch and reports companion kind/parity through the adapter result.
- Add, delete, tie, and slur branches intentionally remain on the existing
  legacy selection payload.
- Added focused adapter tests and updated surface migration coverage.

REC-007 should continue by moving the editor open/selection state one step
closer to domain input: either store the select/edit domain companion alongside
the current `editingEntity`, or introduce a narrow Inspector-open adapter that
can read the domain companion first while the save path still projects through
the legacy XML mutation helpers. Do not migrate add placement or connection
commands until gap/caret and note-atom command semantics are explicit.

### 2026-08-13: Editor state carries select/edit domain companion

- Added `editingDomainCompanion` to the Customer Web editor state context.
- Added `handleSelectEditSelection` to `useEntityEditor` so the ordinary
  preview select/edit branch can open the Inspector with both:
  - the legacy event/location still required by `handleEditEntity`-era XML
    mutation; and
  - the domain Inspector companion derived from the clicked domain anchor.
- `useEditingDomainInspectorViewModel` now prefers the stored selection
  companion when available and reports its source as `selectionCompanion`.
- Legacy edit opens, insertions, saves, closes, and history refreshes clear the
  stored companion. After those operations the Inspector returns to the existing
  document lookup source instead of reusing stale click-time domain state.
- Added Inspector hook coverage for both `documentLookup` and
  `selectionCompanion` sources.
- Preview add/delete/tie/slur behavior remains unchanged.

REC-007 should continue by using the companion-backed Inspector view model for
one more narrow read-side surface or by introducing a typed Inspector-open input
that groups legacy payload plus domain companion. Do not move save/update/delete
to domain writes until the command/exporter path can replace the current XML
mutation helpers end-to-end.

### 2026-08-13: Inspector editing state grouped behind `editingSelection`

- Replaced three independent React state cells for the current Inspector-open
  event with one grouped `editingSelection` state object in
  `editor-state-context.tsx`.
- `editingSelection` groups:
  - the legacy event still needed by existing Inspector and XML mutation code;
  - the legacy location still needed by existing mutation helpers; and
  - the optional domain companion created by the select/edit domain anchor
    bridge.
- Existing context fields `editingEntity`, `editingEntityLocation`, and
  `editingDomainCompanion` are now derived from the grouped state while callers
  are migrated incrementally.
- A domain companion can no longer exist as detached editor state without a
  selected legacy event.
- Updated the companion-source hook test to reflect that invariant.

REC-007 should continue by migrating internal callers to the grouped
`editingSelection` shape where it improves clarity. Avoid a broad mechanical
rename; the next useful cut is a small helper around opening/clearing Inspector
state so callers stop setting entity, location, and companion separately.

### 2026-08-13: Inspector editing-state write API narrowed

- Added explicit `openEditingSelection` and `clearEditingSelection` entrypoints
  to the editor state context.
- Migrated `useEntityEditor` and `useHistoryEditor` to those grouped write
  entrypoints.
- Updated related hook tests to use `openEditingSelection` instead of setting
  individual editing fields.
- Removed the old public context setters:
  - `setEditingEntity`;
  - `setEditingEntityLocation`;
  - `setEditingDomainCompanion`.
- Existing `editingEntity`, `editingEntityLocation`, and
  `editingDomainCompanion` remain derived read fields for legacy consumers, but
  state writes now have one explicit boundary.

REC-007 should continue by moving read consumers that naturally need all three
values from separate derived fields to `editingSelection`. Do this only where it
improves readability; avoid a repository-wide mechanical rename that obscures
the still-legacy XML mutation path.

### 2026-08-13: Inspector read paths consume grouped editing selection

- Migrated the top-level `EventInspector` open/read boundary to read
  `editingSelection` and derive its panel legacy event from
  `editingSelection.legacyEvent`.
- Migrated `useEditingDomainEvent` and
  `useEditingDomainInspectorViewModel` to read from `editingSelection`:
  - document lookup uses `editingSelection.legacyEvent`;
  - companion-backed Inspector projection uses
    `editingSelection.domainCompanion`.
- Removed the now-unused `editingDomainCompanion` derived context field; domain
  companion state is available only through the grouped editing selection.
- Left `editingEntity` and `editingEntityLocation` derived fields in place
  because preview highlighting, history refresh, and legacy XML mutation still
  use those legacy read paths.

REC-007 should continue by reviewing whether `useEntityEditor` should consume
`editingSelection` directly for update operations, or whether it is clearer to
leave `editingEntityLocation` as a legacy mutation-boundary read until the XML
mutation path is replaced. Do not migrate connection or add placement branches
yet.

### 2026-08-13: Entity editor update path reads grouped legacy mutation location

- Updated `useEntityEditor` so `updateEntity` reads the current update target
  from `editingSelection.legacyLocation`.
- Named the local value `legacyMutationLocation` to make the remaining XML
  mutation boundary explicit.
- Removed the now-unused `editingEntityLocation` derived context field and the
  matching `useEntityEditor` return value.
- Remaining `editingEntityLocation` identifiers are scoped to lower-level
  mutation helper parameter names and tests, where they still accurately
  describe the legacy XML group lookup input.

REC-007 should continue by reviewing the last derived legacy state read,
`editingEntity`, in preview highlighting and history refresh. Keep it if it is
clearer as a legacy read alias; migrate it only if the target consumer benefits
from the grouped `editingSelection` semantics.

### 2026-08-13: History refresh reads grouped editing selection

- Updated `useHistoryEditor` so undo/redo refresh uses
  `editingSelection.legacyEvent` instead of the derived `editingEntity` context
  field.
- Left preview highlighting on `editingEntity` because it only needs legacy
  event metadata for selected SVG highlighting.
- Removed the unused `editingEntity` return from `useEntityEditor`, making that
  hook an action-only editor mutation/opening hook rather than a duplicate
  state source.

REC-007 should continue by deciding whether preview highlighting should read
`editingSelection` directly. If it remains purely a legacy render/highlight
adapter, keeping the derived `editingEntity` read alias is acceptable until the
preview selection path is fully domain-backed.

### 2026-08-13: Final derived editor-state legacy alias removed

- Updated `editor-preview-panel.tsx` so selected SVG highlighting reads
  `editingSelection.legacyEvent` directly and names the local value
  `selectedLegacyEvent`.
- Removed the final derived `editingEntity` field from the editor state context.
- Updated surface migration coverage to assert the explicit
  `selectedLegacyEvent` highlight path.
- Editor state now exposes one grouped current editing state:
  `editingSelection`, plus explicit grouped write entrypoints.

REC-007 should continue by moving beyond state-shape cleanup. The next useful
target is either:

- a preview/domain selection test fixture that proves normal select/edit clicks
  produce `matched` parity; or
- a narrow Inspector read-side migration that consumes the domain view model
  directly for one editable control display without changing save behavior.

### 2026-08-13: Select/edit parity fixture added

- Added `select-edit-selection-flow.test.ts`.
- The fixture runs a real MusicXML snippet through:
  - the legacy `MusicXMLParser`;
  - the editor-domain MusicXML importer;
  - source-id render anchor creation;
  - legacy parsed-event hit lookup;
  - domain selection companion creation; and
  - `createSelectEditSelection`.
- Covered a normal single note and a clicked chord member.
- Both fixtures produce `domainParity: matched`, proving the current
  select/edit bridge can align legacy parsed events with domain companions for
  representative real XML inputs.

REC-007 should continue with the second suggested path: a narrow Inspector
read-side migration that consumes the domain view model directly for one
editable-control display, while keeping save behavior on the existing legacy XML
mutation path. Avoid migrating add placement or tie/slur commands until their
domain semantics are explicit.

### 2026-08-13: Inspector editable-control display reads matched domain projection

- Updated `event-inspector.tsx` so pitch, accidental, fingering, duration,
  dotted, and stem-direction control values read from the editor-domain
  Inspector projection when it matches the current transitional edit state.
- Kept a strict fallback to the legacy `EditableEvent` edit state when the
  domain projection is unavailable, mismatched, or errored.
- Added `data-domain-inspector-controls-source` as a diagnostic marker for
  whether the controls are displaying `domainViewModel` or `legacyEditState`.
- Preserved the existing save behavior: all control changes still commit
  through the transitional Inspector edit state and existing XML mutation path.
  This avoids mixing a read-side migration with the larger command/exporter
  rewrite.

REC-007 should continue by avoiding additional Inspector control migration until
the domain command/exporter write path is ready. The next useful target is to
start a small domain command/save slice, or to move another preview/selection
read path to domain anchors only if it removes a real legacy dependency.

### 2026-08-13: Inspector domain edit command slice added

- Added `applyInspectorEdit` to the editor-domain Inspector draft module.
- The helper applies the semantic Inspector draft first, then applies an
  explicitly provided stem-direction notation override through the domain
  notation command.
- It distinguishes omitted notation overrides from an explicit
  `stemDirection: undefined`, so future Inspector saves can preserve or clear
  stem overrides intentionally.
- Tightened `setEventStemDirectionOverride` so stem overrides are valid only for
  pitched events; explicit rests cannot receive fake stem notation state.
- Added tests for:
  - applying rhythm edits and stem notation together;
  - clearing existing stem notation explicitly; and
  - rejecting stem notation on explicit rests.
- React Inspector save behavior is still intentionally not wired to this helper;
  the current UI continues to use the legacy XML mutation path until a mutable
  `ScoreDocument -> export MusicXML -> update current XML` path is introduced.

REC-007 should continue by preparing that React write-path boundary: identify
where a mutable editor-domain `ScoreDocument` can be owned, updated through
`applyInspectorEdit`, exported back to MusicXML, and reconciled with existing
history/preview refresh behavior. Do not wire only stem direction in isolation.

### 2026-08-13: Import-edit-export-reimport Inspector write fixture added

- Added a MusicXML round-trip integration test for the future Inspector domain
  write path:
  `importMusicXmlToEditorDomain -> applyInspectorEdit ->
  exportEditorDomainToMusicXml -> importMusicXmlToEditorDomain`.
- The fixture edits a real imported pitched event's rhythm and stem notation,
  exports MusicXML, then re-imports it to assert that event identity, pitched
  event semantics, rhythm, and stem notation remain stable.
- The new fixture exposed a command-layer bug: partial `updatePitchedEvent`
  patches were spreading `undefined` optional fields over the existing event,
  clearing `voiceId`, `staffId`, and `position`. That made the exporter drop the
  event from the serialized voice.
- Fixed `updatePitchedEvent` and `updateExplicitRest` so omitted patch fields
  preserve the existing domain event state.
- Added direct command coverage for preserving omitted pitched-event identity
  and placement fields while changing rhythm.

REC-007 should continue by preparing the React-side owner for mutable
`ScoreDocument` state. The next safe step is a design/implementation slice that
derives the editable domain document once in provider state, exposes a tested
domain edit callback, and only then considers replacing Inspector save calls.

### 2026-08-13: React domain edit callback boundary prepared

- Added `use-editor-domain-edit.ts`.
- Added the pure `applyEditorDomainEditToXml` boundary:
  - imports current MusicXML into the editor-domain document;
  - applies an Inspector domain edit through `applyInspectorEdit`;
  - exports the edited domain document back to MusicXML;
  - returns a typed success/error result instead of mutating React state.
- Added `useEditorDomainEdit`, which wraps that pure boundary and updates the
  existing editor state mechanisms when called:
  - pushes a history snapshot when XML changes;
  - updates `currentXml` / `currentXmlRef`;
  - reparses XML into legacy `ScoreData` for the still-legacy preview and
    Inspector surfaces.
- Re-exported `useEditorDomainEdit` from the editor provider boundary.
- Added focused coverage for successful edit/export, domain command failure, and
  invalid MusicXML import failure.
- The hook is intentionally not consumed by `event-inspector.tsx` yet. Inspector
  save still uses the legacy XML mutation path until UI-level history, preview
  refresh, and selection reconciliation are covered.

REC-007 should continue with UI-level coverage before switching Inspector
`commitEvent`: mount the editor providers, apply a domain edit through
`useEditorDomainEdit`, and assert current XML, history, and legacy `ScoreData`
refresh together. After that, switch one Inspector save path.

### 2026-08-13: Domain edit callback provider behavior covered

- Expanded `use-editor-domain-edit` coverage from pure XML transformation to a
  provider-level hook test.
- The test mounts the real editor state dependencies used by the hook:
  `ScoreDataProvider`, `HistoryProvider`, and the minimal `next-intl` provider.
- It verifies that applying a domain Inspector edit through
  `useEditorDomainEdit`:
  - updates `currentXml`;
  - updates `currentXmlRef`;
  - pushes the edited XML into history;
  - reparses legacy `ScoreData` so existing preview / Inspector surfaces can
    still render after a domain write.
- It also verifies the no-current-XML error path at the hook boundary.
- The test file was renamed to `.tsx` because it now renders React providers.
- Inspector save is still intentionally not switched to `useEditorDomainEdit`.

REC-007 should continue by designing the selection reconciliation step after a
domain edit. Before replacing `event-inspector.tsx` `commitEvent`, the editor
must know how to reopen / refresh the selected event after domain export and
legacy `ScoreData` reparse without relying on stale legacy entity indexes.

### 2026-08-13: Domain edit selection reconciliation helper added

- Added `findEntityBySourceIds` to `score-lookup.ts`.
- The helper finds a reparsed legacy `ParsedScoreEvent` by MusicXML source ids,
  checking `meta.sourceIds` before falling back to legacy `meta.id`.
- This gives the domain edit path a safer reselection mechanism than stale
  `EntityLocation.entityIndex`, especially after MusicXML export/reparse.
- Extended `useEditorDomainEdit` so callers can pass `reselectSourceIds`.
- On successful edit, the hook now returns `refreshedSelection`, found from the
  reparsed legacy `ScoreData`.
- The pure `applyEditorDomainEditToXml` function still returns
  `refreshedSelection: null` because it intentionally has no legacy `ScoreData`
  context.
- Added tests for:
  - source-id lookup, including chord-member source ids;
  - source-id precedence over legacy ids;
  - hook-level reselection after a domain Inspector edit.

REC-007 can now move to a narrowly scoped Inspector save-path switch. Start with
pitched event rhythm/stem edits only, pass the current entity source ids into
`useEditorDomainEdit`, and reopen the Inspector from `refreshedSelection`.
Keep add/delete/tie/slur/beam paths on legacy mutation for now.

### 2026-08-13: First Inspector save path switched to domain edit

- Updated `event-inspector.tsx` so matched pitched-event rhythm, dotted, and
  stem-direction edits use `useEditorDomainEdit`.
- The migrated path:
  - retargets the Inspector draft to the current domain Inspector view model's
    `eventId` instead of using the legacy MusicXML source id from
    `editingEntity.meta.id`;
  - passes the legacy entity's source ids as `reselectSourceIds`;
  - reopens the Inspector from `refreshedSelection` after domain export and
    legacy `ScoreData` reparse.
- Domain save is intentionally guarded by:
  - `domainInspectorStatus === 'matched'`;
  - a pitched domain Inspector view model;
  - available legacy source ids; and
  - `isRhythmOrStemOnlyPitchedEdit`.
- Added `isRhythmOrStemOnlyPitchedEdit` to the Inspector event-model helper
  layer with tests. Pitch, accidental, fingering, add-pitch, remove-pitch, rest,
  add/delete/tie/slur/beam paths do not enter this migrated domain save path.
- If the domain save fails, the Inspector now reports the domain error instead
  of silently hiding it behind the old XML mutation path.

REC-007 should continue by observing this first migrated save slice under a
browser/editor interaction test before migrating pitch/note-atom edits. The next
safe implementation target is not add/delete or connections; it is one note-atom
field edit, after the domain write helper can preserve the selected note atom
and refreshed legacy selection.

### 2026-08-13: Inspector domain save slice covered by component interaction

- Added `event-inspector-domain-save.test.tsx`.
- The test mounts the real `EventInspector` under the editor providers and
  `next-intl`, opens a parsed note selection, clicks the stem-down control, and
  asserts that:
  - MusicXML contains the exported `<stem>down</stem>`;
  - history points at the edited XML;
  - Inspector remains open;
  - the selected legacy event is refreshed by source id;
  - legacy `ScoreData` is reparsed with the updated stem direction.
- The test exposed an important transition bug: the first implementation
  retargeted only the draft `eventId` but still carried legacy
  voice/staff/position metadata into the domain command. That moved the domain
  event to non-existent legacy ids and produced an empty exported measure.
- Fixed the component save bridge so this first migrated domain save slice
  sends only the safe rhythm patch plus notation override to the domain event.
  Voice, staff, position, and note atoms stay owned by the imported domain event
  until their UI edit semantics are migrated explicitly.

REC-007 should continue by keeping this first save slice stable. The next safe
target is a note-atom field edit such as fingering, but only after adding a
domain write bridge that retargets both the domain event id and the selected
note-atom id from source ids. Do not reuse legacy placement metadata.

### 2026-08-13: Note-atom source retargeting prepared for fingering migration

- Extended editor-domain source lookup with `findNoteAtomByMusicXmlElementId`.
- The helper returns the exact domain pitched event and note atom represented by
  a MusicXML source id.
- Added coverage for chord-member note lookup, rest-source rejection, missing
  ids, and empty ids.
- Extended `applyEditorDomainEditToXml` and `useEditorDomainEdit` with
  `retargetNoteAtomSourceId`.
- When a note-atom Inspector draft is passed with this source id, the domain edit
  boundary retargets both:
  - `eventId` to the imported domain pitched event; and
  - `noteAtomId` to the matching imported note atom.
- Added pure XML and provider-level tests proving a chord-member fingering edit
  updates only the selected note atom and refreshes the legacy chord selection by
  source ids.
- `event-inspector.tsx` does not consume this path yet; current Inspector
  fingering edits still use legacy XML mutation.

REC-007 can now migrate a narrow Inspector fingering save path. Keep it limited
to existing pitched note atoms with source ids; do not combine it with pitch,
accidental, add-pitch, or remove-pitch migration.

### 2026-08-13: Inspector fingering save path switched to domain edit

- Added `getFingeringOnlyPitchedEdit` to the Inspector event-model helper layer.
- The helper only matches a single fingering change on an existing pitched
  event; pitch, accidental, rhythm, stem, add-pitch, remove-pitch, and multi-note
  fingering changes do not enter this path.
- Updated `event-inspector.tsx` so matched fingering-only edits use
  `useEditorDomainEdit` with:
  - a retargetable note-atom draft;
  - `retargetNoteAtomSourceId` from the edited legacy source id; and
  - `reselectSourceIds` for refreshing the legacy chord/note selection.
- Preserved legacy XML mutation fallback for fingering edits without source ids
  or without a matched domain Inspector projection.
- Added component interaction coverage for chord-member fingering:
  - open a real parsed chord in the Inspector;
  - change the second note's fingering through the UI;
  - assert exported MusicXML contains the fingering;
  - assert history, Inspector-open state, refreshed legacy selection, and
    reparsed legacy `ScoreData` all reflect the change.
- Kept pitch, accidental, add-pitch, remove-pitch, add/delete, tie/slur, and beam
  paths on legacy mutation.

REC-007 should continue with accidental only if its clear/set semantics are
covered at the domain boundary first. Do not migrate pitch or add/remove pitch
before note-atom identity and chord shape behavior have stronger interaction
coverage.

### 2026-08-13: Accidental domain boundary semantics covered

- Added command-level coverage for note-atom accidental patches:
  - omitted `accidental` preserves the current accidental;
  - `accidental: null` explicitly clears it;
  - a concrete accidental value sets the displayed accidental.
- Added retargeted domain-edit coverage for setting and clearing accidentals by
  legacy MusicXML source id.
- Confirmed an important boundary distinction: a domain accidental patch changes
  the displayed accidental field only. It does not automatically rewrite
  `pitch.alter`.
- This differs from the current Inspector UI accidental button behavior, which
  changes both the legacy pitch spelling and the explicit accidental value.

REC-007 should not switch the accidental UI directly to accidental-only domain
patches. The next safe step is a pure adapter that converts the current
Inspector accidental button semantics into a domain note-atom patch containing
both `pitch` and `accidental`, then tests set and clear behavior before touching
`event-inspector.tsx`.

### 2026-08-13: Accidental UI-to-domain patch adapter added

- Added `getAccidentalOnlyPitchedEdit` to the Inspector event-model helper
  layer.
- The helper converts the current Inspector accidental-button semantics into a
  domain note-atom patch containing both:
  - `pitch`, including the correct `alter`; and
  - displayed `accidental`, including explicit `natural` or `null` clear.
- Added coverage for:
  - setting sharp;
  - setting flat;
  - setting natural as explicit natural with unaltered pitch;
  - clicking the active accidental again to clear both displayed accidental and
    pitch alter;
  - rejecting migration when fingering, rhythm, or chord shape also changes.
- Added domain edit boundary coverage proving combined `pitch + accidental`
  patches retargeted by source id export and re-import correctly.
- `event-inspector.tsx` still does not consume this accidental path; the current
  UI accidental buttons remain on legacy XML mutation until the component save
  path is switched under interaction coverage.

REC-007 can now migrate the accidental Inspector save path in one narrow slice:
matched pitched event, one existing note atom with source id, accidental-only UI
delta, combined `pitch + accidental` domain patch, source-id reselection. Keep
pitch name/octave edits and add/remove pitch on legacy mutation.

### 2026-08-13: Accidental Inspector UI save path migrated

- Updated `event-inspector.tsx` so matched accidental-only edits on an existing
  pitched note atom use `useEditorDomainEdit` instead of the legacy XML mutation
  path.
- The migrated path uses:
  - `getAccidentalOnlyPitchedEdit` to detect the narrow UI delta;
  - the edited legacy MusicXML source id as `retargetNoteAtomSourceId`;
  - a combined domain note-atom patch containing both `pitch` and `accidental`;
  - `reselectSourceIds` to refresh the open Inspector selection after export and
    reparse.
- Added component interaction coverage for a chord member:
  - setting sharp writes both `<alter>1</alter>` and
    `<accidental>sharp</accidental>`;
  - clicking the active sharp button again clears both pitch alter and displayed
    accidental;
  - history, Inspector-open state, refreshed legacy selection, and reparsed
    `ScoreData` stay synchronized.
- Pitch name/octave edits, add/remove pitch, add/delete entity, tie/slur, and
  beam paths remain on legacy mutation.

REC-007 should continue with behavior-backed, narrow slices only. The next
candidate is either duration/dotted component interaction coverage for the
already-migrated rhythm path, or a small readability cleanup inside
`event-inspector.tsx` if the repeated domain-save result handling starts hiding
intent. Avoid migrating pitch shape changes until chord identity and note-atom
add/remove semantics are explicit.

### 2026-08-13: Rhythm Inspector UI domain-save coverage completed

- Expanded `event-inspector-domain-save.test.tsx` so the already-migrated
  pitched rhythm save path is covered by real UI interaction, not only the stem
  direction button.
- The new fixture changes a selected note from quarter to half, toggles dotted,
  and asserts:
  - exported MusicXML contains `<type>half</type>` and `<dot/>`;
  - history points at the edited XML;
  - Inspector remains open;
  - the refreshed selected legacy event and reparsed `ScoreData` both report
    `durationHalf` and `dotted: true`.
- This closes the current interaction coverage gap for the rhythm/dotted/stem
  domain save slice.

REC-007 can now either keep migrating another narrow, behavior-backed save path
or do a local readability pass over `event-inspector.tsx`. The highest-risk
remaining save paths are still pitch name/octave and add/remove pitch; keep them
legacy until note-atom identity, chord shape, and final-pitch deletion semantics
are explicit.

### 2026-08-13: Inspector domain-save result handling deduplicated locally

- Extracted the repeated domain-save result handling inside `event-inspector.tsx`
  into one local `handleDomainInspectorEditResult` helper.
- The helper only owns the common UI aftermath of a domain save:
  - show the existing destructive toast on failure;
  - reopen the Inspector with `refreshedSelection` on success; or
  - close the Inspector if reselection is unavailable.
- No save-path guard, domain draft shape, retargeting rule, or legacy fallback
  behavior was changed.
- The helper intentionally stays local to `EventInspectorPanel`; it is not a
  shared abstraction because the current duplication is component-specific and
  tightly coupled to Inspector UI state.

REC-007 should continue with one of two useful next slices: either migrate a
small, well-specified domain save path with interaction coverage, or first
document the remaining pitch/chord mutation semantics before touching
pitch-name, octave, add-pitch, or remove-pitch behavior.

### 2026-08-13: Remaining pitch/chord mutation semantics documented

- Added a dedicated "Remaining pitch and chord mutation semantics" section to
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md`.
- Documented the current source facts that matter before further migration:
  - `EditableEvent` still uses parallel `pitches`, `fingerings`, and
    `accidentals` arrays;
  - `addPitch` and `removePitch` are transitional UI DTO operations;
  - final-pitch removal is already blocked in the transitional Inspector;
  - non-empty chord fingering/accidental arrays must remain index-aligned; and
  - the editor-domain command layer already exposes `updateNoteAtom`,
    `addNoteAtom`, and `removeNoteAtom`.
- Set the target semantics for remaining controls:
  - pitch name/octave changes are `updateNoteAtom` pitch patches;
  - add-pitch on an existing pitched event is `addNoteAtom`;
  - remove-pitch from a multi-note pitched event is `removeNoteAtom`;
  - final-pitch removal remains invalid from the pitch-row control;
  - pitched-to-rest conversion must be an explicit command, never a zero-pitch
    side effect.
- Recorded the recommended migration order: existing note-atom pitch patch
  first, then add note-atom id-generation policy, then add-pitch, then
  remove-pitch, with final-pitch delete/replace reserved for a separate product
  decision.

REC-007 should continue by migrating pitch name/octave for an existing note atom
only. Keep add-pitch and remove-pitch untouched until stable new-note-atom id and
source-id generation semantics are implemented and covered.

### 2026-08-13: Rhythmic input model and write-path invariants added

- Updated ADR 0007 with additional invariants:
  - MusicXML import uses a document-order serialization cursor; voice identity
    and XML cursor state are separate dimensions.
  - Every editing behavior has exactly one authoritative write path during
    migration: legacy XML mutation or domain command/export, never both with a
    merge.
  - Empty musical time remains caret/gap/derived-rest selection, not a persisted
    `TimelineGapEntity` or renamed `Blank`.
  - Rhythmic input placement is first-class editor state, separate from
    MusicXML `<forward>` and Verovio space DOM elements.
- Updated the editor-domain plan with Phase 4B: rhythmic input and empty-space
  placement.
- Phase 4B defines:
  - `ActiveVoice`;
  - `Caret`;
  - `RhythmicGridResolution`;
  - `InputDuration`;
  - `InsertionAnchor`;
  - `RhythmicLayoutMap`.
- Added invariants that empty voice insertion must work without an existing
  rendered note/rest/space element, and that `InputDuration` is independent from
  grid resolution.
- Tightened MusicXML exporter wording so forward/backup generation is owned by a
  measure-level serialization plan, not by the domain model.
- Adjusted notation wording from narrow "beam direction" language to broader
  beam notation/grouping override language.
- Updated acceptance criteria and the recommended next implementation task so
  Phase 4B pure types/tests come before deeper empty-space insertion migration.

REC-007 should continue by implementing the Phase 4B pure model first:
`ActiveVoice`, `Caret`, `RhythmicGridResolution`, `InputDuration`, and
`InsertionAnchor`, with tests. Do not wire preview UI or pitch/add/remove
behavior until those placement primitives are explicit.

### 2026-08-13: Add mode mature target added to REC-007 plan

- Added an "Add mode target migration" subsection under Phase 4B in
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md`.
- Documented the current add-mode implementation:
  - preview click resolves staff/voice from active track plus pointer location;
  - `getVisualInsertPlacement` derives slots from already-rendered event
    anchors;
  - beat-level `snapMeasureXToGridTick` is only a fallback;
  - fully empty staff/voice insertion falls back to measure-left tick `0`;
  - `handleAddEntity` inserts a hard-coded quarter explicit rest and then opens
    the Inspector.
- Recorded the mature target:
  - explicit `activeVoice`, `inputDuration`, `rhythmicGridResolution`, `caret`,
    and hovered `InsertionAnchor` state;
  - pointer/caret snapping through `RhythmicLayoutMap`;
  - independent input duration and grid resolution;
  - empty voice insertion from meter/grid/active voice rather than existing
    Verovio note/space DOM elements;
  - explicit domain add commands instead of editing MusicXML `<forward>` or
    inserting a temporary quarter rest as the only add behavior.
- Added an eight-step migration sequence from pure types/tests through UI state,
  add command replacement, domain command/export write path, and deletion of the
  transitional visual-placement fallback.

REC-007 should continue by implementing the Phase 4B pure types/tests first.
The add-mode UI should not be rewired until the caret/grid/insertion-anchor
model is executable.

### 2026-08-13: Phase 4B rhythmic input pure model added

- Added `apps/customer-web/src/lib/editor-domain/rhythmic-input.ts`.
- Exported the module through the `editor-domain` barrel.
- Added pure, UI-free types and helpers for:
  - `ActiveVoice`;
  - `Caret`;
  - `RhythmicGridResolution`;
  - `InputDuration`;
  - `InsertionAnchor`;
  - legal grid-position enumeration;
  - caret movement by grid steps.
- Added `rhythmic-input.test.ts` coverage proving:
  - active voice is user/editing context, not MusicXML cursor state;
  - `InputDuration` remains independent from `RhythmicGridResolution`;
  - caret movement follows grid steps and clamps to measure bounds;
  - legal positions can be enumerated for an empty voice without event DOM
    anchors;
  - insertion anchors can be created from caret and timeline-gap positions;
  - invalid grid, duration, caret, and gap positions are rejected.
- The add-mode UI and legacy insert write path were intentionally not changed.

REC-007 should continue with the next Phase 4B slice: pure snapping helpers and
then `RhythmicLayoutMap` tests with synthetic non-linear spacing. Do not wire
preview UI until those pure boundaries are covered.

### 2026-08-13: Phase 4B rhythmic-grid snapping helpers added

- Extended `apps/customer-web/src/lib/editor-domain/rhythmic-input.ts` with
  pure snapping helpers:
  - `snapOffsetToGrid`;
  - `createCaretAtNearestGridPosition`.
- Tightened `InsertionAnchor.eventEdge.eventId` from plain `string` to domain
  `EventId`.
- Kept snapping independent from Verovio event DOM, `[data-class="space"]`, and
  legacy `ScoreData` visual-placement helpers.
- Preserved the measure end as a legal caret boundary even when the selected
  grid step does not exactly divide the measure duration.
- Added `rhythmic-input.test.ts` coverage for:
  - nearest-grid snapping;
  - deterministic forward tie handling;
  - snapped caret creation without rendered event/space anchors;
  - boundary clamping;
  - non-divisible measure end enumeration.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` to mark the
  pure snapping step complete.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- rhythmic-input architecture-boundaries`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should continue with `RhythmicLayoutMap`: add a pure adapter-side model
and tests that map legal rhythmic grid positions to rendered x coordinates using
synthetic non-linear measure geometry. Keep preview UI and legacy add writes
unchanged until that layout projection is covered.

### 2026-08-13: Phase 4B RhythmicLayoutMap pure projection added

- Added
  `apps/customer-web/src/lib/editor-domain/rhythmic-layout-map.ts`.
- Exported it through the `editor-domain` barrel.
- Added a pure adapter-side `RhythmicLayoutMap` model that:
  - owns rendered measure x bounds for one measure/staff/voice;
  - accepts rendered rhythmic anchors as data rather than reading DOM;
  - enumerates legal rhythmic grid positions from `RhythmicGridResolution`;
  - interpolates missing grid positions between anchors;
  - resolves pointer x to the nearest legal rhythmic layout point;
  - clamps pointer x to rendered measure boundaries.
- Added `rhythmic-layout-map.test.ts` coverage using synthetic non-linear
  geometry. This proves the future add-mode caret does not have to use the old
  linear beat-only fallback and does not need a rendered note/rest/space element
  at the target position.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` to mark the
  layout-map projection test step complete.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- rhythmic-layout-map rhythmic-input architecture-boundaries`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should continue by replacing only the preview-side insertion target
construction in `editor-preview-panel.tsx` with a caret/layout-map result while
leaving the final legacy `handleAddEntity` write path unchanged. This should be
covered by focused tests before deleting `getVisualInsertPlacement` or
`snapMeasureXToGridTick`.

### 2026-08-13: Add-mode preview target construction migrated to rhythmic placement adapter

- Added `apps/customer-web/src/lib/editor/rhythmic-insert-placement.ts` as the
  temporary adapter between Verovio/rendered geometry, legacy `ScoreData`, and
  the new editor-domain rhythmic input model.
- The adapter:
  - resolves domain measure/staff/voice ids from the current `ScoreDocument`;
  - builds a `RhythmicLayoutMap` from rendered onset anchors and measure bounds;
  - supports empty staff/voice placement from measure geometry plus rhythmic
    grid;
  - returns a domain `Caret` and `MusicalPosition`;
  - projects the resolved domain position back to legacy `AddLocation.tick` only
    at the current write boundary.
- Updated `editor-preview-panel.tsx` so add-mode click and mousemove placement
  use `resolveRhythmicInsertPlacement` instead of directly importing
  `getVisualInsertPlacement`, `getTargetStaffHasEvents`, or
  `snapMeasureXToGridTick`.
- Final add writes remain on `handleAddEntity(location)` intentionally; this
  step migrates preview target semantics, not the XML write path.
- Added `rhythmic-insert-placement.test.ts` coverage for:
  - empty-staff insertion at a non-zero rhythmic position;
  - non-linear rendered onset-anchor projection;
  - unresolved domain document/staff/voice returning no placement.
- Updated `verovio-surface-migration.test.ts` so the executable surface test now
  asserts that `editor-preview-panel.tsx` uses the rhythmic placement adapter and
  no longer imports the old visual/tick fallback helpers directly.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- rhythmic-insert-placement rhythmic-layout-map rhythmic-input verovio-surface-migration architecture-boundaries`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue with focused add-mode interaction coverage around the
new preview placement behavior before deleting the old
`visual-insert-placement.ts` and beat-only `snapMeasureXToGridTick` helpers.
After that coverage is stable, migrate `handleAddEntity` away from hard-coded
quarter-rest insertion toward explicit domain add commands with independent
`InputDuration`.

### 2026-08-13: Add-mode rhythmic preview placement covered by component interaction test

- Added
  `apps/customer-web/src/components/editor/editor-preview-panel-add-mode.test.tsx`.
- The test mounts `EditorPreviewPanel` with mocked editor providers and a
  synthetic Verovio-like measure/staff surface.
- Covered the migrated add-mode path through real React events:
  - clicking an empty staff resolves a rhythmic caret from measure geometry and
    calls `handleAddEntity` with projected legacy `AddLocation.tick`;
  - mouse movement over the empty staff renders the insertion caret at the
    `RhythmicLayoutMap` x coordinate.
- This provides behavior coverage for the previous source-level migration:
  `editor-preview-panel.tsx` now exercises `resolveRhythmicInsertPlacement`
  through the component boundary, not just through pure adapter tests.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-preview-panel-add-mode rhythmic-insert-placement`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue by extending add-mode placement coverage to eighth and
sixteenth grid positions or by deleting now-unused legacy placement helpers only
after confirming no production imports remain. The final add write path still
uses `handleAddEntity` and hard-coded quarter-rest insertion, so do not remove
the legacy XML insertion path yet.

### 2026-08-13: Legacy add-mode visual placement helpers deleted

- Deleted `apps/customer-web/src/lib/editor/visual-insert-placement.ts`.
- Deleted its now-obsolete test file
  `apps/customer-web/src/lib/editor/visual-insert-placement.test.ts`.
- Removed `visual-insert-placement` from the `src/lib/editor` barrel export.
- Removed the beat-only `snapMeasureXToGridTick` fallback from
  `apps/customer-web/src/lib/editor/measure-timeline.ts`.
- Updated `measure-timeline.test.ts` so it only covers the duration and
  time-signature helpers that remain used by production code.
- Confirmed with `rg` that production code no longer references:
  - `visual-insert-placement`;
  - `getVisualInsertPlacement`;
  - `getTargetStaffHasEvents`;
  - `snapMeasureXToGridTick`.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` so it no
  longer describes the deleted helpers as active transitional code.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- measure-timeline rhythmic-insert-placement editor-preview-panel-add-mode verovio-surface-migration architecture-boundaries`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue by moving beyond preview placement cleanup. The next
high-value target is the add write path: replace `handleAddEntity`'s hard-coded
quarter explicit-rest insertion with an explicit add-mode command model that
uses independent `InputDuration` and `RhythmicGridResolution`. Keep this as a
small, tested slice; do not migrate pitch input, note-atom creation, and final
domain export all at once.

### 2026-08-13: Add write path starts using explicit add-mode command adapter

- Added
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-command.ts`.
- Added tests in
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-command.test.ts`.
- Introduced:
  - `AddModeInsertCommand`;
  - `createDefaultAddModeInsertCommand`;
  - `createAddModeInputDuration`;
  - `toWritableEntityFromAddModeCommand`.
- Updated `useEntityEditor.handleAddEntity` so it accepts an explicit
  `AddModeInsertCommand` and no longer constructs a hard-coded
  `WritableEntity` inside the hook.
- The current default command still inserts an explicit quarter rest, but that
  default now lives behind the add-mode command adapter and uses
  `InputDuration`.
- This is intentionally still a transitional write boundary:
  - the add command is projected to legacy `WritableEntity`;
  - `insertEntity` still performs the MusicXML mutation;
  - pitch input, note-atom creation, caret-only movement, and domain
    command/export writes are not migrated in this slice.
- Noted a follow-up risk while implementing this: some older transitional
  Inspector adapters appear to use a different `RhythmicValue.timelineDuration`
  convention than the importer/rhythmic-placement path. Do not mix those units
  casually; schedule a focused rhythm-unit consistency pass before broadening
  add-mode duration UI.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- add-mode-command insert-entity editor-preview-panel-add-mode rhythmic-insert-placement`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue by either:

- extending the add-mode command adapter to support selected rest durations from
  UI state; or
- first performing a focused rhythm-unit consistency audit across
  `editor-domain`, `event-inspector-domain-adapter.ts`, and add-mode
  `InputDuration`.

Prefer the rhythm-unit audit before adding more duration UI, because inconsistent
duration units would make later add-mode behavior difficult for humans and AI
assistants to reason about.

### 2026-08-13: RhythmicValue unit consistency audit completed

- Standardized the documented editor-domain rhythm convention:
  `RhythmicValue.timelineDuration` uses quarter-note units, where quarter = `1`,
  half = `2`, and whole = `4`.
- Added this convention directly to
  `apps/customer-web/src/lib/editor-domain/model.ts` beside the
  `RhythmicValue.timelineDuration` field.
- Fixed `event-inspector-domain-adapter.ts` so
  `toDomainRhythm(...)` now emits quarter-note units instead of whole-note
  fractions:
  - whole -> `4`;
  - half -> `2`;
  - quarter -> `1`;
  - eighth -> `1/2`;
  - sixteenth -> `1/4`;
  - thirty-second -> `1/8`.
- Added rational normalization for dotted durations so dotted half is emitted as
  `3/1`, not `6/2`.
- Updated transitional Inspector, selection, source-render-anchor, and
  hook-level test fixtures that were still using whole-note fractions such as
  `1/4` for a quarter note.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` to state the
  quarter-note-unit convention and mark the consistency pass under the add-mode
  migration sequence.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-domain-adapter event-inspector-domain-view-model domain-selection-parity domain-selection-companion select-edit-selection source-render-anchors use-editing-domain-event inspector-view-model inspector-drafts musicxml-exporter musicxml-importer musicxml-roundtrip use-editor-domain-edit add-mode-command`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 can now safely continue with add-mode duration plumbing. The next
recommended slice is to introduce explicit add-mode input state for
`InputDuration` in the preview/editor state boundary and cover one non-quarter
rest insertion path, while still writing through the temporary legacy
`insertEntity` boundary.

### 2026-08-13: Add-mode InputDuration state plumbed into preview insert command

- Updated `EditorStateContext` with explicit add-mode input-duration state:
  - `addModeInputDuration`;
  - `setAddModeInputDuration`.
- Added `createDefaultAddModeInputDuration` to the add-mode command adapter and
  used it as the editor-state default.
- Updated `editor-preview-panel.tsx` so add-mode click and mobile confirmation
  pass an explicit `AddModeInsertCommand` containing the current
  `addModeInputDuration` to `handleAddEntity`.
- Extended `InsertPreview` so mobile tap-to-position preserves the command that
  was active when the preview was created.
- Updated `editor-preview-panel-add-mode.test.tsx` so the component-level add
  path now proves a non-quarter selected rest duration (`half`) flows through
  preview placement into `handleAddEntity`.
- The final MusicXML mutation still goes through legacy `insertEntity`; this
  slice only wires state and command intent, not the final domain exporter write.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-preview-panel-add-mode add-mode-command`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue by adding a small UI control or toolbar/palette state
entrypoint for selecting add-mode rest duration, then verifying a real
non-quarter rest insertion reaches MusicXML through the current legacy write
boundary. Keep pitched add input separate.

### 2026-08-13: Add-mode rest duration selector added to editor sidebar

- Added an add-mode-only rest-duration selector to
  `apps/customer-web/src/components/editor/editor-sidebar.tsx`.
- Reused the existing editor duration list and translations instead of creating
  a second duration vocabulary.
- Added
  `createAddModeInputDurationFromDuration(...)` in
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-command.ts` so UI
  `Duration` selections are converted to domain `InputDuration` using
  quarter-note timeline units:
  - whole -> `4`;
  - half -> `2`;
  - quarter -> `1`;
  - eighth -> `1/2`;
  - sixteenth -> `1/4`;
  - thirty-second -> `1/8`.
- Added `addModeRestDuration` i18n copy in English and Chinese.
- Added
  `apps/customer-web/src/components/editor/editor-sidebar-add-mode.test.tsx`
  to prove:
  - the rest-duration control is visible only in add mode;
  - selecting half note updates the editor-state `addModeInputDuration`.
- Extended `add-mode-command.test.ts` to cover UI duration -> domain duration
  conversion.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` so the plan
  no longer describes add-mode rest-duration UI as missing.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-sidebar-add-mode add-mode-command`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue by adding one real write-path test that uses the
selected non-quarter add-mode rest duration and asserts the resulting MusicXML
contains the expected `<duration>` and `<type>` values through the current
legacy `insertEntity` boundary. Keep this slice focused on explicit rests; do
not add pitched input until rest insertion is fully covered.

### 2026-08-13: Add-mode selected rest duration verified through MusicXML write path

- Added
  `apps/customer-web/src/hooks/editor/use-entity-editor-add-mode.test.tsx`.
- The test mounts the real editor providers and calls
  `useEntityEditor().handleAddEntity(...)` with an explicit half-rest
  `AddModeInsertCommand`.
- Verified the selected non-quarter rest duration reaches the current legacy XML
  mutation boundary:
  - MusicXML `<duration>` is `8` when `<divisions>` is `4`;
  - MusicXML `<type>` is `half`;
  - the inserted event remains selected as a `durationHalf` rest;
  - history receives the new XML snapshot.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` to mark this
  write-path coverage as complete for explicit rests.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-entity-editor-add-mode editor-sidebar-add-mode add-mode-command`.

REC-007 should continue with independent add-mode grid-resolution state and UI
only after deciding the first supported placement grid. Keep `inputDuration`
and `rhythmicGridResolution` separate: changing the duration of the inserted
rest must not change the legal caret positions, and changing the grid must not
change the inserted rest duration.

### 2026-08-13: Add-mode placement grid state and UI added

- Added `addModeGridResolution` and `setAddModeGridResolution` to
  `apps/customer-web/src/contexts/editor-state-context.tsx`.
- Default add-mode grid is quarter-note resolution. The first user-facing
  choices are quarter, eighth, and sixteenth grids; triplets/tuplets remain out
  of scope until tuplets/time-modification semantics are modeled end-to-end.
- Updated `apps/customer-web/src/components/editor/editor-sidebar.tsx` with an
  add-mode-only placement-grid selector, kept separate from the rest-duration
  selector.
- Updated `apps/customer-web/src/lib/editor/rhythmic-insert-placement.ts` so
  callers may pass a `RhythmicGridResolution`; if omitted, the adapter still
  uses beat-duration placement based on the current time signature.
- Updated `apps/customer-web/src/components/editor/editor-preview-panel.tsx` so
  add-mode click and hover placement use the selected grid resolution.
- Added/updated tests proving:
  - sidebar grid selection changes grid state without changing rest duration;
  - `resolveRhythmicInsertPlacement(...)` uses the supplied grid;
  - preview add-mode placement uses the selected grid for empty-staff clicks.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` so the plan
  records that both add-mode `InputDuration` and `RhythmicGridResolution`
  state/UI are now wired.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-sidebar-add-mode rhythmic-insert-placement editor-preview-panel-add-mode`;
  - `npm.cmd run typecheck`.

REC-007 should continue by deciding whether explicit rest add mode now has
enough coverage to start replacing the temporary legacy `insertEntity` write
boundary with a domain command/export path. Before migrating the write itself,
add a narrowly scoped parity test comparing current legacy rest insertion output
with the planned domain-export output for simple empty-staff insertion.

### 2026-08-13: Add-mode explicit-rest legacy/domain parity safety net added

- Added
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-rest-domain-parity.test.ts`.
- The test compares current legacy `insertEntity(...)` output with the planned
  domain command/export path for a simple empty-staff explicit half-rest insert
  at quarter offset.
- The comparison intentionally checks a semantic insertion signature instead of
  full XML text, because the domain exporter owns canonical MusicXML generation
  and is not expected to preserve every source formatting/detail from the legacy
  mutation path.
- Added `applyAddModeInsertCommandToDomain(...)` in
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-command.ts` as a
  small pure bridge from `AddModeInsertCommand` to the editor-domain
  `insertExplicitRest(...)` command.
- Exported the helper from
  `apps/customer-web/src/hooks/editor/entity-editor/index.ts`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- add-mode-command add-mode-rest-domain-parity`;
  - `npm.cmd run typecheck`.

REC-007 can now attempt the smallest real write migration for explicit rest add
mode: have `handleAddEntity` build/apply the domain command and export MusicXML
for the simple rest path, while preserving existing history and selection-refresh
behavior. Keep the legacy `insertEntity` path only until equivalent tests pass;
do not add compatibility aliases.

### 2026-08-13: Add-mode explicit-rest writes migrated to domain command/export path

- Added
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-domain-insert.ts`.
- Updated `apps/customer-web/src/hooks/editor/use-entity-editor.ts` so
  `handleAddEntity(...)` now calls `applyAddModeDomainInsert(...)` instead of
  projecting the command to legacy `WritableEntity` and calling
  `insertEntity(...)`.
- The new add-mode write path:
  - imports the current MusicXML into the editor-domain document;
  - ensures the target staff/voice exists for empty-staff insertion;
  - applies `AddModeInsertCommand` through
    `applyAddModeInsertCommandToDomain(...)`;
  - exports the updated domain document to MusicXML;
  - reparses the exported XML into legacy `ScoreData` while preserving expected
    voice structure;
  - pushes the new XML into history and refreshes the inserted selection from
    the reparse result.
- Removed the obsolete `toWritableEntityFromAddModeCommand(...)` projection and
  its `AddModeWritableEntityResult` type from production exports.
- Added a migration-boundary assertion in
  `apps/customer-web/tests/unit/verovio-surface-migration.test.ts` to prevent
  `use-entity-editor.ts` from reintroducing the old add-mode
  `insertEntity(...)`/`WritableEntity` path.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-entity-editor-add-mode add-mode-rest-domain-parity add-mode-command verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should continue by expanding explicit-rest domain add coverage beyond
the current simple empty-staff case: at minimum, cover insertion after an
existing event and insertion into a second voice/staff. If those pass, remove
or narrow legacy `insertEntity` responsibilities that are no longer used by
active production flows.

### 2026-08-13: Add-mode domain insert coverage expanded and legacy insert helper removed

- Added
  `apps/customer-web/src/hooks/editor/entity-editor/add-mode-domain-insert.test.ts`.
- Covered explicit-rest domain add writes for:
  - insertion after an existing note in the same staff/voice;
  - insertion into the selected second staff and second voice;
  - reparse/selection metadata for the inserted rest event.
- Deleted legacy add-write implementation files that no longer have production
  callers:
  - `apps/customer-web/src/hooks/editor/entity-editor/insert-entity.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/insert-entity.test.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/add-mode-rest-domain-parity.test.ts`.
- Removed `insertEntity` from the entity-editor barrel export.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` so it no
  longer says add-mode explicit-rest writes still use legacy `insertEntity`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- add-mode-domain-insert use-entity-editor-add-mode add-mode-command verovio-surface-migration`;
  - `npm.cmd run typecheck`.

REC-007 should continue by auditing the remaining `WritableEntity` and legacy
mutation surfaces. The likely next target is to separate transitional Inspector
update/delete paths from the add-mode command path, then decide whether
`WritableEntity` can be renamed/narrowed to an Inspector-only draft.

### 2026-08-13: WritableEntity renamed and scoped to Inspector update path

- Renamed the generic `WritableEntity` type in
  `apps/customer-web/src/types/score-types.ts` to `InspectorWritableEntity`.
- Renamed Inspector conversion helpers so their role is explicit:
  - `toInspectorWritableEntityFromInspectorDraft(...)`;
  - `toInspectorWritableEntityFromInspectorEditState(...)`.
- Renamed
  `apps/customer-web/src/hooks/editor/entity-editor/writable-entity-validation.ts`
  to
  `apps/customer-web/src/hooks/editor/entity-editor/inspector-writable-entity-validation.ts`.
- Renamed its validator to `hasValidInspectorWritableEntityShape(...)`.
- Updated `useEntityEditor.updateEntity(...)` and
  `updateExistingEntity(...)` to use `InspectorWritableEntity`, making it clear
  this legacy DTO is currently scoped to Inspector update mutations only.
- Added a migration-boundary assertion in
  `apps/customer-web/tests/unit/verovio-surface-migration.test.ts` to keep
  add-mode commands independent from `InspectorWritableEntity`.
- Cleaned one historical mojibake arrow in
  `apps/customer-web/src/components/editor/event-inspector.tsx` while touching
  the Inspector surface.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-event-model event-inspector-domain-adapter update-existing-entity verovio-surface-migration add-mode-domain-insert`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`;
  - `npm.cmd run test`.

REC-007 should continue by examining whether `updateExistingEntity(...)` can be
split into explicit Inspector update operations by target kind: pitched event,
explicit rest, and chord note-atom metadata. Avoid extracting too much; start
with one narrow domain-backed Inspector edit that already has parity coverage.

### 2026-08-13: Inspector explicit-rest rhythm saves moved to domain command/export

- Updated
  `apps/customer-web/src/components/editor/event-inspector.tsx` so matched
  explicit-rest duration/dotted edits use `useEditorDomainEdit(...)` instead of
  the legacy `InspectorWritableEntity -> updateExistingEntity(...)` XML
  mutation path.
- Added a narrow explicit-rest domain save helper that carries only the target
  domain event id and rhythm. Staff, voice, and position edits remain out of
  scope until the UI has explicit semantics for those changes.
- Added lower-level domain export coverage in
  `apps/customer-web/src/hooks/editor/use-editor-domain-edit.test.tsx`.
- Added component interaction coverage in
  `apps/customer-web/src/components/editor/event-inspector-domain-save.test.tsx`
  proving Inspector rest duration edits update MusicXML, history, reparsed
  `ScoreData`, and the refreshed selected event.
- Added a migration-boundary assertion in
  `apps/customer-web/tests/unit/verovio-surface-migration.test.ts` so this path
  stays domain-backed.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` to reflect
  the current state of add-mode explicit rest, Inspector explicit-rest rhythm,
  and remaining `InspectorWritableEntity` surfaces.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-domain-save use-editor-domain-edit verovio-surface-migration`.

REC-007 should continue with the next behavior-backed Inspector domain save
slice: migrate pitch name/octave edits for an existing note atom through
`updateNoteAtom(...)`, using the same source-id retargeting bridge already used
by accidental and fingering edits. Do not migrate add-pitch/remove-pitch until
note-atom id generation and chord-shape semantics are explicit.

### 2026-08-13: Inspector pitch name/octave saves moved to domain note-atom patch

- Updated
  `apps/customer-web/src/components/editor/event-inspector-event-model.ts` with
  a narrow `getPitchOnlyPitchedEdit(...)` classifier. It only accepts one
  existing pitch name/octave change while duration, dotted, stem direction,
  fingerings, accidentals, and pitch count remain unchanged.
- Updated
  `apps/customer-web/src/components/editor/event-inspector.tsx` so matched
  pitch name/octave edits use `useEditorDomainEdit(...)` with a retargetable
  `noteAtom` draft containing only a `pitch` patch.
- Kept accidental edits on their existing combined `pitch + accidental` domain
  path, so clicking accidental buttons is not misclassified as a pitch-only
  edit.
- Added pure helper coverage in
  `apps/customer-web/tests/unit/event-inspector-event-model.test.ts`.
- Added component interaction coverage in
  `apps/customer-web/src/components/editor/event-inspector-domain-save.test.tsx`
  proving:
  - single-note pitch edits refresh MusicXML, history, selected legacy event,
    and reparsed `ScoreData`;
  - chord-member pitch edits retarget by the edited source id and preserve the
    remaining chord member/source ids.
- Updated
  `docs/engineering/plans/editor-domain-model-refactoring-plan.md` so existing
  note-atom pitch name/octave edits are no longer listed as legacy
  `InspectorWritableEntity` save paths.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-event-model event-inspector-domain-save use-editor-domain-edit`.

REC-007 should continue by defining the identity policy for appended note atoms
before migrating add-pitch. The policy must cover the domain `NoteAtomId`, the
exported MusicXML source id, and collision behavior after reimport. Do not move
add-pitch or remove-pitch until this identity rule has focused tests.

### 2026-08-18: Appended note-atom identity policy completed

- Added `createUniqueMusicXmlId(...)` to the MusicXML identity utility. It
  sanitizes a proposed XML id and resolves collisions deterministically with
  numeric suffixes.
- Added `createAppendedNoteAtomIdentity(...)` in the editor domain. For an
  appended chord member it derives `<root>-chord-<member-number>` from the
  first note's stable source id (or its domain id), reserves every event,
  note-atom, and source id in the current document, and resolves collisions.
- The new value is assigned both as `NoteAtomId` and as the note's MusicXML
  source id. The exporter writes `NoteAtomId` as `<note id>`, and the importer
  restores it into both fields; no fallback lookup or compatibility alias is
  introduced.
- Added focused identity/collision tests and a MusicXML round-trip test proving
  that an appended `editable-note-chord-2` member remains addressable after
  export and re-import.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- note-atom-identity stable-ids`.

REC-007 can now migrate add-pitch for existing pitched events as one narrow
Inspector command slice using `addNoteAtom(...)`. Explicit-rest conversion and
remove-pitch remain separate behaviors and must not enter that slice.

### 2026-08-20: Inspector add-pitch moved to the domain append-note command

- Added `appendNoteAtom` as an explicit editor-domain Inspector command. It
  accepts only an existing pitched event, generates the new note atom's stable
  identity from the imported document, and delegates the mutation to
  `addNoteAtom(...)`.
- Updated the Inspector Add pitch control: when its selected entity matches the
  domain projection, it now uses this command and reselects through the
  existing source ids. Explicit-rest conversion remains outside this slice.
- Added domain-command coverage for source-backed appended note atoms and an
  Inspector interaction test proving the exported MusicXML, history, reparsed
  score, and reopened selection all become a two-member chord with stable
  source ids.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- inspector-drafts event-inspector-domain-save note-atom-identity musicxml-roundtrip`.

REC-007 should next migrate remove-pitch for an existing multi-note pitched
event through `removeNoteAtom(...)`. The final pitch must remain disabled in
the UI; explicit delete and pitch-to-rest conversion are separate commands.

### 2026-08-20: Inspector remove-pitch moved to the domain remove-note command

- Added `removeNoteAtom` as an explicit editor-domain Inspector command, backed
  directly by the command-layer guard that rejects removal of the final note
  atom.
- Updated Inspector pitch-row deletion. A matched multi-note event now resolves
  the target `NoteAtomId` from the domain view model and removes that member
  through the domain command. The UI keeps the final member's delete control
  disabled, and it never converts a note to a rest as a side effect.
- Added command tests for successful multi-note removal and final-note
  rejection. Extended the real Inspector interaction test to append a member,
  remove it, and verify MusicXML, history, selection, and parsed score return
  to the remaining single note.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- inspector-drafts event-inspector-domain-save note-atom-identity musicxml-roundtrip`.

REC-007 has completed the current pitch/chord shape command slice. The next
high-value migration is domain-native render-id-to-anchor selection, which will
remove the remaining `ParsedEventSelection` bridge before relationship controls
such as tie and slur are migrated.

### 2026-08-20: Select/edit domain anchor decoupled from ParsedEventSelection

- `EditorPreviewPanel` now resolves the domain anchor directly from the clicked
  Verovio render id and passes it straight to
  `createDomainSelectionCompanion(...)`.
- `createSelectEditSelection(...)` and parity evaluation now receive the
  low-level legacy Verovio hit only for the transitional parsed
  event/location payload. They no longer depend on `ParsedEventSelection`,
  which previously mixed domain-anchor transport with legacy editor state.
- `ParsedEventSelection` remains only for current delete and tie/slur
  operations, whose command interfaces still require legacy locations and
  parsed connection metadata. No new compatibility alias was added.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- select-edit-selection domain-selection-parity select-edit-selection-flow verovio-surface-migration`.

REC-007 should next move selection highlighting and Inspector-open state to
domain anchors, leaving legacy event/location lookup only at the remaining
legacy mutation boundaries. After that, tie/slur command migration can use
note-atom anchors rather than parsed source-id bookkeeping.

### 2026-08-20: Domain-anchor state made canonical for preview selection

- Added `domainAnchor` to `EditingSelectionState`. The state provider derives
  it from a supplied domain companion when a caller does not explicitly pass
  it, so the stored editor state has one canonical identity for new
  render-id-backed selections.
- Updated preview selection highlighting to resolve render ids from that domain
  anchor through `getRenderIdsForDomainAnchor(...)`. Legacy source-id
  highlighting is now limited to older selection origins that do not yet create
  a domain anchor.
- Added provider coverage proving domain companion selection is normalized to
  its canonical anchor.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-state-context editor-preview-selection-highlight select-edit-selection domain-selection-parity select-edit-selection-flow event-inspector-domain-save`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

### Delivery-policy adjustment: accelerate domain-first migration during development

- The product has no production users or persisted user-authored editor data,
  so new editor work should prefer direct replacement over compatibility
  shims, aliases, or preserving obsolete runtime shapes.
- Incremental test-backed slices remain appropriate for MusicXML semantics,
  rhythmic timing, multi-voice behavior, and export/re-import invariants. They
  are not needed merely to preserve legacy UI-state APIs.
- For remaining selection/Inspector work, make domain anchors authoritative and
  retain legacy parsed event/location data only at an active, unported mutation
  boundary. Delete that boundary and its adapter once its command migration is
  complete.

### 2026-08-20: Inspector domain view rebuilt from canonical selection anchor

- `useEditingDomainInspectorViewModel(...)` now resolves its view model from
  the current imported domain document and `editingSelection.domainAnchor`.
  It no longer treats an earlier `DomainSelectionCompanion` snapshot as
  authoritative, preventing stale Inspector data after export/re-import.
- Domain saves preserve the current anchor when the addressed object remains
  valid. Add/remove pitch deliberately promote the selection to the containing
  event anchor, because a removed note-atom anchor can no longer be valid.
- Added coverage for stale companion rejection and structural pitch edits
  retaining an event-level canonical anchor.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-editing-domain-event event-inspector-domain-save editor-state-context select-edit-selection-flow`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next remove `legacyEvent` from the Inspector's display/read
model entirely. Keep it only in the legacy tie/slur/delete adapters until those
commands are replaced by domain relation commands.

### 2026-08-20: Inspector controls now read domain projection unconditionally

- Removed the legacy/domain parity gate from Inspector control display. When a
  current domain projection exists, pitch rows, duration, dotted state, stem,
  accidental, and fingering controls read it directly.
- The parity status remains a mutation-routing diagnostic: it protects the
  remaining legacy write boundary from consuming data that has not been mapped
  to a domain command, but it no longer decides what score data the user sees.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-domain-view-model event-inspector-domain-save use-editing-domain-event`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next move the remaining Inspector initial edit state and open
guard from `legacyEvent` to the domain projection. This is a larger direct
replacement: retain a small optional legacy command context only for tie/slur,
beam, and delete until those commands move to domain anchors.

### 2026-08-20: Inspector domain commands no longer read legacy source metadata

- Replaced legacy `ParsedScoreEvent.meta.sourceIds` as the primary reselection
  input for all migrated Inspector commands. Those commands now use source ids
  from the current domain `VoiceEvent`; legacy metadata is only the temporary
  fallback when a domain event cannot be resolved.
- This applies to rhythm/stem, fingering, accidental, pitch name/octave, and
  append/remove note-atom operations. Connection, beam, and delete operations
  remain intentionally outside this change because their legacy command
  boundaries have not yet been replaced.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-domain-save use-editing-domain-event event-inspector-domain-view-model`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should now replace the Inspector's initial mutable DTO with a
domain-derived edit session. That replacement removes the remaining legacy
event dependency for the migrated core controls, rather than adding further
legacy/domain classifiers.

### 2026-08-20: Inspector core controls read from domain projection

- Removed `EventInspectorPanel`'s initial mutable legacy `InspectorEditState`.
  The panel now derives its core editable display from the current domain
  Inspector projection when available, and only projects the legacy parsed event
  when no domain projection exists.
- Legacy `InspectorEditState` is now created only at the remaining unported XML
  mutation boundary, keeping the legacy DTO out of the migrated core control
  read path.
- When a `noteAtom` domain anchor is selected, `useEditingDomainInspectorViewModel`
  now returns the owning pitched-event view model for Inspector display. This
  preserves full chord editing while keeping note-atom identity available for
  command targeting.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-editing-domain-event event-inspector-domain-save event-inspector-domain-view-model event-inspector-event-model`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

### 2026-08-20: Inspector opening no longer requires legacy parsed event context

- Made `EditingSelectionState.legacyEvent` optional and normalized omitted
  legacy events to `null` in `openEditingSelection(...)`.
- Updated `EventInspector` to open when the current selection has a resolvable
  domain Inspector projection, even if no legacy parsed event is attached.
- Kept legacy parsed events as an explicit temporary command context for
  unported XML mutation paths. Tie/slur, beam, delete, and fallback legacy
  mutation operations guard against missing legacy context instead of assuming
  it exists.
- Added coverage for:
  - domain-only `openEditingSelection(...)`;
  - domain-only Inspector render from current MusicXML/domain anchor.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-domain-save editor-state-context use-editing-domain-event`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

### 2026-08-20: Delete event migrated to domain anchor command path

- Added an explicit `deleteEvent` Inspector draft backed by
  `deleteVoiceEvent(...)`.
- Relaxed `deleteVoiceEvent(...)` so `measureDuration` is optional. Deleting an
  event no longer requires a caller to request derived-gap diagnostics; callers
  that pass `measureDuration` still receive gaps.
- Updated preview delete mode to pass the resolved domain anchor into
  `handleDeleteEntity(...)`. When the anchor identifies an event or note atom,
  deletion now goes through domain import/edit/export; legacy location deletion
  remains only for selections without a domain event anchor.
- Added coverage for:
  - command-level `deleteEvent`;
  - hook-level domain-anchor delete writing MusicXML, pushing history, and
    clearing the open selection.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands inspector-drafts use-entity-editor-add-mode event-inspector-domain-save editor-state-context use-editing-domain-event`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

### 2026-08-20: Beam direction migrated to domain notation controls

- Added `getManualBeamRunSourceIdsAtEntity(...)` to the MusicXML beam helper.
  It is a temporary read bridge for resolving the selected rendered beam run to
  root MusicXML note ids; it does not perform mutation.
- Added `applyDomainStemDirectionToSourceIds(...)` to the domain edit hook. It
  imports the current MusicXML into the editor domain, maps source ids to
  domain events, applies event stem notation controls, exports MusicXML, pushes
  history, and refreshes legacy `ScoreData`.
- Updated Event Inspector beam direction controls (`Auto` / `Above` / `Below`)
  to use the domain notation-control path. Structural beam join/break was
  migrated in the later "Inspector beam join/break moved to domain relationship
  commands" slice below.
- Updated domain MusicXML export to rebuild automatic beam elements before
  serialization, so domain-exported beam direction edits do not strip beam XML.
- Added coverage for:
  - beam-run source id lookup;
  - automatic beam export;
  - hook-level beam direction set/clear with beam preservation;
  - Event Inspector beam direction interaction.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- automatic-beams musicxml-exporter use-editor-domain-edit event-inspector-domain-save commands inspector-drafts use-entity-editor-add-mode editor-state-context use-editing-domain-event`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

### 2026-08-20: Beam relationships modeled in editor domain

- Added `BeamId` and `BeamRelationship` to the editor-domain model, plus the
  required `ScoreDocument.beamRelationships` collection.
- Added `createBeamRelationship(...)` invariant validation: beam relationships
  require at least two events.
- Updated MusicXML import to read level-one `<beam>` begin/continue/end runs as
  domain beam relationships.
- Updated MusicXML export to write explicit domain beam relationships back to
  `<beam number="1">begin|continue|end</beam>` after automatic beam rebuilding.
- Added `updateBeamRelationshipAtEvent(...)` domain command covering the current
  structural actions: join previous, join next, break left, and break right.
- Deleting an event now also drops beam relationships that include that event.
- Added coverage for:
  - model invariant;
  - import/export beam relationship round trip surface;
  - domain join and split commands;
  - delete-event cleanup of beam relationships.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands model musicxml-importer musicxml-exporter automatic-beams use-editor-domain-edit event-inspector-domain-save`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

The follow-up slice below wires these commands into the Inspector. After that
point, tie/slur relationships remain the next large legacy command context.

### 2026-08-20: Inspector beam join/break moved to domain relationship commands

- Added `applyDomainBeamRelationshipEditBySourceId(...)` to the editor-domain
  edit hook. It imports the current MusicXML, resolves the selected MusicXML
  source id to a domain voice event, applies `updateBeamRelationshipAtEvent(...)`,
  exports MusicXML, pushes history, and refreshes legacy `ScoreData`.
- Updated Event Inspector beam join/break buttons to use the domain command
  path instead of `updateManualBeamAtEntity(...)`. The Inspector no longer
  performs direct MusicXML beam-structure mutation for these controls.
- Deleted the now-unused `updateManualBeamAtEntity(...)` helper and its
  direct-XML structure mutation tests. Beam structure edits now have a single
  production path: editor-domain beam relationships plus MusicXML export.
- Kept `getManualBeamRunSourceIdsAtEntity(...)` as a narrow read adapter for
  resolving beam-run direction edits.
- Added coverage for:
  - hook-level beam relationship edits by MusicXML source id;
  - real Event Inspector break-right interaction writing exported MusicXML and
    history.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-editor-domain-edit event-inspector-domain-save automatic-beams musicxml-importer musicxml-exporter commands`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next focus on tie/slur relationship modeling and command
migration. Those controls still depend on legacy connection maps and direct
MusicXML update helpers, while beam direction and beam structure are now
domain-backed.

### 2026-08-20: Tie relationship foundation added to editor domain

- Added `TieRelationship` to the editor-domain model and made
  `ScoreDocument.tieRelationships` an explicit required collection. A tie now
  has its own identity and connects `startNoteAtomId -> stopNoteAtomId`; visual
  placement remains separate in `tieNotation` controls.
- Added `createTieRelationship(...)` invariant validation so a tie cannot point
  to the same note atom as both endpoints.
- Updated MusicXML import to pair `<tie type="start">` and
  `<tie type="stop">` by voice/staff/pitch and create domain tie relationships.
  Imported `NoteAtom` values now also receive `tieOut` / `tieIn` anchors for
  local note-atom inspection.
- Updated MusicXML export to write domain tie relationships back as both
  sounding `<tie type="start|stop">` elements and visual
  `<notations><tied type="start|stop">` elements.
- Removed the editor-domain exporter's direct dependency on the legacy
  `@/lib/musicxml/automatic-beams` helper. Domain export now writes explicit
  `beamRelationships`; automatic beam synthesis remains outside the canonical
  editor-domain boundary.
- Updated delete/remove-note domain commands to drop tie relationships and
  `tieNotation` controls that reference removed note atoms.
- Added coverage for:
  - tie relationship invariant;
  - MusicXML import of tie relationships;
  - MusicXML export of tie relationships;
  - existing command/model/import/export coverage under the new required
    `ScoreDocument.tieRelationships` field.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run test -- model musicxml-importer musicxml-exporter commands notation-model`;
  - `npm.cmd run test -- use-editor-domain-edit event-inspector-domain-save automatic-beams musicxml-importer musicxml-exporter commands`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate the Inspector tie controls one slice at a time:
first tie delete through domain relationships, then tie placement through
`tieNotation` controls. Slur should follow only after the tie path proves the
relationship/notation split in UI code.

### 2026-08-20: Inspector tie delete moved to domain relationship command

- Added `deleteTieRelationship(...)` to the editor-domain command layer. It
  removes a tie relationship, clears matching `tieIn` / `tieOut` anchors on
  note atoms, and drops related `tieNotation` controls.
- Added `deleteDomainTieRelationshipBySourceIds(...)` to the editor-domain edit
  hook. It imports the current MusicXML, resolves the two selected MusicXML note
  ids to domain note atoms, finds the matching tie relationship regardless of
  endpoint order, applies the domain command, exports MusicXML, pushes history,
  and refreshes legacy `ScoreData`.
- Updated Event Inspector single-tie delete to use the domain command/export
  path instead of `handleDeleteTieConnection(...)`.
- Deleted the now-unused legacy single-tie XML deletion path:
  `handleDeleteTieConnection(...)`, `removeTieConnectionFromXML(...)`, and the
  internal `removeTypedTieFromNote(...)` helper.
- Added an accessible `deleteConnection` label for connection delete buttons.
- Added coverage for:
  - command-level tie relationship deletion;
  - hook-level tie deletion by MusicXML source ids;
  - real Event Inspector delete-button interaction removing `<tie>` and
    `<tied>` XML and updating history.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands use-editor-domain-edit event-inspector-domain-save musicxml-importer musicxml-exporter musicxml-core event-inspector-connections`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate tie placement/direction (`auto` / `above` /
`below`) to `tieNotation` controls. After tie placement is domain-backed, the
remaining tie XML direction helpers can be deleted and the same relationship
pattern can be applied to slur.

### 2026-08-20: Inspector tie placement moved to domain notation controls

- Added `setTieRelationshipPlacement(...)` to the editor-domain command layer.
  It sets or clears a `tieNotation` control for an existing tie relationship;
  missing placement remains the automatic engraving state.
- Updated MusicXML import to read start-side
  `<tied orientation="over|under">` into `tieNotation.placement` as
  `above|below`.
- Updated MusicXML export to write `tieNotation.placement` back to start-side
  `<tied orientation="over|under">`.
- Added `setDomainTiePlacementBySourceIds(...)` to the editor-domain edit hook.
  It resolves both MusicXML note ids to domain note atoms, finds the tie
  relationship independent of endpoint order, applies the domain command,
  exports MusicXML, pushes history, and refreshes legacy `ScoreData`.
- Updated Event Inspector tie direction controls (`auto` / `above` / `below`)
  to use the domain command/export path.
- Deleted the now-unused legacy single-tie direction write path:
  `handleUpdateTieConnectionDirection(...)`, `setTieConnectionDirectionInXML(...)`,
  and the private `getTieOrientation(...)` helper. The legacy tie direction
  read helper remains only for displaying parsed connection details until the
  Inspector connection read model is domain-native.
- Added coverage for:
  - command-level set/clear of tie placement;
  - MusicXML import/export of tie placement;
  - hook-level set/clear by MusicXML source ids;
  - real Event Inspector direction interaction writing `orientation="over"`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands use-editor-domain-edit event-inspector-domain-save musicxml-importer musicxml-exporter musicxml-core event-inspector-connections notation-model`;
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should now move to slur relationship modeling. Tie relation existence,
delete, and placement are domain-backed; slur still depends on legacy
connection maps and direct MusicXML mutation helpers.

### 2026-08-20: Slur relationship foundation added to editor domain

- Added `SlurRelationship` to the editor-domain model and made
  `ScoreDocument.slurRelationships` an explicit required collection. Slur ids
  reuse the existing `NotationId` type, matching `slurNotation.notationId`.
- Added `createSlurRelationship(...)` invariant validation so a slur cannot
  point to the same note atom as both endpoints.
- Updated MusicXML import to pair `<slur type="start|stop" number="...">` by
  staff and MusicXML slur number, creating domain slur relationships between
  note atoms.
- Updated MusicXML import/export to round-trip slur placement through
  `slurNotation.placement`, mapping MusicXML `placement="above|below"` to the
  domain notation control.
- Updated MusicXML export to write domain slur relationships back as
  `<notations><slur type="start|stop" number="...">` elements.
- Updated delete/remove-note domain commands to drop slur relationships and
  `slurNotation` controls that reference removed note atoms.
- Added coverage for:
  - slur relationship invariant;
  - MusicXML import of slur relationships and placement;
  - MusicXML export of slur relationships and placement;
  - command cleanup of slur relationships when deleting an event.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- model musicxml-importer musicxml-exporter commands notation-model editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate Inspector slur delete to the domain relationship
path. After slur delete is domain-backed, migrate slur placement/direction and
then remove the corresponding legacy direct MusicXML slur mutation helpers.

### 2026-08-20: Inspector slur delete moved to domain relationship command

- Added `deleteSlurRelationship(...)` to the editor-domain command layer. It
  removes a slur relationship and drops related `slurNotation` controls.
- Added `deleteDomainSlurRelationshipBySourceIds(...)` to the editor-domain edit
  hook. It imports the current MusicXML, resolves both MusicXML note ids to
  domain note atoms, finds the matching slur relationship independent of
  endpoint order, applies the domain command, exports MusicXML, pushes history,
  and refreshes legacy `ScoreData`.
- Updated Event Inspector single-slur delete to use the domain command/export
  path instead of `handleDeleteSlurConnection(...)`.
- Deleted the now-unused legacy single-slur XML deletion path:
  `handleDeleteSlurConnection(...)`, `removeSlurConnectionFromXML(...)`, and
  the internal `removeTypedSlurFromNote(...)` helper.
- Added coverage for:
  - command-level slur relationship deletion;
  - hook-level slur deletion by MusicXML source ids;
  - real Event Inspector delete-button interaction removing `<slur>` XML and
    updating history.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands use-editor-domain-edit event-inspector-domain-save musicxml-importer musicxml-exporter musicxml-core event-inspector-connections`;
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate slur placement/direction (`auto` / `above` /
`below`) to `slurNotation` controls. That will remove the last direct
single-connection slur XML mutation helper from the Inspector path.

### 2026-08-20: Inspector slur placement moved to domain notation controls

- Added `setSlurRelationshipPlacement(...)` to the editor-domain command layer.
  It sets or clears a `slurNotation` placement control for an existing slur
  relationship and rejects missing relationship ids.
- Added `setDomainSlurPlacementBySourceIds(...)` to the editor-domain edit hook.
  It resolves both MusicXML note ids to domain note atoms, finds the matching
  slur relationship independent of endpoint order, applies the domain command,
  exports MusicXML, pushes history, and refreshes legacy `ScoreData`.
- Updated Event Inspector slur `auto` / `above` / `below` controls to call the
  domain hook instead of the legacy direct XML mutation path.
- Deleted the now-unused legacy single-slur direction write path:
  `handleUpdateSlurConnectionDirection(...)`,
  `setSlurConnectionDirectionInXML(...)`, and the private
  `findStartSlurNumber(...)` helper. The slur direction read helper remains
  only for displaying parsed connection details until the Inspector connection
  read model is domain-native.
- Added coverage for:
  - command-level set/clear of slur placement;
  - hook-level set/clear by MusicXML source ids;
  - real Event Inspector direction interaction writing `placement="above"`;
  - MusicXML core reading of existing tie/slur direction hints without depending
    on a legacy slur setter.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands use-editor-domain-edit event-inspector-domain-save musicxml-importer musicxml-exporter musicxml-core event-inspector-connections notation-model`;
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate connection creation and bulk-delete tools. The
single-connection Inspector delete/placement controls for ties and slurs are now
domain-backed, but Add Tie / Add Slur and bulk Delete Tie / Delete Slur still use
legacy MusicXML mutation helpers.

### 2026-08-20: Add Tie / Add Slur moved to domain relationship commands

- Added `addTieRelationship(...)` and `addSlurRelationship(...)` to the
  editor-domain command layer.
  - Tie creation writes a deterministic tie id, adds a `TieRelationship`, and
    updates the start/stop note atoms' `tieOut` / `tieIn` anchors.
  - Slur creation writes a deterministic notation id and adds a
    `SlurRelationship`.
  - Duplicate relationships and missing endpoint note atoms are rejected instead
    of silently generating duplicate MusicXML.
- Added `addDomainTieRelationshipsBySourceIds(...)` and
  `addDomainSlurRelationshipsBySourceIds(...)` to the editor-domain edit hook.
  They import the current MusicXML, resolve selected MusicXML note ids to one or
  more domain note-atom pairs, order endpoints by score position, apply domain
  relationship commands, export MusicXML once, push history, and refresh legacy
  `ScoreData`.
- Updated `useConnectionOperations(...)` so Add Tie / Add Slur keep their
  existing selection-state and product validation rules, but write through the
  domain command/export path instead of `addTieElementsToXML(...)` /
  `addSlurElementsToXML(...)`.
- Deleted the now-unused legacy direct connection creation helpers:
  `addTieElementsToXML(...)`, `addSlurElementsToXML(...)`, and their private
  MusicXML element insertion helpers.
- Updated MusicXML core tests to use explicit standard MusicXML fixtures for
  parser/read coverage instead of relying on removed legacy writer helpers.
- Added coverage for:
  - command-level tie and slur relationship creation;
  - duplicate tie/slur creation rejection;
  - hook-level tie and slur creation by MusicXML source ids, including endpoint
    ordering independent of click order;
  - parser read coverage for standard tie/slur XML and chord-member endpoints.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- commands use-editor-domain-edit musicxml-core`;
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate bulk Delete Tie / Delete Slur tools. The remaining
legacy connection write helpers are now the bulk deletion helpers:
`removeTieElementsFromXML(...)` and `removeSlurElementsFromXML(...)`.

### 2026-08-20: Bulk Delete Tie / Delete Slur moved to domain relationship commands

- Added `deleteDomainTieRelationshipsForSourceIds(...)` and
  `deleteDomainSlurRelationshipsForSourceIds(...)` to the editor-domain edit
  hook. They import the current MusicXML, resolve the selected MusicXML note ids
  to domain note atoms, delete every tie/slur relationship touching those note
  atoms, export MusicXML once, push history, and refresh legacy `ScoreData`.
- Updated `useConnectionOperations(...)` so the preview toolbar's bulk Delete
  Tie / Delete Slur tools keep their existing connection availability checks and
  toast count calculation, but write through the domain command/export path.
- Removed `useConnectionOperations(...)`'s dependency on `useXmlUpdater(...)`.
  `editor-preview-panel.tsx` no longer wires direct XML mutation into connection
  operations.
- Deleted the now-unused legacy direct bulk deletion helpers:
  `removeTieElementsFromXML(...)`, `removeSlurElementsFromXML(...)`, and their
  private MusicXML element removal helpers.
- Narrowed `musicxml/connections.ts` to connection direction readers only. This
  bridge was later removed when the Inspector connection detail read path moved
  to domain relationships and notation controls.
- Added coverage for:
  - deleting all tie relationships touching a selected middle note;
  - deleting all slur relationships touching a selected middle note;
  - exported MusicXML/history updates after bulk deletion.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-editor-domain-edit musicxml-core commands`;
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 connection write paths are now domain-backed. The next migration should
make the connection read model domain-native so Inspector connection lists and
preview connection visibility no longer depend on legacy `ScoreData.connections`
plus MusicXML direction reader bridges.

### 2026-08-20: Inspector tie/slur connection details moved to domain read model

- Added domain-native connection detail builders:
  `buildDomainTieDetails(...)` and `buildDomainSlurDetails(...)`.
  They read from `ScoreDocument.tieRelationships`,
  `ScoreDocument.slurRelationships`, and domain notation controls instead of
  parsing direction from MusicXML.
- Updated Event Inspector to prefer domain connection details whenever the
  current selection resolves to a pitched domain event. The existing legacy
  `ScoreData.connections` detail builders remain only as fallback for
  unresolved domain selections.
- Preserved the current UI contract by mapping domain note-atom MusicXML source
  ids back to parsed `ScoreData` entity ids for endpoint display and the
  existing endpoint navigation callback.
- Moved `ConnectionDirection` to the Inspector connection helper and deleted the
  obsolete `musicxml/connections.ts` module entirely.
- Removed the stale MusicXML core test that exercised the deleted direction
  reader bridge. Direction display is now covered by domain connection helper
  tests and domain notation-control import/export tests.
- Added coverage for:
  - tie detail direction from `tieNotation.placement`;
  - slur detail direction from `slurNotation.placement`;
  - chord-member source id mapping from domain note atoms back to parsed
    endpoint ids.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-connections musicxml-core event-inspector-domain-save`;
  - `npm.cmd run test -- editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next migrate preview connection visibility. The Inspector
connection list is now domain-first, but hidden-track connection filtering still
uses legacy `ScoreData.connections` to derive tie/slur endpoint pairs.

### 2026-08-20: Preview hidden-track connection pairs moved to domain relationships

- Updated `getHiddenConnectionPairs(...)` to require a domain
  `ScoreDocument`. It derives hidden tie and slur endpoint pairs from
  `tieRelationships` and `slurRelationships` plus note-atom MusicXML source ids.
- Updated `editor-preview-panel.tsx` to pass the current domain document into
  hidden connection pair projection.
- Removed the legacy `ScoreData.connections` fallback from hidden connection
  pair projection and deleted the unused test fixture connection map.
- Added coverage proving hidden connection pairs are derived from domain
  relationships.
- Updated Verovio surface migration sentinels to assert the current domain
  connection deletion/editing boundaries instead of obsolete legacy handler
  names.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-preview-track-visibility verovio-surface-migration`;
  - `npm.cmd run test -- event-inspector-connections event-inspector-domain-save editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 tie/slur connection interaction is now domain-first for writes,
Inspector details, and preview hidden-track connection visibility. Remaining
legacy connection dependencies are fallback/diagnostic surfaces such as
`ScoreData.connections` in parser/validator flows and endpoint navigation that
still maps domain source ids back to parsed entity ids.

### 2026-08-20: Preview Delete Tie / Delete Slur availability moved to domain relationships

- Updated `useConnectionOperations(...)` to read the current
  `ScoreDocument` via `useEditorDomainDocument()`.
- Added `getDomainConnectionDeletionSummary(...)`, a pure helper that resolves
  selected MusicXML source ids to domain note atoms and summarizes the tie/slur
  relationships touching those atoms.
- Updated preview Delete Tie / Delete Slur tools so their "has connection?"
  checks and toast counts use domain relationships instead of
  `ScoreData.connections`.
- `useConnectionOperations(...)` no longer directly reads
  `ScoreData.connections`. `ScoreData` remains in this hook for Add Tie product
  validation such as same-pitch and adjacent-note checks.
- Added coverage for:
  - tie deletion summaries for a selected middle note touching two ties;
  - slur deletion summaries for a selected middle note touching two slurs;
  - empty summaries for unresolved MusicXML source ids.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-connection-operations editor-preview-track-visibility verovio-surface-migration`;
  - `npm.cmd run test -- event-inspector-connections event-inspector-domain-save editor-domain`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 editor connection interaction no longer needs `ScoreData.connections`
for preview tool availability/counts. The remaining editor-facing legacy
connection bridge is Event Inspector fallback/endpoint navigation; parser and
validator connection maps are now diagnostic/compatibility surfaces rather than
the primary editor command model.

### 2026-08-20: Event Inspector connection fallback removed and endpoint navigation uses domain anchors

- Removed the legacy `buildTieDetails(...)` and `buildSlurDetails(...)`
  builders that projected Inspector connection details from
  `ScoreData.connections`.
- Event Inspector now builds tie/slur connection details only from domain
  relationships and notation controls.
- Updated connection endpoint clicks to resolve the endpoint MusicXML source id
  to a domain note-atom anchor via `findNoteAtomByMusicXmlElementId(...)` and
  open that anchor through `openEditingSelection(...)`.
- Parsed `ScoreData` entity context is still attached when it can be found by
  source id, so existing display/edit fallback paths remain available while the
  selection identity is domain-native.
- Event Inspector no longer directly reads `ScoreData.connections`.
- Updated tests to remove legacy connection-detail builder expectations and keep
  domain relationship / notation-control coverage.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-connections event-inspector-domain-save use-connection-operations`;
  - `npm.cmd run test -- editor-domain verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 editor-facing tie/slur connection interaction is now domain-backed for
creation, deletion, placement, Inspector details, endpoint navigation, preview
visibility, and preview tool availability/counts. Remaining
`ScoreData.connections` usage is in parser/validator diagnostics and generic
parsed-score compatibility tests, not in the primary editor connection command
path.

### 2026-08-20: Preview hidden-track connection fallback deleted

- Narrowed `getHiddenConnectionPairs(...)` so it no longer accepts `ScoreData`
  and cannot read `ScoreData.connections`.
- Updated `editor-preview-panel.tsx` to derive hidden tie/slur endpoint pairs
  only from the current domain document.
- Deleted the obsolete `noteConnections` fixture data from
  `editor-preview-track-visibility.test.ts`; tests now document domain-only
  hidden connection projection.
- Verified no editor component/hook/test residual reads of:
  `scoreData.connections`, `connections?.noteConnections`, `noteConnections`,
  `buildTieDetails`, `buildSlurDetails`, or `entityConnections`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-preview-track-visibility event-inspector-connections use-connection-operations editor-domain verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 editor-facing tie/slur connection interaction no longer depends on
legacy parsed connection maps. Remaining `ScoreData.connections` references
should be treated as parser/validator diagnostics or removed separately if the
domain validator fully replaces them.

### 2026-08-20: Add Tie product validation moved from parsed score meta to domain document

- Added `validateDomainTieCreation(...)` in
  `apps/customer-web/src/hooks/editor/use-connection-operations.ts`.
- The Add Tie two-click flow now validates:
  - both endpoints resolve to domain note atoms by MusicXML source id;
  - both endpoints are on the same domain staff;
  - selected note atoms have the same pitch including alter;
  - no pitched domain event on the same staff sits between the two endpoint
    events.
- Removed `useConnectionOperations(...)`'s `scoreData` parameter. The hook no
  longer uses parsed `ScoreData` meta ticks or the previous
  `measureIndex * 1000000` ordering approximation for Add Tie validation.
- Updated `editor-preview-panel.tsx` to call
  `useConnectionOperations({ currentXml })`.
- Added pure helper coverage for valid tie creation, non-adjacent endpoints,
  different pitches, and different staves.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-connection-operations`;
  - `npm.cmd run test -- editor-preview-track-visibility event-inspector-connections use-connection-operations editor-domain verovio-surface-migration editor-preview-panel-add-mode`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 editor connection creation now uses domain relationships for writes and
domain note atoms/events for Add Tie product validation. Parser
`ScoreData.connections` should remain only if parser/validator diagnostics still
need it.

### 2026-08-20: Connection add-mode selection state narrowed to source-id targets

- Updated `useConnectionOperations(...)` so the first click in Add Tie / Add Slur
  stores a `SelectedConnectionTarget` containing only a stable source-id key and
  source ids.
- Removed `EntityLocation` and parsed-event objects from the connection
  selection state. Parsed events are still accepted at the preview boundary only
  to validate note/chord clicks and extract MusicXML source ids.
- Removed unused `selectedNotesForTie` / `selectedNotesForSlur` return values
  from the hook API; no UI consumer used them.
- Updated `editor-preview-panel.tsx` to call
  `handleAddTieSelection(selection.event, sourceId)` and
  `handleAddSlurSelection(selection.event, sourceId)`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-connection-operations editor-preview-panel-add-mode verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 connection add-mode state is now source-id-first. The remaining parsed
event boundary in connection tools is the preview click adapter, which still
passes a parsed event to distinguish note/chord/rest clicks and source-id
membership.

### 2026-08-20: Add Tie / Add Slur hook inputs narrowed to connection source-id targets

- Added `ParsedEventConnectionTarget` and `getParsedEventConnectionTarget(...)`
  to `parsed-event-selection.ts`.
- Preview connection add-mode now resolves source ids from domain note-atom
  render anchors first; parsed event source ids are used only as the click-hit
  adapter fallback.
- Updated `useConnectionOperations(...)` so `handleAddTieSelection(...)` and
  `handleAddSlurSelection(...)` accept only `{ sourceIds }`.
- Moved note/chord/rest click validation to the preview boundary, where the
  parsed event hit still exists. The connection hook no longer receives parsed
  events for Add Tie / Add Slur.
- Added tests proving:
  - domain note-atom anchor source ids win over legacy render ids;
  - connection targets are created from domain source ids;
  - non-pitched parsed events do not create connection targets.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- parsed-event-selection use-connection-operations editor-preview-panel-add-mode verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 Add Tie / Add Slur creation is now source-id-target based at the hook
boundary. Remaining parsed event usage in connection operations is limited to
delete tie/slur toolbar actions and the preview click adapter's temporary
note/chord/rest discrimination.

### 2026-08-20: Delete Tie / Delete Slur hook inputs narrowed to connection source-id targets

- Updated `useConnectionOperations(...)` so `handleDeleteTie(...)` and
  `handleDeleteSlur(...)` accept the same `{ sourceIds }` connection target used
  by Add Tie / Add Slur.
- Removed `ParsedScoreEvent` from the connection hook entirely. The hook now
  treats all connection toolbar operations as source-id-target operations.
- Updated `editor-preview-panel.tsx` so Delete Tie / Delete Slur resolve a
  pitched connection target at the preview boundary. Non-note/chord clicks are
  rejected there with the existing note/chord-only toast.
- Kept domain note-atom source ids as the preferred target source; parsed event
  source ids remain only as the preview click adapter fallback.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- parsed-event-selection use-connection-operations editor-preview-panel-add-mode verovio-surface-migration event-inspector-connections`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 connection toolbar operations are now source-id-target based at the hook
boundary. Remaining parsed event usage is localized to the preview click
adapter and non-connection entity edit/delete flows.

### 2026-08-20: Editor connection target adapter extracted from parsed-event selection

- Added `apps/customer-web/src/lib/editor/connection-target.ts`.
  - It owns conversion from a transitional parsed preview selection to a
    `{ sourceIds }` connection target.
  - It prefers domain note-atom render-anchor source ids and uses parsed event
    source ids only as the preview click fallback.
- Narrowed `parsed-event-selection.ts` back to its original responsibility:
  wrapping a Verovio parsed-event hit with its optional domain anchor companion.
- Updated `editor-preview-panel.tsx` and `use-connection-operations.ts` to
  import `ConnectionTarget` from the new editor module.
- Added `connection-target.test.ts` and moved connection-target source-id tests
  out of `parsed-event-selection.test.ts`.
- Module boundary note: `lib/editor/connection-target.ts` is the editor click
  target adapter; `lib/musicxml/connection-targets.ts` remains MusicXML endpoint
  ordering/parsing infrastructure and should not take preview UI dependencies.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- connection-target parsed-event-selection use-connection-operations editor-preview-panel-add-mode verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 connection target adaptation is now isolated without adding compatibility
aliases. The next cleanup should inspect whether `editor-preview-panel.tsx` still
has small connection-tool branching that can be made declarative without hiding
behavior behind a broad abstraction.

### 2026-08-20: Preview connection tool branching deduplicated locally

- Updated `editor-preview-panel.tsx` to use a local `runConnectionTool(...)`
  helper inside the click handler for Add Tie, Add Slur, Delete Tie, and Delete
  Slur.
- Kept the helper local instead of extracting a new module because it only
  coordinates preview click target resolution, operation execution, and toast
  rendering in one React handler.
- No behavior or compatibility path was added; this is a readability cleanup
  after the connection operations were narrowed to `ConnectionTarget`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- connection-target parsed-event-selection editor-preview-track-visibility event-inspector-connections use-connection-operations editor-domain verovio-surface-migration editor-preview-panel-add-mode`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next leave connection toolbar cleanup alone unless behavior
changes require it. The higher-value remaining work is ordinary entity
edit/delete and Inspector legacy DTO boundaries.

### 2026-08-20: Legacy parsed-location entity delete fallback removed

- Updated `useEntityEditor().handleDeleteEntity(...)` so deletion requires a
  domain anchor and always routes through the editor-domain `deleteEvent` draft
  plus MusicXML export.
- Updated `editor-preview-panel.tsx` to pass only `selection.domainAnchor` for
  delete-mode clicks.
- Removed the legacy parsed-location XML delete helper:
  - `apps/customer-web/src/hooks/editor/entity-editor/delete-entity.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/delete-entity.test.ts`;
  - the `deleteEntity` barrel export from `entity-editor/index.ts`.
- Updated the domain delete integration test to call the narrowed
  `handleDeleteEntity(domainAnchor)` API.
- Added a Verovio migration sentinel that prevents re-exporting
  `./delete-entity` or reintroducing `deleteEntity(...)` in `use-entity-editor`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-entity-editor-add-mode entity-editor verovio-surface-migration editor-preview-panel-add-mode`;
  - `npm.cmd run test -- use-entity-editor-add-mode entity-editor verovio-surface-migration editor-preview-panel-add-mode commands musicxml-exporter musicxml-importer`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 ordinary entity delete is now domain-only. The remaining high-value
legacy mutation boundary is `update-existing-entity.ts`, which still edits
MusicXML by parsed `EntityLocation`.

### 2026-08-20: Legacy parsed-location entity update fallback removed

- Removed the Event Inspector fallback that converted an edit state into an
  `InspectorWritableEntity` and called `useEntityEditor().updateEntity(...)`.
- Updated unsupported Inspector edits to fail explicitly with a domain-command
  missing message instead of silently using a legacy XML mutation path.
- Removed `useEntityEditor().updateEntity(...)` and its dependencies on parsed
  `EntityLocation` mutation.
- Deleted the legacy parsed-location update/mutation infrastructure:
  - `apps/customer-web/src/hooks/editor/entity-editor/update-existing-entity.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/update-existing-entity.test.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/inspector-writable-entity-validation.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/musicxml-mutation-context.ts`;
  - `apps/customer-web/src/hooks/editor/entity-editor/musicxml-mutation-context.test.ts`.
- Removed `InspectorWritableEntity` from `score-types.ts` and deleted the
  domain-draft-to-legacy-writable conversion helpers from Event Inspector
  adapters.
- Updated migration sentinels so they now prevent reintroducing
  `InspectorWritableEntity`, `updateExistingEntity`, `deleteEntity`, or the
  parsed-location mutation files.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-event-model event-inspector-domain-adapter event-inspector-domain-save use-entity-editor-add-mode entity-editor verovio-surface-migration`;
  - `npm.cmd run test -- event-inspector-event-model event-inspector-domain-adapter event-inspector-domain-save use-entity-editor-add-mode entity-editor verovio-surface-migration commands musicxml-exporter musicxml-importer editor-preview-panel-add-mode`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 no longer has ordinary entity parsed-location XML mutation helpers.
Remaining editor migration work should focus on reducing transitional
`ParsedScoreEvent` / `EntityLocation` read-selection DTOs and deciding whether
parser `ScoreData.connections` remains diagnostic-only infrastructure.

### 2026-08-20: Event Inspector event display narrowed to domain view model

- Added event-level stem notation to the editor-domain Inspector view model:
  - `PitchedEventInspectorViewModel.stemDirection`;
  - `NoteAtomInspectorViewModel.stemDirection`;
  - `getInspectorViewModelForSelection(...)` and
    `getInspectorViewModelForEvent(...)` now read
    `ScoreDocument.notationControls` through `getEventStemDirectionOverride(...)`.
- Updated `useEditingDomainInspectorViewModel(...)` so both anchor-based and
  document-lookup view models carry notation controls from the current domain
  document.
- Updated the Event Inspector domain adapter so editable Inspector state derives
  stem direction from the domain view model instead of being passed a parsed
  legacy event stem value.
- Updated `event-inspector.tsx` so the event panel opens only when the current
  selection has a supported domain Inspector view model. A plain
  `editingSelection.legacyEvent` no longer makes the Inspector render an event
  panel.
- Removed legacy parsed-event fallback for Inspector reselect source ids,
  selected MusicXML source id, summary measure/voice values, and connection
  endpoint fallback navigation. Endpoint navigation now requires a resolvable
  domain note-atom anchor; parsed `ScoreData` lookup is retained only to attach
  the temporary legacy companion context when the source id can also be found
  there.
- Kept `EditingSelectionState.legacyEvent` as temporary companion state because
  preview selection still writes it in several paths. It is no longer the source
  of truth for Inspector event display or event edit source ids.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- event-inspector-domain-view-model inspector-view-model event-inspector-domain-save event-inspector-event-model verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 should next remove the remaining preview/select-edit legacy companion
dependency: make preview hit resolution open domain anchors directly, then
delete `useEditingDomainEvent` document-lookup fallback from
`editingSelection.legacyEvent`.

### 2026-08-20: Select/edit domain lookup fallback removed

- Narrowed `SelectEditSelection` so `domainCompanion` is required. The
  `createSelectEditSelection(...)` adapter now returns `null` when a parsed
  Verovio hit cannot be paired with a domain companion, so ordinary select/edit
  no longer opens an Inspector event panel from legacy parsed data alone.
- Removed the `useEditingDomainEvent(...)` fallback that resolved the current
  domain event from `editingSelection.legacyEvent.meta.sourceIds`.
  - Deleted `getParsedScoreEventMusicXmlSourceIds(...)`.
  - Deleted `findDomainVoiceEventForParsedScoreEvent(...)`.
  - Removed the transitional `documentLookup` `viewModelSource`.
- Updated Event Inspector domain-save fixtures to explicitly provide domain
  anchors. Tests now derive anchors from XML source ids through the domain
  importer instead of relying on legacy-only selection state.
- Updated add-mode insertion so the inserted event is selected with a domain
  event anchor found from the new XML and inserted source ids.
- Updated undo/redo selection refresh so it preserves an existing domain anchor
  when that anchor still exists in the imported domain document, and attaches
  refreshed legacy parsed context only when available.
- Removed the unused legacy-only `useEntityEditor().handleEditEntity(...)`
  entrypoint so new code cannot open the Event Inspector without a domain
  selection.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- use-editing-domain-event select-edit-selection select-edit-selection-flow use-entity-editor-add-mode entity-editor event-inspector-domain-save event-inspector-domain-view-model inspector-view-model`;
  - `npm.cmd run test -- use-editing-domain-event select-edit-selection select-edit-selection-flow use-entity-editor-add-mode entity-editor event-inspector-domain-save event-inspector-domain-view-model inspector-view-model verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 select/edit Inspector display now requires domain identity. The next
cleanup should remove or narrow APIs that can still open legacy-only selections,
starting with `EditingSelectionState.legacyEvent` consumers that only support
parsed-score highlight/history companion behavior.

### 2026-08-20: Global editing selection state made domain-only

- Removed parsed-score companion fields from `EditingSelectionState`:
  - `legacyEvent`;
  - `legacyLocation`.
- Narrowed `openEditingSelection(...)` so global editor selection stores only
  the canonical `domainAnchor` and optional domain companion.
- Narrowed `SelectEditSelection` so the preview select/edit adapter carries only
  `domainCompanion` and parity diagnostics. Parsed Verovio hits remain local to
  the preview click adapter for hit validation and parity comparison; they are
  no longer persisted in editor state.
- Updated Event Inspector save, connection endpoint navigation, add-mode insert,
  and undo/redo refresh so they keep a domain selection active without writing a
  parsed event/location back into global state.
- Updated preview highlighting so selected source ids and selection color derive
  from `editingSelection.domainAnchor` plus the current domain document, not
  parsed event metadata.
- Updated migration sentinels to forbid `selectedLegacyEvent` in preview
  highlighting.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-state-context use-editing-domain-event select-edit-selection select-edit-selection-flow use-entity-editor-add-mode event-inspector-domain-save editor-preview-track-visibility editor-preview-panel-add-mode verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 global editor selection is now domain-native. The next cleanup should
focus on parsed-hit adapter naming and scope: `ParsedEventSelection`,
`findParsedScoreEventByRenderId`, and `domain-selection-parity` are still useful
as temporary preview/parser parity infrastructure, but they should not be
described as edit state or command context.

### 2026-08-20: Preview parsed-hit adapter naming clarified

- Renamed the preview parsed-hit wrapper away from selection-state language:
  - `parsed-event-selection.ts` -> `preview-parsed-hit.ts`;
  - `ParsedEventSelection` -> `PreviewParsedHit`;
  - `toParsedEventSelection(...)` -> `toPreviewParsedHit(...)`.
- Renamed the Inspector-open adapter away from parsed selection language:
  - `select-edit-selection.ts` -> `domain-edit-context.ts`;
  - `SelectEditSelection` -> `DomainEditContext`;
  - `createSelectEditSelection(...)` -> `createDomainEditContext(...)`;
  - `useEntityEditor().handleSelectEditSelection(...)` ->
    `handleDomainEditContext(...)`.
- Updated `editor-preview-panel.tsx`, connection target helpers, tests, and
  migration sentinels to use the new names.
- Cleaned `domain-selection-parity.ts` internal naming from `legacyNotes` /
  `legacyNote` to `parsedNotes` / `parsedNote`, preserving the module's role as
  parsed-hit versus domain-companion diagnostics.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- preview-parsed-hit connection-target domain-edit-context domain-edit-context-flow domain-selection-parity editor-preview-panel-add-mode verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 naming now reflects the architecture: global selection is domain state;
parsed hits are preview-local adapter context. The next cleanup should inspect
whether `findParsedScoreEventByRenderId(...)` is still needed for add-mode
placement and connection target validation, or whether those preview branches
can use domain render anchors directly.

### 2026-08-20: Preview add-mode and connection targets reduced parsed-hit dependency

- Refactored preview connection target resolution so tie/slur add/delete tools
  consume domain anchors and current `ScoreDocument` relationships instead of
  `PreviewParsedHit` DTOs.
  - `apps/customer-web/src/lib/editor/connection-target.ts` now resolves
    source ids from domain note-atom render anchors first, then from
    domain pitched events through `getVoiceEventMusicXmlElementIds(...)`.
  - `apps/customer-web/src/lib/editor/connection-target.test.ts` now uses
    editor-domain fixtures instead of parsed preview event fixtures.
- Refactored preview add-mode click and hover placement so insertion no longer
  depends on an existing parsed note/rest/space hit. It resolves measure/staff
  geometry, active track, rhythmic grid, visible tracks, and domain document
  placement through `resolveRhythmicInsertPlacement(...)`.
- Kept `findParsedScoreEventByRenderId(...)` only on the select/edit branch,
  where it still supplies temporary parser-hit parity diagnostics for
  `createDomainEditContext(...)`.
- Updated migration sentinels so `editor-preview-panel.tsx` is not allowed to
  reintroduce `toPreviewParsedHit(...)`.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-preview-panel-add-mode rhythmic-insert-placement connection-target use-connection-operations verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 preview tools are now closer to the intended architecture: add-mode
placement and connection operations are domain/geometry based, not
parsed-event based. The next cleanup should decide whether select/edit still
needs parser-hit parity diagnostics; if not, `PreviewParsedHit`,
`findParsedScoreEventByRenderId(...)` usage in `editor-preview-panel.tsx`, and
`domain-selection-parity.ts` can be narrowed or deleted.

### 2026-08-20: Preview parsed-hit parity bridge deleted

- Removed the remaining select/edit dependency on parsed preview hits:
  - `editor-preview-panel.tsx` no longer imports or calls
    `findParsedScoreEventByRenderId(...)`;
  - select/edit now creates a `DomainSelectionCompanion` from the resolved
    domain anchor and passes it directly to
    `useEntityEditor().handleDomainSelectionCompanion(...)`.
- Deleted the now-empty transition modules and tests:
  - `apps/customer-web/src/lib/editor/preview-parsed-hit.ts`;
  - `apps/customer-web/src/lib/editor/preview-parsed-hit.test.ts`;
  - `apps/customer-web/src/lib/editor/domain-edit-context.ts`;
  - `apps/customer-web/src/lib/editor/domain-edit-context.test.ts`;
  - `apps/customer-web/src/lib/editor/domain-edit-context-flow.test.ts`;
  - `apps/customer-web/src/lib/editor/domain-selection-parity.ts`;
  - `apps/customer-web/src/lib/editor/domain-selection-parity.test.ts`.
- Removed `findParsedScoreEventByRenderId(...)` and `VerovioParsedEventHit`
  from `apps/customer-web/src/lib/editor/verovio-entity-map.ts`, along with
  tests that only validated that deleted reverse-lookup bridge.
- Updated migration sentinels so `editor-preview-panel.tsx` must not reintroduce
  `findParsedScoreEventByRenderId(...)`, `createDomainEditContext(...)`,
  `toPreviewParsedHit(...)`, or `data-domain-selection-parity`.
- Updated `docs/engineering/plans/editor-domain-model-refactoring-plan.md` so
  the current next step no longer says parser-hit parity still needs a decision.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-preview-panel-add-mode connection-target use-connection-operations verovio-surface-migration use-entity-editor-add-mode use-editing-domain-event editor-state-context verovio-entity-map`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 no longer has parsed-hit edit context or parser/domain parity adapter
in production code. The next high-value task is first-class caret/gap anchors:
empty measures and empty spans should be selected as domain editor concepts,
not through Verovio spaces or parsed event DTOs.

### 2026-08-20: Add-mode placement now returns domain insertion anchors

- Extended `resolveRhythmicInsertPlacement(...)` so every resolved placement
  carries a domain `InsertionAnchor`.
  - When the snapped position falls inside a derived `TimelineGap`, placement
    returns a `timelineGap` insertion anchor.
  - Otherwise placement returns a caret insertion anchor.
- Kept derived gaps outside `ScoreDocument`. `useEditorDomainRenderAnchors()`
  now exposes `gaps` from `useEditorDomainDocument()`, and preview passes those
  gaps explicitly to the placement adapter as `timelineGaps`.
- Added focused test coverage for both empty-staff caret insertion and
  timeline-gap insertion-anchor resolution.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- rhythmic-insert-placement editor-preview-panel-add-mode use-editor-domain-render-anchors verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 now has a domain-native insertion-anchor value at the preview placement
boundary. The next step is to thread `InsertionAnchor` into add commands instead
of continuing to use only legacy `AddLocation.tick` at the command boundary.

### 2026-08-20: Add-mode command boundary now consumes InsertionAnchor

- Updated preview add-mode execution so `handleAddEntity(...)` receives the
  domain `InsertionAnchor` produced by `resolveRhythmicInsertPlacement(...)`.
- Updated `useEntityEditor().handleAddEntity(...)` and
  `applyAddModeDomainInsert(...)` to consume `InsertionAnchor` instead of
  `AddLocation`.
- Reworked add-mode domain insertion to resolve `voiceId`, `staffId`, and
  `MusicalPosition` from the insertion anchor. Event ids are now generated from
  domain ids and rhythmic offset rather than from UI measure/staff/tick indexes.
- Narrowed inserted-source lookup after add-mode writes so it finds the newly
  inserted parsed event by the generated source id instead of by legacy
  `AddLocation` fields.
- Kept `AddLocation` only in preview placement state for UI caret/mobile
  comparison while the visual layer still needs pixel/tick display metadata.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- add-mode-domain-insert use-entity-editor-add-mode editor-preview-panel-add-mode rhythmic-insert-placement verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 add-mode explicit-rest write commands are now domain-anchor based. The
next step is visible caret/gap selection state: preview can already compute
caret/gap insertion anchors, but the editor still treats them as transient add
mode placement rather than selectable editor state.

### 2026-08-20: Active insertion anchor stored in editor state

- Added `activeInsertionAnchor` and `setActiveInsertionAnchor(...)` to
  `EditorStateContext`.
- Updated preview add-mode so hover/click placement writes the current domain
  `InsertionAnchor` into editor state and clears it on:
  - tool change;
  - Escape;
  - non-mobile mouse leave;
  - confirmed insertion.
- Exposed `data-active-insertion-anchor-kind` on `editor-preview-panel.tsx` as
  a lightweight visible/testable state bridge for future caret/gap UI.
- Corrected `DomainAnchor.kind === 'caret'` so it carries a full
  `MusicalPosition` rather than only `measureId`; `domainAnchorToEditorSelection`
  no longer fabricates caret offset `0`.
- Added `insertionAnchorToDomainAnchor(...)` so caret and timeline-gap insertion
  anchors can become domain anchors without losing rhythmic position.
- Verified from `apps/customer-web`:
  - `npm.cmd run test -- editor-state-context selection-adapter render-anchors editor-preview-panel-add-mode rhythmic-insert-placement verovio-surface-migration`;
  - `npm.cmd run typecheck`;
  - `npm.cmd run lint`.

REC-007 now has global editor state for the active add-mode insertion target.
The next decision is product/UX semantics: timeline-gap anchors can now be
selected technically, but the UI should decide whether clicking an empty span
opens a gap Inspector, materializes a rest, or remains command-only until
explicit gap tools exist.

### 2026-08-20: Active insertion anchor narrowed to note-entry insertion preview

- Renamed the editor state surface from selection-like
  `activeInsertionAnchor` to note-entry `insertionPreview`.
- `EditorStateContext` now stores a nullable insertion preview object with
  `anchor` and `inputDuration`, making the state explicitly tied to Add / Note
  Entry preview instead of ordinary selection.
- Renamed the preview-panel local caret overlay state from `insertPreview` to
  `addModePreview` so the local pixel/mobile preview is not confused with the
  global note-entry insertion preview.
- Replaced `data-active-insertion-anchor-kind` with
  `data-insertion-preview-kind`.
- This corrects the product semantics after the Dorico-style interaction review:
  ordinary selection remains event-based, while empty-space hover/click targets
  belong to Note Entry / Add mode as insertion previews and commands.

REC-007 should continue from this clarified boundary: build pitched note-entry
commands and richer insertion preview visuals, not a generic empty-space
Inspector selection model.

### 2026-08-20: First pitched note-entry command added

- Extended `AddModeInsertCommand` from explicit-rest-only to a union supporting:
  - `insertExplicitRest`;
  - `insertPitchedEvent`.
- Added `createDefaultAddModePitchedEventCommand()` as the first minimal note
  input command. It inserts a quarter-note `C4` by default and reuses the same
  `InputDuration` model as rest input.
- Updated add-mode domain insertion id generation so explicit rests use
  `add-rest-*` ids and pitched insertion uses `add-note-*` event ids plus a
  deterministic `*-note-1` note-atom/source id.
- Added tests proving pitched add-mode commands create domain `PitchedEvent`
  values and export back to MusicXML as real pitched `<note>` elements.

REC-007 now has the command-layer foundation for Note Entry. The next step is
UI state and interaction: expose a note input tool/pitch state, make the
insertion preview show a ghost pitched note for note input and a rest/caret for
rest input, then route clicks to `insertPitchedEvent` when note input is active.

### 2026-08-20: Add-mode duration selection converted to Note Entry toolbar

- Replaced the Add-mode duration dropdown with a left-sidebar Note Entry
  duration toolbar.
- Exposed six explicit duration tools:
  - whole;
  - half;
  - quarter;
  - eighth;
  - 16th;
  - 32nd.
- Renamed the UI copy from rest-specific `Rest Duration` to `Note Entry
  Duration`, because the selected `InputDuration` is shared by future note and
  rest input.
- Kept placement grid separate from duration selection. The duration tool
  controls inserted event length; the placement grid controls legal caret /
  insertion positions.
- Added sidebar interaction coverage proving users can switch from quarter to
  half and 32nd durations without changing placement grid state.

REC-007's next UI step is input-kind selection: Add / Note Entry should let the
user choose rest input or pitched note input explicitly. Pitched input should not
ship as a hidden hard-coded `C4` behavior; `C4` can remain a command/test
default until a visible pitch-entry control exists.

### 2026-08-20: Add-mode input type made explicit

- Added `AddModeInputState` with explicit `kind: "rest" | "pitched"` and a
  visible current pitch value.
- Added `addModeInput` / `setAddModeInput(...)` to `EditorStateContext`.
- Added a left-sidebar Add / Note Entry input-type toolbar:
  - Rest Input;
  - Note Input (C4).
- Replaced fixed explicit-rest command construction in
  `editor-preview-panel.tsx` with `createAddModeInsertCommand(...)`, so click
  and hover/mobile preview commands come from the visible add-mode input state.
- Added tests proving:
  - the sidebar exposes and updates the input type;
  - preview click dispatches `insertPitchedEvent` when Note Input is active;
  - command construction cannot silently regress to rest-only insertion.

REC-007 now has visible rest-vs-note input selection. The remaining interaction
gap is pitch resolution: `C4` is visible but still static. The next mature step
is a pitch-entry resolver that maps pointer Y / staff / clef to pitch for ghost
note preview and insertion, then updates `addModeInput.pitch` before command
execution.

### 2026-08-20: First staff-position pitch resolver wired into Note Input

- Added `staff-pitch-resolver.ts` as a pure editor adapter for mapping staff
  vertical pointer position to a diatonic pitch.
- The first resolver supports treble and bass clefs using bottom-line anchors:
  - treble bottom line: E4;
  - bass bottom line: G2.
- Updated Add / Note Entry preview so Note Input no longer inserts a fixed
  hidden C4. Pointer hover/click resolves the active staff, clef, and `clientY`
  into `addModeInput.pitch`, then builds `insertPitchedEvent` from that visible
  state.
- Updated the Note Input sidebar button so it displays the current pitch label
  instead of hard-coding `C4` into copy.
- Added focused tests for treble/bass pitch mapping, visible pitch labels, and
  preview pitched insertion with the resolved pointer pitch.

Current limitations are intentional and documented: this first resolver is
diatonic only. Accidentals, key signatures, ledger-line range policy, clef
changes inside a measure, and proper ghost notehead vertical rendering are still
future work.

### 2026-08-20: Note Input ghost notehead preview added

- Extended the staff pitch resolver to return both the snapped `Pitch` and the
  snapped staff `centerY` used by the preview layer.
- Updated Add / Note Entry preview state so Note Input carries a `pitchStyle`
  for the current ghost notehead.
- Added a lightweight ghost notehead overlay:
  - only appears for Note Input;
  - shares the insertion caret's rhythmic x position;
  - uses the pitch resolver's snapped y position;
  - inherits the active track color with low opacity.
- Rest Input keeps the vertical insertion caret only.
- Added component coverage proving Rest Input does not show the ghost notehead
  and Note Input does.

This is intentionally a visual MVP. It does not yet draw stems, ledger lines,
accidentals, duration-specific notehead shapes, or true Verovio-native preview
glyphs.

### 2026-08-20: Ghost notehead ledger lines added

- Extended `StaffPitchPosition` with:
  - `diatonicOffsetFromBottomLine`;
  - `lineSpacing`.
- Added `getLedgerLineOffsets(...)` to derive ledger line positions from the
  snapped diatonic staff offset.
- Updated Note Input ghost preview so notes outside the five staff lines render
  short ledger lines behind the translucent notehead.
- Added resolver and preview tests for above-staff ledger lines and in-staff
  notes without ledger lines.

Remaining ghost preview limitations: stems, accidentals, key-signature-aware
pitch spelling, duration-specific notehead shapes, lower/upper range policy, and
Verovio-native glyph rendering are still not implemented.

### 2026-08-20: Add-mode rhythmic grid overlay added

- Clarified the Add / Note Entry interaction gap: before this change the
  placement grid affected snapping only; the UI still rendered only the vertical
  insertion caret.
- Extended `resolveRhythmicInsertPlacement(...)` to expose every rhythmic layout
  grid x position as `gridLines`.
- Updated `editor-preview-panel.tsx` so Add mode hover renders subtle vertical
  grid lines across the active staff/measure area.
- The caret remains the active insertion target; the grid overlay is a visual
  guide derived from the same `RhythmicLayoutMap`.
- Added tests proving:
  - placement returns the grid line x positions;
  - preview hover renders the expected number of grid lines for a 16th grid in
    4/4.

REC-007 now has the missing Dorico-style visual grid foundation. Next work can
continue with duration-specific ghost notehead shapes or finer visual polish for
grid density/opacity.

### 2026-08-20: Rhythmic grid overlay moved above the staff

- Adjusted the Add / Note Entry rhythmic grid overlay after product review
  against Dorico.
- Replaced full-height staff-crossing grid lines with short orange markers
  positioned above the active staff.
- Kept the same `RhythmicLayoutMap` / `gridLines` source of truth; only the
  visual projection changed.
- The insertion caret and ghost notehead remain on the staff, while the grid
  markers now act as a non-overlapping timing guide.
- Updated component coverage so the preview asserts short grid markers rather
  than staff-crossing grid lines.

This better matches the desired professional editor behavior: the rhythmic grid
is visible, but it does not visually collide with notes, staff lines, ledger
lines, or the ghost notehead.

### 2026-08-20: Add-mode grid markers filtered by selected input duration

- Corrected a semantic mismatch in Add / Note Entry grid rendering:
  - the previous grid overlay showed every caret boundary;
  - in 4/4 with a quarter grid that produced five markers: offsets `0, 1, 2,
    3, 4`;
  - the final offset `4` is the measure-end caret boundary, not a legal start
    for inserting a quarter note/rest inside that measure.
- Added optional `inputDuration` to `resolveRhythmicInsertPlacement(...)`.
- When `inputDuration` is present, placement now filters grid markers and
  snapping candidates to positions where `offset + inputDuration <=
  measureDuration`.
- Add / Note Entry preview passes the selected input duration into placement, so
  visual grid markers and pointer snapping now represent legal starts for the
  selected duration.
- Example: in 4/4 with quarter input, users now see four legal starts instead
  of five caret boundaries.

This keeps a clean distinction between future caret-only navigation boundaries
and current add-command insertion starts.

### 2026-08-20: Duration-specific ghost notehead shape added

- Added duration-aware ghost notehead rendering for Add / Note Entry preview.
- Whole and half input durations now render an open notehead:
  - track-colored border;
  - transparent fill.
- Quarter and shorter input durations continue to render a filled notehead.
- Kept this deliberately limited to notehead shape. Stems, flags, beams, dots,
  and rest glyph previews are not implemented in this step.
- Added component coverage for:
  - open ghost notehead when half duration is selected;
  - filled ghost notehead when quarter duration is selected.

REC-007 Note Entry preview now reflects pitch, ledger lines, rhythmic grid, and
basic duration class. The next visual step should be either dotted-duration
preview or rest glyph preview, depending on which input mode needs polish first.

## Reusable completion checklist for every refactor

- [ ] Ownership and public API are documented.
- [ ] No circular or forbidden dependency is introduced.
- [ ] Unit tests cover the extracted behavior; critical flows have integration coverage.
- [ ] API/schema changes regenerate and validate client contracts.
- [ ] Relevant lint, type, test, build, container, and manifest checks pass.
- [ ] Documentation indexes and relative links remain valid.
- [ ] Migration/rollback is reversible or explicitly approved.
