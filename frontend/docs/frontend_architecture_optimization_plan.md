# Frontend Architecture Optimization Plan

> Baseline date: 2026-06-18  
> Scope: frontend structure, tests, React Query conventions, MusicXML modularization, oversized pages, shared score rendering, Verovio migration, and final OSMD removal.
> This plan is complete. Active cross-stack cleanup work is tracked in
> `../../docs/codebase-simplification-and-security-plan.md`.

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

## 2. Historical Baseline

This section records the frontend state at the start of this completed migration. It is not the
current route inventory. Current active structure is documented in
`frontend_engineering_principles.md` and the cross-stack cleanup plan.

### 2.1 Quality and tooling

- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes with the required non-secret backend origin supplied.
- Vitest/RTL has 15 test files and 43 tests; Playwright has 6 deterministic Chromium tests.
- `package.json` uses the product package name `noteverse-pro-frontend`.
- The frontend stack is Vitest, React Testing Library, and Playwright.
- MSW is optional for request-level integration tests, and Playwright owns browser E2E and visual behavior.
- Backend FastAPI tests continue to use pytest; the frontend stack does not replace pytest.
- The current local runtime is Node.js 22.14.0 with npm 10.9.2, which is the baseline to verify when pinning the selected test-tool versions.

### 2.2 Largest route pages at baseline

| Route | Lines | Main responsibilities currently mixed together |
| --- | ---: | --- |
| `practice/[id]/page.tsx` | 509 | composes session/socket/audio/recording hooks, alignment policy, timer, and practice sections |
| `history/page.tsx` | 311 | composes independent tab queries, selection, thumbnails, batch actions, and sections |
| `editor/[id]/page.tsx` | 108 | composes editor document lifecycle, header, editor surface, and dialogs |
| `results/[id]/page.tsx` | 93 | composes result resources and domain sections |
| `share/[shareId]/page.tsx` | 55 | composes anonymous share data, permissions, preview, actions, and information |
| `upload/page.tsx` | 50 | composes the upload workflow and form |
| `review/[id]/page.tsx` | 34 | composes review data and score comparison |

### 2.3 Domain concentration

- MusicXML parsing and transformations now live behind `src/lib/musicxml/index.ts`.
- Editor contexts, editor hooks, results, and the practice Verovio adapter consume the MusicXML package or focused submodules.
- `components/score/listen-modal.tsx` composes the dialog; `hooks/score/use-score-preview-playback.ts` consumes score contracts and dynamically loads the Verovio preview controller.
- `lib/score/verovio-score-preview-controller.ts` owns interactive SVG rendering, playback, cursor synchronization, relayout, and cleanup.
- Editor, score detail, and share reuse the same `ListenModal` and have no renderer-specific page logic.
- Review uses authenticated original artifacts plus current MusicXML rendering. Score detail and share may also display backend-rendered image artifacts; those remain valid product assets outside the browser renderer.
- The stale placeholder `score-viewer.tsx` was deleted after its zero-reference audit.

### 2.4 React Query

- A central `queryKeys` factory already exists.
- Query hooks exist for tasks, XML, shares, and profile mutations.
- Share XML and task XML use canonical hierarchical query-key factories.
- Query functions pass cancellation signals through domain API helpers.
- Mutations own cache invalidation/removal while page or form owners present user feedback.

### 2.5 Renderer direction

- Practice, score detail, share, and editor use shared Verovio rendering boundaries.
- Interactive playback uses Verovio MIDI/timemap data and an owned Web Audio soundfont engine.
- UI code remains renderer-agnostic and consumes score contracts.
- Backend-rendered image artifacts remain supported independently of interactive rendering.

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
| P1-2 Component root governance | Completed | 2026-06-19: editor/media/profile/home ownership applied; unused placeholder viewer removed |
| P1-3 Renderer/playback contracts | Completed | 2026-06-19: UI contracts integrated with a private OSMD adapter and explicit disposal |
| P2-1 Practice page decomposition | Completed | 2026-06-20: session, socket, audio, recording, controls, status, and completion ownership extracted with PCM tests |
| P2-2 History page decomposition | Completed | 2026-06-20: independent tab state, selection/batch hooks, cards, toolbar, pagination, and cancellable thumbnails extracted |
| P2-3 Results page decomposition | Completed | 2026-06-20: resource orchestration, metadata, preview, actions, downloads, and sharing extracted |
| P2-4 Editor page decomposition | Completed | 2026-06-20: document lifecycle, header/actions, modal orchestration, navigation, and listen launcher extracted |
| P2-5 Share and review page decomposition | Completed | 2026-06-20: auth/access, permission actions, canonical share XML, image resources, and score presentation extracted |
| P2-6 Upload page decomposition | Completed | 2026-06-21: upload lifecycle hook, form, previews, recovery, polling, and resource cleanup extracted |
| P3-1 Shared Verovio adapter | Completed | Shared adapter/viewer now own isolated toolkit instances and generic rendering |
| P3-2 Playback replacement spike | Completed | ADR 0001 selects Verovio MIDI plus an owned Web Audio scheduler |
| P3-3 Surface migration | Completed | Results, share, and editor listen paths now select Verovio explicitly |
| P3-4 OSMD removal | Completed | Legacy backend, patches, constants, and dependencies removed on 2026-06-21 |

### Post-migration governance backlog

The original P0-P3 migration program is complete. The following backlog is the ordered
source of truth for the next governance phase; work should proceed from top to bottom
unless a production incident changes the priority.

| Priority | Task | Status | Scope |
| --- | --- | --- | --- |
| P0-4 | Anonymous share boundary | Completed | Only share detail is public; editor/practice/history and other protected routes retain login `returnUrl` |
| P0-5 | Subscription truthfulness | Completed | Paid plan controls are disabled/labelled unavailable and localized CNY formatting replaced mojibake |
| P1-4 | Editor ownership cleanup | Completed | Editor hooks/context/storage/lookup now have explicit editor ownership; unused duplicate history hook removed |
| P1-5 | API type package split | Completed | API contracts are split by domain behind the stable `@/types/api` entry |
| P1-6 | Listen modal decomposition | Completed | Playback lifecycle hook and controls component extracted with load/disposal tests |
| P1-7 | Frontend CI | Completed | Frontend workflow runs install, lint, typecheck, unit tests, build, and Playwright |
| P2-7 | MusicXML internal decomposition | Completed | Parser values and connection targeting extracted behind public package coverage |
| P2-8 | Package and dependency cleanup | Completed | Unused `dotenv` removed and package renamed to `noteverse-pro-frontend` |
| P2-9 | Current-state documentation refresh | Completed | Baselines, ownership paths, active behavior, and validation counts refreshed |

## 4. P0 - Foundation and Guardrails

### P0-1 Resolve documentation and scope conflicts

**Goal:** ensure every maintainer follows the same renderer and refactor direction.

**Tasks:**

1. Update `frontend_engineering_principles.md` so its summary explicitly says "incremental full Verovio migration" rather than "no full renderer rewrite."
2. Treat any historical practice-first migration references in current docs as history rather than the final architecture.
3. Link this plan from `improvement-roadmap.md` and avoid duplicating task status across both documents.
4. Record that `upload/page.tsx` is temporarily excluded while its current user changes are in progress.

**Acceptance:** no current document describes OSMD as a long-term path; at the time of this migration, this document was the frontend task board. Current active cleanup work now lives in `../../docs/codebase-simplification-and-security-plan.md`.

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

**Dependency security note (updated 2026-06-21):** The initial 2026-06-18 audit found 15 vulnerabilities, including a vulnerable Next.js 16.2.4 and legacy renderer/player transitive packages. Safe upgrades established the Next.js 16.2.9 baseline. P3-4 later removed the legacy renderer, player, `patch-package`, 94 transitive packages, and the now-unused JSZip override. The PostCSS override remains intentional: Next 16.2.9 pins PostCSS 8.4.31, which is affected by GHSA-qx2v-qp2m-jg93; resolving every consumer to the direct PostCSS 8.5.15 dependency keeps both audits clean. Remove the override once Next pins PostCSS 8.5.10 or newer. Both full and production audits report zero vulnerabilities.

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

**Implementation note (2026-06-19):** Entity add/note/chord modals and draft recovery now live under `components/editor`; the reusable original-image viewer lives under `components/media`; avatar cropping and the homepage animation live under `components/profile` and `components/home`. The unused placeholder `score-viewer.tsx` was deleted after a zero-reference audit. No compatibility re-exports were added. The component root now contains only the cross-domain `client-only` and `page-wrapper` entries; ListenModal moved to `components/score` with P1-3.

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

**Current behavior contract:** ListenModal loads MusicXML, renders and refits the score, extracts score tempo with a documented fallback, exposes play/pause/stop/step seek/loop controls, estimates duration when the backend omits it, synchronizes and auto-scrolls the cursor, and resets state on stop/close. These behaviors must remain stable when replacing the adapter.

**Implementation note (2026-06-19):** `lib/score/contracts.ts` defines `ScoreRenderer`, `ScorePlaybackController`, `ScoreCursorController`, and the combined `ScorePreviewController`. `OsmdScorePreviewController` privately implements the contracts with the existing OSMD/audio-player backend. `components/score/listen-modal.tsx` uses only contract methods and snapshots; searches find no `.osmd` or `.player` access in UI code. Pure MusicXML tempo extraction moved to `lib/musicxml/tempo.ts` with fallback tests. ListenModal owns UI state, RAF loops, and ResizeObserver; the adapter owns OSMD, playback scheduling, AudioContext, cursor internals, and rendered DOM. Dispose stops playback, closes AudioContext, suppresses late events, and clears the renderer container.

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

**Implementation note (2026-06-20):** `use-practice-session` owns session detail/id refs and the REST create/control fallback, `use-practice-socket` owns URL construction, message decoding, intentional-close tracking, and heartbeat, and the audio/recording hooks own all browser media resources. PCM conversion and downsampling are pure tested helpers. Practice controls, environment status, and the completion dialog now live under `components/practice`; committed alignment still flows through `PracticeScoreViewer` and its follow controller.

### P2-2 History page

**Extract:**

- upload/share cards and status indicator;
- filter/search/sort toolbar;
- pagination controls;
- selection and batch-action hook;
- task/share thumbnail loading hooks with cancellation and object URL cleanup.

**Acceptance:** two tabs retain independent pagination and filters; selection cannot leak across tabs; batch mutations invalidate the documented keys.

**Implementation note (2026-06-20):** upload/share tabs now retain separate search, sort, page, status, and view state. `use-history-selection` is cleared at tab boundaries, while `use-history-batch-actions` composes the existing task/share mutation hooks so their documented cache invalidation remains authoritative. Thumbnail access requests accept `AbortSignal`; the thumbnail hook cancels superseded work and revokes any owned `blob:` URLs. Cards, status, toolbar, and pagination live under `components/history`, with unit coverage for tab isolation, selection clearing, and task route mapping.

### P2-3 Results page

**Extract:**

- task metadata editor;
- score/image preview section;
- share management panel;
- fingering/export action group;
- a page orchestration hook for task/XML/image resources.

**Acceptance:** metadata, sharing, fingering, download, and listen flows remain functional; object URLs are revoked; components consume query hooks rather than duplicating fetch state.

**Implementation note (2026-06-20):** `use-results-resources` composes canonical task/XML queries, editor score hydration, cancellable image access requests, and owned `blob:` URL cleanup. Metadata editing, image preview, fingering/listen/navigation actions, downloads, and share management now live under `components/results`. The share panel continues to use domain query/mutation hooks; the ineffective edit-permission selector was removed because permission was never part of the create-share request contract. Share status and expiration mappings have pure unit coverage.

### P2-4 Editor page

**Extract:**

- editor document load/save lifecycle hook;
- editor header/actions;
- modal orchestration;
- navigation/return behavior;
- listen preview launcher using the shared score contract.

**Acceptance:** autosave status remains reactive; source selection stays correct; editor modals live in `components/editor`; no new direct MusicXML root imports are introduced.

**Implementation note (updated 2026-06-22):** `use-editor-document` owns canonical score/revision queries, draft recovery, parser/history initialization, validation, base-revision save conflicts, autosave status, and cancellable original-image resources. `EditorPageHeader` consumes reactive autosave/history state, while `EditorPageModals` owns entity, image, listen, validation, and draft dialogs. Editor routes use score identity plus explicit revision/base-revision state; they no longer accept `current`, `final`, or `enhanced` source routing. Missing or unsupported score/revision artifacts return the route not-found or classified error boundary instead of silently selecting another artifact. `enhanced_xml` remains a recorded processing artifact but never substitutes for canonical MusicXML. MusicXML imports remain package subpaths or dynamic parser imports.

### P2-5 Share and review pages

**Extract:** access/auth state, permission-gated actions, score content query, and score presentation sections.

**Acceptance:** anonymous/authenticated access remains correct; `canDownload`/`canEdit` are enforced in UI; share XML uses the canonical query key.

**Implementation note (2026-06-20):** `use-share-page-data` owns the authenticated redirect, canonical share-access query, canonical `queryKeys.xml.share()` XML query, classified access errors, and cancellable image resources. Anonymous visitors retain their full return URL. Share preview, actions, and information/download panels live under `components/share`; `can_download=false` disables downloads and `can_edit=false` removes the editor entry. Locale-aware editor return URLs are preserved. `use-review-page-data` owns task validation, confirm mutation, and cancellable original/preview images, while `ReviewScoreComparison` owns carousel presentation and page tracking.

### P2-6 Upload page decomposition

**Status:** completed on 2026-06-21.

**Implementation:** `use-upload-workflow` owns file resources, task recovery, sequential uploads, idempotent dispatch, polling timeout, failure state, and result navigation. `UploadForm` owns metadata, dropzone, file status, and submission presentation; `UploadPreviewDialog` owns carousel state and accessible preview controls. The route now only composes the page shell and these domain owners.

**Acceptance:** restored uploads continue to reuse SHA-256 identifiers, active tasks resume polling, completed tasks route to review/results, object URLs are revoked, and all visible status/control copy remains localized.

## 7. P3 - Shared Verovio Migration and OSMD Removal

### P3-1 Generalize the Verovio adapter

**Status:** completed on 2026-06-20.

**Goal:** reuse proven practice code without making all score pages depend on practice semantics.

**Tasks:**

1. Move toolkit loading, MusicXML sanitization, page rendering, and generic element/time lookup into `lib/score/verovio`.
2. Keep practice-specific highlighting and commit behavior in `lib/practice`.
3. Add a shared `VerovioScoreViewer` with loading, empty, error, resize, and multi-page behavior.
4. Define instance ownership so toolkit state is not accidentally shared across simultaneous viewers.
5. Verify real fixtures visually and with DOM-level tests.

**Acceptance:** practice uses the shared adapter without regression; non-practice pages can render without importing practice modules.

**Delivered:** `lib/score/verovio` now owns WASM module loading, per-viewer toolkit
instances, MusicXML sanitization, page rendering, relayout, timemap, and generic
element/time lookup. `VerovioScoreViewer` owns loading, empty, error, resize, and
multi-page DOM behavior, while practice retains its visual timeline, commit policy,
highlighting, and scrolling. DOM tests use the real multi-page MusicXML fixture and
verify toolkit instance isolation.

### P3-2 Playback replacement technical spike

**Status:** completed on 2026-06-20. See
`docs/adr/0001-verovio-playback-backend.md`.

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

**Spike result:** Verovio MIDI and timemap output now feed a NoteVerse-owned playback
timeline and controller. Deterministic tests cover play, pause, stop, seek, tempo,
multi-page cursor lookup, and disposal; a real WASM fixture covers MIDI/XML-ID alignment.
The direct soundfont engine uses the existing local piano asset and explicitly falls back
to piano for unsupported programs. P3-3 must perform real browser soundfont/unlock/scroll
smoke checks before OSMD removal; multi-instrument fidelity remains outside the current
asset set and is not claimed.

### P3-3 Migrate browser-side renderer consumers incrementally

**Status:** completed on 2026-06-20.

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

**Migration record:** Results migrated first and proved the shared renderer/playback
controller with real single-page and multi-page fixtures, DOM cursor/page lookup, resize,
error/loading ownership, and disposal. A Chromium user-gesture smoke test then loaded and
decoded the local 2.3 MB MusyngKite piano asset, scheduled a note, stopped it, and closed
the AudioContext. Share and editor subsequently selected the same Verovio backend; their
permission, anonymous access, edit state, and backend-rendered image paths remain outside
the renderer boundary. All three consumers now use the single shared Verovio path.

### P3-4 Remove OSMD completely

**Status:** completed on 2026-06-21.

**Tasks:**

1. Delete the OSMD adapter/backend and OSMD-specific cursor workarounds.
2. Remove `opensheetmusicdisplay` and `osmd-audio-player` dependencies.
3. Remove `patch-soundfont.ts` or rewrite it only if the selected playback backend still requires a supported equivalent.
4. Rename or rewrite OSMD-specific audio constants and comments.
5. Remove obsolete patch-package patches; remove `patch-package` itself if nothing else uses it.
6. Search source, package files, docs, and lockfile for `OSMD`, `OpenSheetMusicDisplay`, and `osmd-audio-player`.
7. Run full quality and behavior validation.

**Acceptance:** the search returns only intentional historical documentation; production dependencies and runtime code contain no OSMD path.

**Removal result:** the legacy score preview controller, cursor workarounds,
`patch-soundfont.ts`, and renderer-specific timing constants were deleted. The
`opensheetmusicdisplay`, `osmd-audio-player`, and unused `patch-package` dependencies
were removed, reducing the installed tree by 94 packages. `ListenModal` now has one
Verovio controller path and no backend selector. Source and lockfile scans contain no
legacy renderer runtime references; remaining mentions in this plan and ADR 0001 are
intentional migration history.

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
15. Completed cleanup: package renamed from `nextn` to `noteverse-pro-frontend` without changing dependency versions.

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

## 11. Post-Migration Governance Plan

### P0-4 Anonymous share boundary

**Status:** completed on 2026-06-21.

**Product decision:** `/share/[shareId]` is anonymously accessible. Anonymous access does
not grant a session and does not make any other route public. Navigating from a share to
editor, history, profile, upload, review, results, or practice must still pass through the
authentication proxy and preserve the complete localized `returnUrl`.

**Tasks:**

1. Add an exact public exception for `/share/[shareId]` while retaining `/share` and all other protected prefixes as deny-by-default boundaries.
2. Allow `use-share-page-data` and the share query/XML/image path to load after auth initialization for both anonymous and authenticated visitors.
3. Keep `can_download` and `can_edit` authoritative. An anonymous visitor may only see actions allowed by the share contract; actions requiring an account must enter the normal login flow.
4. Replace the E2E assertion that anonymous share visits redirect to login with public-share coverage in both default Chinese and explicit English locale URLs.
5. Add a browser test proving that following an editor link from a share still redirects to login with the exact share-origin `returnUrl`.

**Acceptance:** a valid share opens without cookies; revoked, expired, and missing shares
retain their classified states; all non-share protected routes still redirect before
rendering protected content; locale and query parameters survive login round trips.

**Result:** the proxy has an exact `/share/[shareId]` public exception while other `/share`
paths remain protected by default. Share data loads after auth initialization for either
auth state. Anonymous bookmark actions enter login, while editor and practice remain
protected. Chinese/English anonymous access and editor `returnUrl` are covered by Playwright.

### P0-5 Subscription truthfulness

**Status:** completed on 2026-06-21.

**Tasks:**

1. Remove the garbled `楼0`, `楼30`, and `楼99` literals from the homepage and subscriptions page.
2. Until billing exists, remove the local-only plan mutation or render upgrade controls disabled with localized "not available" copy.
3. Do not present local React state as an account subscription or successful purchase.
4. Keep any informational prices in localized structured data and format real future prices with `Intl.NumberFormat`.

**Acceptance:** the UI cannot claim a plan changed without a backend billing response;
all visible pricing/subscription copy is localized and free of mojibake.

**Result:** the local-only current-plan mutation was removed. Free entry routes to the
real login/upload flow; paid controls are disabled and marked coming soon. Prices use
locale-aware CNY formatting and paid-plan copy no longer promises immediate upgrades.

### P1-4 Editor ownership cleanup

**Status:** completed on 2026-06-21 as behavior-preserving ownership moves.

**Tasks:**

1. Move `use-connection-operations`, `use-metadata-editor`, `use-entity-editor`, `use-history-editor`, `use-voice-editor`, and `use-xml-updater` into `hooks/editor/`.
2. Audit the remaining root hooks and move any editor-only owners, including undo history, autosave, and entity-card behavior, while leaving genuinely cross-domain hooks at the root.
3. Rename `contexts/history-context.tsx` to `contexts/editor-history-context.tsx` and update consumers without adding compatibility re-exports.
4. Move `lib/draft-storage.ts` to `lib/editor/draft-storage.ts`.
5. Move and rename `lib/score-utils.ts` to `lib/editor/score-lookup.ts`.

**Acceptance:** root hooks and contexts have unambiguous cross-domain names; editor files
import editor behavior from explicit editor domains; lint, typecheck, editor tests, and
autosave/draft recovery behavior remain unchanged.

**Result:** editor-only hooks live under `hooks/editor`; undo context is
`editor-history-context`; draft storage and score lookup live under `lib/editor`. The
zero-reference duplicate `hooks/use-history.ts` was deleted without compatibility exports.

### P1-5 API type package split

**Status:** completed on 2026-06-21.

**Tasks:**

1. Split `types/api.ts` into focused common, auth/profile, task/file/XML, share, and practice contracts.
2. Preserve `@/types/api` as the stable public import through `types/api/index.ts`.
3. Keep shared envelopes and pagination types in one common module and prevent domain duplication.
4. Move files mechanically first; contract behavior changes require separate work and tests.

**Acceptance:** API helpers and consumers keep one stable public type entry; no duplicate
`ApiResponse`, pagination, task, or share contracts exist; the type dependency graph is acyclic.

**Result:** common, auth, task, file, share, XML, and practice contracts live in focused
modules under `types/api`, with `index.ts` preserving `@/types/api` for all consumers.

### P1-6 Listen modal decomposition

**Status:** completed on 2026-06-21.

**Tasks:**

1. Extract controller loading, playback snapshot state, RAF loops, seek/loop behavior, resize handling, and disposal into `use-score-preview-playback`.
2. Extract the progress and playback button presentation into a focused score control component.
3. Keep `ListenModal` responsible for dialog composition and renderer container ownership.
4. Add component/hook coverage for load failure, play/pause/stop, seek, loop completion, close, and unmount disposal.

**Acceptance:** UI code still depends only on score contracts; every RAF, observer,
AudioContext, controller, and rendered DOM resource is disposed exactly once; existing
Chromium soundfont and playback tests remain green.

**Result:** `ListenModal` is a dialog composition shell; `use-score-preview-playback` owns
controller loading, RAF/seek/loop/resize state and disposal; `ScorePreviewControls` owns
presentation. Load generation guards dispose controllers that finish after close.

### P1-7 Frontend CI

**Status:** completed on 2026-06-21.

**Tasks:**

1. Add a frontend workflow with a pinned Node/npm baseline and `npm ci`.
2. Run lint, typecheck, unit tests, and a production build with a non-secret test backend origin.
3. Run the deterministic critical Playwright subset; keep browser installation/cache policy explicit.
4. Add path filters without allowing frontend dependency or shared workflow changes to bypass the gate.

**Acceptance:** a clean checkout runs the same quality gates used locally; failures block
merging; no production secret is required by CI.

**Result:** `.github/workflows/frontend-quality.yml` uses Node 22.14, npm cache plus
`npm ci`, all static/unit/build gates, CI Chromium installation, and the full deterministic
Playwright suite with a non-secret localhost backend origin.

### P2-7 MusicXML internal decomposition

**Status:** completed on 2026-06-21. The split follows cohesive value/target boundaries.

**Tasks:**

1. Characterize parser and connection edge cases before moving code.
2. Split `parser.ts` by document/measure/entity parsing responsibilities and split `connections.ts` by relation type where cohesive boundaries exist.
3. Preserve `lib/musicxml/index.ts` as the stable public surface and keep core dependency direction acyclic.
4. Avoid mixing file moves with MusicXML behavior changes.

**Acceptance:** public parse/serialize behavior and fixtures are unchanged; each new module
has a single responsibility; no page or component imports parser internals accidentally.

**Result:** pitch/duration/articulation conversion moved to `parser-values`; connection
endpoint ordering and DOM target resolution moved to `connection-targets`. The public
MusicXML barrel remains stable and focused characterization tests protect both boundaries.

### P2-8 Package and dependency cleanup

**Status:** completed on 2026-06-21.

**Tasks:**

1. Confirm there is no runtime or script import of `dotenv`, then remove it and refresh the lockfile.
2. Rename the package from `nextn` to `noteverse-pro-frontend` without combining dependency upgrades.
3. Run full and production npm audits after the lockfile change and retain the documented PostCSS security override until Next.js no longer needs it.

**Acceptance:** package metadata uses the product name, the dependency tree has no unused
`dotenv`, and both audits remain at zero vulnerabilities.

**Result:** the package is `noteverse-pro-frontend`, `dotenv` and its lock entry were
removed, 785 packages remain in the audited tree, and the full audit reports zero findings.

### P2-9 Current-state documentation refresh

**Status:** completed on 2026-06-21 after the implementation items above.

**Tasks:**

1. Update stale baseline statements about test availability, page sizes, renderer ownership, and completed migrations.
2. Keep `improvement-roadmap.md` explicitly historical and this document authoritative.
3. Move detailed migration chronology to ADR/history sections where needed; keep current architecture and active backlog easy to find.
4. Update `frontend_engineering_principles.md` after ownership paths actually move.

**Acceptance:** a new maintainer can identify the current architecture, active tasks,
quality commands, and intentional limitations without reading obsolete intermediate states.

### Ordered delivery

Completed in this order as separate reviewable scopes on 2026-06-21:

1. P0-4 anonymous share boundary.
2. P0-5 truthful subscription UI.
3. P1-4 editor ownership cleanup.
4. P1-5 API type package split.
5. P1-6 listen modal decomposition.
6. P1-7 frontend CI.
7. P2-7 MusicXML internal decomposition.
8. P2-8 package/dependency cleanup.
9. P2-9 documentation refresh.

Do not combine product behavior changes, mechanical file moves, and dependency lockfile
changes in one delivery slice.
