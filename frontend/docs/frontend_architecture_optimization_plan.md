# Frontend Architecture Optimization Plan

> Baseline date: 2026-06-18  
> Scope: frontend structure, tests, React Query conventions, MusicXML modularization, oversized pages, shared score rendering, Verovio migration, and final OSMD removal.

## 1. Purpose

This plan turns the current frontend maintenance principles into an executable task board. It is based on the current code rather than file-size assumptions alone.

The intended outcome is:

- establish regression protection before moving domain code;
- make page files orchestration layers instead of lifecycle and domain monoliths;
- consolidate MusicXML and score-rendering ownership;
- standardize server-state keys, invalidation, and errors;
- migrate every browser-side MusicXML renderer and interactive score surface to a shared Verovio path;
- remove OSMD and its compatibility code only after feature parity is proven.

This is an incremental plan. Each phase must leave the application usable and pass the quality gates.

## 2. Current Baseline

### 2.1 Quality and tooling

- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` exists but was not rerun during this planning pass.
- There is no `test` script and no frontend test file.
- `package.json` still uses the starter name `nextn`.
- The older roadmap recommends Jest and React Testing Library, but this plan now selects Vitest and React Testing Library for the frontend baseline.
- MSW is optional for request-level integration tests, and Playwright owns browser E2E and visual behavior.
- Backend FastAPI tests continue to use pytest; the frontend stack does not replace pytest.
- The current local runtime is Node.js 22.14.0 with npm 10.9.2, which is the baseline to verify when pinning the selected test-tool versions.

### 2.2 Largest route pages

| Route | Lines | Main responsibilities currently mixed together |
| --- | ---: | --- |
| `practice/[id]/page.tsx` | 1091 | session lifecycle, WebSocket, microphone, AudioWorklet, recording, alignment, timer, dialogs, page UI |
| `results/[id]/page.tsx` | 787 | task/XML/image loading, metadata editing, share management, fingering, download, listen modal, page UI |
| `history/page.tsx` | 759 | filters, two data sets, selection, pagination, thumbnails, batch operations, card rendering |
| `editor/[id]/page.tsx` | 715 | XML load/parse/edit/save, editor orchestration, modals, listen preview, navigation |
| `upload/page.tsx` | 620 | upload flow and UI; currently has unrelated user changes and is excluded from near-term refactors |
| `share/[shareId]/page.tsx` | 448 | access/auth flow, raw XML query, permissions, save/download/listen, page UI |
| `review/[id]/page.tsx` | 383 | review display and navigation |

### 2.3 Domain concentration

- `musicxml-parser.ts`, `musicxml-core.ts`, `musicxml-elements.ts`, `musicxml-flatten.ts`, `musicxml-connections.ts`, and `musicxml-backup.ts` are still in the `src/lib` root.
- MusicXML code is imported by editor contexts, editor hooks, results, and the practice Verovio adapter.
- `listen-modal.tsx` is 747 lines and directly manipulates OSMD cursor internals.
- `audio-preview-manager.ts` directly owns `OpenSheetMusicDisplay` and `osmd-audio-player`.
- Editor, results, and share reuse `ListenModal`, so OSMD removal is primarily a shared playback migration, not three independent page renderer swaps.
- Review currently compares authenticated original/preview image artifacts. Results and share also display backend-rendered image artifacts. Those images are not OSMD and should not be replaced merely to claim Verovio migration.
- `score-viewer.tsx` is a stale placeholder and currently has no confirmed consumer; audit it for deletion instead of moving it automatically.

### 2.4 React Query

- A central `queryKeys` factory already exists.
- Query hooks exist for tasks, XML, shares, and profile mutations.
- `share/[shareId]/page.tsx` still uses the ad hoc key `['share-xml', shareId]`.
- XML invalidation uses a raw prefix `['xml', taskId]` because the key factory has no explicit root/detail helper.
- Mutation error/toast ownership is not documented consistently.

### 2.5 Renderer direction

- Practice already renders with a practice-specific Verovio adapter.
- OSMD remains in `audio-preview-manager.ts`, `listen-modal.tsx`, audio constants, soundfont patching, and package dependencies.
- Verovio is the final renderer direction. OSMD is only a temporary migration dependency.
- The engineering principles document still contains one stale summary sentence that can be read as opposing full migration; the decision must be made unambiguous before implementation.

## 3. Priority Model

- **P0 Foundation:** remove decision ambiguity and add the layered regression net.
- **P1 Ownership:** standardize data access and move code into stable domains without changing behavior.
- **P2 Decomposition:** split the highest-risk pages along lifecycle and domain boundaries.
- **P3 Renderer migration:** build shared Verovio and playback capabilities, migrate surfaces, then remove OSMD.

The dependency chain is:

```text
P0 unit/component/E2E smoke net
  -> P1 contracts and domain ownership
  -> P2 page decomposition
  -> P3 shared Verovio/playback migration
  -> OSMD dependency removal
```

### Execution status

| Task | Status | Last update |
| --- | --- | --- |
| P0-1 Documentation and scope alignment | Completed | 2026-06-18: current principles, historical roadmap, renderer scope, and authoritative-plan links aligned |
| P0-S Dependency security baseline | Completed | 2026-06-18: full and production npm audits report 0 vulnerabilities; Next 16.2.9 and OSMD 1.9.9 minimums plus safe PostCSS/JSZip overrides verified |
| P0-2 Layered frontend test baseline | Completed | 2026-06-19: 7 Vitest tests and 3 Playwright smoke tests pass, including Chinese/English login routes; deterministic browser mocks require no backend |
| P0-3 React Query conventions | Completed | 2026-06-19: hierarchical key factories, cancellable queries, and domain-owned mutation cache policies implemented |
| P1-1 MusicXML domain package | Completed | 2026-06-19: parser, core, transforms, connections, backup, and validator moved behind a package index |
| P1-2 Component root governance | Next | Move components only with their owning page or interface changes |
| P1-3 through P3 | Pending | Follow the dependency order below |

## 4. P0 - Foundation and Guardrails

### P0-1 Resolve documentation and scope conflicts

**Goal:** ensure every maintainer follows the same renderer and refactor direction.

**Tasks:**

1. Update `frontend_engineering_principles.md` so its summary explicitly says "incremental full Verovio migration" rather than "no full renderer rewrite."
2. Treat any historical practice-first migration references in current docs as history rather than the final architecture.
3. Link this plan from `improvement-roadmap.md` and avoid duplicating task status across both documents.
4. Record that `upload/page.tsx` is temporarily excluded while its current user changes are in progress.

**Acceptance:** no current document describes OSMD as a long-term path; one document is the authoritative task board.

### P0-2 Add the layered frontend test baseline

**Goal:** protect contracts and pure behavior before moving files.

**Target files:**

- `package.json`
- `vitest.config.ts`
- `vitest.setup.ts`
- `playwright.config.ts`
- `tests/fixtures/musicxml/*`
- `tests/e2e/*`
- initial `*.test.ts` / `*.test.tsx` files

**Tasks:**

1. Add Vitest, React Testing Library, `jest-dom`, `user-event`, jsdom, and unit-test scripts: `test`, `test:unit`, `test:watch`, and optionally `test:coverage`.
2. Configure the `@/` alias, React plugin, jsdom environment, setup cleanup, and deterministic mocks for browser-only APIs.
3. Keep the default Vitest environment as Node where possible; opt component/browser-dependent files into jsdom rather than making every pure test pay the DOM cost.
4. Add a small real MusicXML fixture set outside production `src`: single page, multi-page, chords/voices, missing tempo, and malformed input.
5. Start with high-value pure and component tests:
   - query key factories and invalidation prefixes;
   - MusicXML parse/serialize round trip;
   - backup recalculation and flattening;
   - practice follow-controller commit/hold behavior;
   - Verovio sanitization and element/time mapping through a toolkit fake.
6. Add MSW only when query hooks or components need realistic request/response behavior. Reuse request handlers between tests, but keep pure parsers and query-key tests independent of MSW.
7. Add Playwright with a configured local `webServer` and an initial smoke suite for auth redirect, history loading, share permissions, and one score/practice entry path.
8. Keep Playwright E2E focused on user-visible contracts. Prefer a controlled test backend for true E2E; use Playwright routing or MSW only for deterministic frontend-only scenarios.
9. Add one resource-cleanup component test after renderer/playback interfaces exist.
10. Use Playwright, not jsdom snapshots, for real Verovio WASM rendering, resize, multi-page layout, and stable visual checks.

**Framework boundary:** Vitest does not need to render every route. Async Server Components and full Next.js routing/runtime behavior belong in Playwright. Current large route pages are client components, so their extracted hooks and components remain suitable for Vitest/RTL.

**Acceptance:** `npm run test:unit`, `npm run test:e2e`, `npm run lint`, and `npm run typecheck` pass in their documented environments. Unit/component tests require no real audio device, network, or WASM download. Browser tests use the bundled application assets and deterministic fixtures.

**Implementation note (2026-06-19):** The baseline is complete. Vitest/RTL covers query keys and MusicXML parse/serialize, backup, and flattening behavior with 3 files, 7 tests, and 5 fixtures. Playwright uses a single worker and a webpack-based Next dev server to avoid Windows npm-shim and Turbopack cold-start instability; local runs use the installed Chrome channel while CI uses Playwright Chromium. Its 3 deterministic smoke tests cover Chinese and English login pages, protected-route `returnUrl` preservation, and denied share downloads without a real backend. MSW remains optional until request-level integration coverage adds value. Local production builds require `NEXT_BACKEND_ORIGIN`; validation uses a temporary localhost value without changing environment files.

**Routing resolution (2026-06-19):** The Chinese default-route loop was caused by the E2E server binding and browser origin using `127.0.0.1` while Next emitted the internal next-intl rewrite with a `localhost` origin. Next.js 16.2.9 treated the origin mismatch as an external rewrite and surfaced a 307 redirect. Playwright now uses `localhost` consistently for its base URL, server bind address, and cookies, so `/login` resolves through the internal `/zh/login` rewrite with a 200 response. `localePrefix: 'as-needed'` remains the canonical URL policy. next-intl was upgraded from 4.11.0 to 4.13.0, and the localized login smoke now protects both languages.

**Dependency security note (2026-06-18):** The initial audit found 15 vulnerabilities, including a vulnerable Next.js 16.2.4 and legacy transitive packages under OSMD/osmd-audio-player. A non-force audit fix upgraded safe patch/transitive versions. Direct minimums are now Next.js 16.2.9 and OSMD 1.9.9. Package overrides keep PostCSS on 8.5.15 and JSZip on 3.10.1, including the legacy player subtree. Both `npm audit` and `npm audit --omit=dev` report zero vulnerabilities. Do not accept npm suggestions that downgrade Next.js or osmd-audio-player; remove the overrides only after the OSMD playback chain is retired or upstream constraints are verified safe.

### P0-3 Define lightweight React Query conventions

**Goal:** make cache behavior predictable without building a heavy framework.

**Tasks:**

1. Extend `queryKeys` with explicit roots and child factories, including share XML access.
2. Replace `['share-xml', shareId]` and raw XML prefix arrays with factory calls.
3. Document key shape as `[domain, scope, identity/filter]` and require stable serializable filters.
4. Define mutation policy:
   - domain hook owns cache update/invalidation;
   - page owns success messages tied to page context;
   - one layer owns each error toast, never both API helper and page;
   - expected inline form errors remain inline instead of global toast.
5. Pass the TanStack Query `signal` to API helpers where cancellation is useful and supported.

**Acceptance:** searches under `src/app` and `src/hooks/queries` find no ad hoc query keys; every mutation has an explicit cache policy.

**Implementation note (2026-06-19):** `queryKeys` now exposes domain roots, invalidation prefixes, and leaf factories for tasks, shares, task XML, and shared XML. Query filters are stable serializable objects. Task/share/XML query functions pass TanStack Query cancellation signals through their API helpers to `fetch`. Mutation hooks own cache invalidation or removal, while page-level success/error messages remain in pages; read-only archive generation and AuthContext-owned profile updates explicitly leave Query cache unchanged. Searches under `src/app` and `src/hooks/queries` report no ad hoc query-key arrays.

## 5. P1 - Domain Ownership and Low-Risk Moves

### P1-1 Create the MusicXML domain package

**Goal:** give MusicXML logic one discoverable boundary before further growth.

**Proposed structure:**

```text
src/lib/musicxml/
|-- index.ts
|-- parser.ts
|-- core.ts
|-- elements.ts
|-- flatten.ts
|-- connections.ts
|-- backup.ts
|-- validator.ts
`-- __tests__/
```

**Tasks:**

1. Freeze the current public exports with characterization tests.
2. Move one file at a time, beginning with leaf modules and ending with `parser.ts`.
3. Add an `index.ts` public surface, but allow direct submodule imports for performance or cycle avoidance.
4. Update editor hooks, contexts, results, and practice imports in small batches.
5. Run an import-cycle check or at minimum inspect the dependency graph after each batch.
6. Keep audio playback outside this package unless the code is a pure MusicXML timeline/parser utility.

**Acceptance:** no `musicxml-*.ts` remains in `src/lib` root; behavior and exported types remain compatible; tests/lint/typecheck/build pass.

**Implementation note (2026-06-19):** `src/lib/musicxml/` now owns `parser`, `core`, `elements`, `flatten`, `connections`, `backup`, and `validator`, with `index.ts` as the stable package surface. Static and dynamic consumers use the new paths without compatibility re-export files. Characterization coverage exercises the public package entry point, parser success/failure, parse/serialize behavior, duration and pitch normalization, backup recalculation, and multi-voice flattening. The inspected dependency graph remains acyclic: elements/flatten/validator depend on core, while parser depends only on shared score types and audio constants. Playback remains outside this package.

### P1-2 Establish component root governance

**Goal:** make component ownership obvious without a mass cosmetic move.

**Target ownership:**

- `components/editor/`: note, chord, add-entity, and draft-recovery editor dialogs.
- `components/score/`: score viewer, listen modal shell, score toolbar, renderer status/error UI.
- `components/media/`: original image viewer and future reusable media viewers, if they are not results-only.
- `components/layout/`: page shell and global navigation/layout pieces.
- `components/practice/`: practice-only viewer, controls, overlays, and completion UI.
- `components/ui/`: domain-free primitives only.

**Tasks:**

1. Move `note-editor-modal.tsx` and `chord-editor-modal.tsx` into `components/editor`.
2. Move `listen-modal.tsx` into `components/score` when its interface is stabilized. Audit the unused placeholder `score-viewer.tsx` and delete it if no real consumer exists.
3. Classify `original-image-viewer.tsx` by actual reuse before moving it.
4. Do not add compatibility re-export files unless an external package consumes these paths.
5. Add a short ownership table to the frontend principles document.
6. Perform these moves in the PR that changes the owning page or interface; do not create a standalone mass-move PR.

**Acceptance:** root components are only genuinely cross-domain entry points; import changes are mechanical and behavior-neutral.

### P1-3 Separate score rendering from score playback contracts

**Goal:** prevent the future Verovio renderer from inheriting OSMD-specific playback APIs.

**Proposed interfaces:**

- `ScoreRenderer`: load, render pages, locate elements/time, resize, dispose.
- `ScorePlaybackController`: load timeline, play, pause, seek, tempo, current position, dispose.
- `ScoreCursorController`: translate playback position to visible score focus.

**Tasks:**

1. Describe required behavior from the current `ListenModal` before implementation.
2. Remove public access to `manager.osmd` from UI code behind an adapter interface.
3. Move pure tempo/timeline extraction into `lib/musicxml` or `lib/score`.
4. Make resource ownership explicit for AudioContext, timers, soundfont resources, and renderer toolkit instances.
5. Keep an OSMD-backed adapter temporarily so the interface can be integrated before the backend is replaced.

**Acceptance:** `ListenModal` no longer reads OSMD cursor internals directly; the old backend can still satisfy the new interfaces during migration.

## 6. P2 - Oversized Page Decomposition

Each page refactor is a separate behavioral PR. Do not combine page decomposition with renderer replacement.

### P2-1 Practice page

**Priority:** first, because it is the largest page and owns the riskiest resources.

**Extract:**

- `use-practice-session`: create/resume/pause/finish and session refs;
- `use-practice-socket`: URL, connect, heartbeat, message codec, intentional close;
- `use-practice-audio-stream`: permission, AudioContext, AudioWorklet, PCM conversion/downsampling, cleanup;
- `use-practice-recording`: MediaRecorder and object URL lifecycle;
- `PracticeControls`, `PracticeStatusPanel`, and `PracticeCompletionDialog`.

**Constraints:** keep committed alignment and SVG updates in the existing viewer/controller boundary; do not move frame data into broad React state.

**Acceptance:** page owns route context and composition; every acquired resource has a tested or reviewable cleanup path; start/pause/resume/finish behavior is unchanged.

### P2-2 History page

**Extract:**

- upload/share cards and status indicator;
- filter/search/sort toolbar;
- pagination controls;
- selection and batch-action hook;
- task/share thumbnail loading hooks with cancellation and object URL cleanup.

**Acceptance:** two tabs retain independent pagination and filters; selection cannot leak across tabs; batch mutations invalidate the documented keys.

### P2-3 Results page

**Extract:**

- task metadata editor;
- score/image preview section;
- share management panel;
- fingering/export action group;
- a page orchestration hook for task/XML/image resources.

**Acceptance:** metadata, sharing, fingering, download, and listen flows remain functional; object URLs are revoked; components consume query hooks rather than duplicating fetch state.

### P2-4 Editor page

**Extract:**

- editor document load/save lifecycle hook;
- editor header/actions;
- modal orchestration;
- navigation/return behavior;
- listen preview launcher using the shared score contract.

**Acceptance:** autosave status remains reactive; source selection stays correct; editor modals live in `components/editor`; no new direct MusicXML root imports are introduced.

### P2-5 Share and review pages

**Extract:** access/auth state, permission-gated actions, score content query, and score presentation sections.

**Acceptance:** anonymous/authenticated access remains correct; `canDownload`/`canEdit` are enforced in UI; share XML uses the canonical query key.

### P2-6 Upload page after current work is merged

**Status:** deferred to avoid interfering with existing user edits.

**Later extraction targets:** upload state machine, file validation, progress/dispatch lifecycle, result navigation, and presentational sections.

**Acceptance:** no work begins until current upload changes are reconciled; reliability behavior and localized messages remain intact.

## 7. P3 - Shared Verovio Migration and OSMD Removal

### P3-1 Generalize the Verovio adapter

**Goal:** reuse proven practice code without making all score pages depend on practice semantics.

**Tasks:**

1. Move toolkit loading, MusicXML sanitization, page rendering, and generic element/time lookup into `lib/score/verovio`.
2. Keep practice-specific highlighting and commit behavior in `lib/practice`.
3. Add a shared `VerovioScoreViewer` with loading, empty, error, resize, and multi-page behavior.
4. Define instance ownership so toolkit state is not accidentally shared across simultaneous viewers.
5. Verify real fixtures visually and with DOM-level tests.

**Acceptance:** practice uses the shared adapter without regression; non-practice pages can render without importing practice modules.

### P3-2 Playback replacement technical spike

**Goal:** choose a real replacement for `osmd-audio-player`, not merely replace SVG output.

**Required parity matrix:**

- MusicXML/MIDI timeline generation;
- instrument/soundfont loading;
- play, pause, stop, seek, and tempo;
- current-note/measure cursor synchronization;
- multi-page following;
- mobile/browser support;
- AudioContext unlock and cleanup;
- acceptable bundle size and startup latency.

**Tasks:**

1. Prototype Verovio timing/MIDI output with the current soundfont path or a narrowly selected playback library.
2. Test the prototype against the fixture set and at least one large real score.
3. Record the decision and rejected alternatives in a short ADR.
4. Implement the selected backend behind `ScorePlaybackController`.

**Exit rule:** do not start removing OSMD until this spike proves all required playback and cursor behaviors or explicitly removes a product requirement with approval.

### P3-3 Migrate browser-side renderer consumers incrementally

**Order:**

1. `results` listen preview: owned score, playback, and action integration.
2. `share` listen preview: permission and anonymous-entry edge cases.
3. `editor` listen preview: editing, playback, seek, and resize complexity.
4. Practice consumes the generalized adapter while retaining practice-specific follow behavior.
5. Any remaining code that instantiates a browser-side MusicXML renderer.

Review remains an original-versus-recognized artifact comparison and should continue showing backend-rendered preview images unless product requirements explicitly change. Results/share image previews may also remain as durable backend artifacts; the migration target is their OSMD-backed interactive listen path.

For each surface:

1. Add the shared Verovio path to the interactive MusicXML renderer/playback flow.
2. Validate real single-page and multi-page scores.
3. Verify resize, error, loading, and cleanup states.
4. Verify playback/cursor parity where applicable.
5. Remove the OSMD path from that surface before moving to the next one.

**Acceptance:** no page contains renderer-specific toolkit logic; all OSMD-backed interactive consumers are migrated; visual and interaction parity is recorded per consumer. Backend-rendered artifact images remain supported.

### P3-4 Remove OSMD completely

**Tasks:**

1. Delete the OSMD adapter/backend and OSMD-specific cursor workarounds.
2. Remove `opensheetmusicdisplay` and `osmd-audio-player` dependencies.
3. Remove `patch-soundfont.ts` or rewrite it only if the selected playback backend still requires a supported equivalent.
4. Rename or rewrite OSMD-specific audio constants and comments.
5. Remove obsolete patch-package patches; remove `patch-package` itself if nothing else uses it.
6. Search source, package files, docs, and lockfile for `OSMD`, `OpenSheetMusicDisplay`, and `osmd-audio-player`.
7. Run full quality and behavior validation.

**Acceptance:** the search returns only intentional historical documentation; production dependencies and runtime code contain no OSMD path.

## 8. Cross-Cutting Quality Gates

Every task must run the smallest relevant checks. Every completed phase must run the applicable layers:

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
```

Lint, typecheck, and affected unit/component tests are the normal inner loop. Build and selected Playwright smoke tests are required before merging a behavioral or architectural change. The full Playwright suite is required at phase boundaries and before final OSMD removal.

When a change also modifies FastAPI contracts or backend behavior, run the relevant backend pytest suite as a separate gate. Do not duplicate backend business-logic tests in Vitest.

Behavior verification must cover affected flows:

- editor load/edit/autosave/listen;
- results render/share/fingering/download;
- history filters/pagination/selection/batch actions;
- share anonymous/authenticated/permission paths;
- practice start/pause/resume/finish, socket, audio, alignment, and cleanup;
- score rendering with single-page, multi-page, chord/voice, missing-tempo, and malformed samples.

Resource review is mandatory for object URLs, WebSocket, MediaStream, AudioContext, AudioWorklet, timers, AbortController, and Verovio toolkit instances.

## 9. Delivery Slices

Prefer the following PR-sized slices:

1. Documentation alignment.
2. Vitest/RTL harness plus fixtures and first pure/component tests.
3. Playwright smoke harness; add MSW only for request-level integration cases.
4. Query key/error/invalidation conventions.
5. MusicXML leaf modules, then parser migration.
6. Component ownership moves together with their owner changes.
7. Score renderer/playback interfaces with temporary OSMD adapter.
8. Practice page lifecycle extraction.
9. History page extraction.
10. Results and editor extraction in separate changes.
11. Shared Verovio adapter/viewer.
12. Playback technical spike and ADR.
13. One interactive renderer consumer per change.
14. Final OSMD removal.
15. Non-blocking cleanup: rename package `nextn` to `noteverse-pro-frontend` without changing dependency versions.

Avoid combining pure file moves, behavior changes, and dependency replacement in one change. A move should be reviewable as a move; a behavior change should have focused tests.

## 10. Completion Criteria

This plan is complete when:

- Vitest/RTL protects MusicXML, query keys, query hooks, follow behavior, components, and shared renderer/playback contracts;
- Playwright protects critical Next.js routing and user-visible flows; MSW is used only where request-level integration isolation adds value;
- query keys and mutation cache policies are centralized;
- MusicXML code has one domain package;
- heavy root components have explicit owners;
- route pages primarily compose sections and lifecycle hooks;
- all browser-side MusicXML renderers and interactive score surfaces use shared Verovio abstractions, while durable backend image artifacts remain supported;
- playback and cursor behavior no longer depend on OSMD;
- OSMD dependencies, patches, constants, and compatibility code are removed;
- lint, typecheck, tests, build, and critical behavior checks pass;
- current docs describe the resulting architecture rather than the migration history.
