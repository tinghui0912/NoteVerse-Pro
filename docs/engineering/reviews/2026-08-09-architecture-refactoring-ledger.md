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

## Confirmed findings

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

### 2026-08-09: Import execution coverage gate

- Added a focused 80% quality gate for import worker execution. The existing
  reliability tests cover durable input materialization, timeout classification,
  and failure finalization; the focused result is 86% across 5 passing tests.
- The API-facing import-job service (63%) and worker status coordinator (54%)
  remain explicitly outside this gate. They require authorization and state
  transition tests before a credible threshold can be introduced.

## Completion checklist for every refactor

- [ ] Ownership and public API are documented.
- [ ] No circular or forbidden dependency is introduced.
- [ ] Unit tests cover the extracted behavior; critical flows have integration coverage.
- [ ] API/schema changes regenerate and validate client contracts.
- [ ] Relevant lint, type, test, build, container, and manifest checks pass.
- [ ] Documentation indexes and relative links remain valid.
- [ ] Migration/rollback is reversible or explicitly approved.
