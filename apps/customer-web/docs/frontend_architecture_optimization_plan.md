# Frontend Architecture Baseline

> Status: current baseline, not a migration task board.
> Last updated: 2026-07-13.

This document records the frontend architecture that new work should preserve. Historical
renderer, route, and page-decomposition migration details live in the git history and older
cross-stack plans under `../../docs/`.

## Purpose

The frontend should stay organized around stable product domains, explicit route shells,
typed API contracts, and reusable state components. The goal is to make feature work easy
to place without recreating historical compatibility paths.

## Route Shells

Routes are grouped by user intent, not simply by login state:

```text
src/app/[locale]/
  (public)/      marketing, pricing, and help pages
  (auth)/        login, register, password recovery, email verification
  (app)/         authenticated product pages
  (workspace)/   immersive editor, practice, and review-edit surfaces
  (external)/    share, public score, and invite entry points
```

Rules:

- App pages use `AppShell` with the left navigation and top status bar.
- Workspace pages use `WorkspaceShell` and keep only the focused resource toolbar.
- Public/help pages keep public navigation; logged-in state changes the right-side user area
  but does not turn them into AppShell pages.
- Auth pages use a low-distraction Auth shell.
- External pages are not AppShell pages. They expose only the actions allowed by the share,
  publication, or invite contract.

## Score Detail Model

Score detail, share detail, and public score pages are lightweight detail pages, not full
browser score-player pages.

They use:

- a score hero with thumbnail, title, primary actions, and a simple play/pause cover button;
- tabs for score information, version history, sharing, and collaborators;
- backend-generated render assets for thumbnails and downloadable images;
- backend-generated playback audio for cover playback.

They do not use the old full Verovio score viewer or bottom playback transport on the detail
page. Practice remains the focused interactive score-following surface.

## Asset Vocabulary

Do not reintroduce the old generic score artifact model in frontend code.

Current score asset types are:

```text
RevisionSource
  canonical revision source content, currently MusicXML

RenderAsset
  visual derived assets, currently rendered score pages

PlaybackAsset
  playable derived assets, currently audio
```

Frontend API contracts expose these as:

```text
ScoreRevisionAssets
  revision_sources
  render_assets
```

Playback audio is delivered through playback endpoints rather than by exposing MusicXML to
external visitors. External share/public payloads only include revision sources when the
server-side policy allows download. Import-job review artifacts are a separate pipeline
concept and should not be modeled as score revision assets.

## API and Server State

All product API calls belong under `src/lib/api/*`. Pages and components should not create
ad hoc `fetch` calls for backend product data.

Rules:

- Required environment variables are read through `src/lib/env.ts`; do not add silent
  fallbacks for required backend or public runtime configuration.
- React Query keys are created through `src/lib/query-client.ts`.
- Mutations own cache invalidation; pages own page-specific success copy.
- Realtime score events invalidate score detail, revision assets, versions, and list queries
  through the shared provider.
- Downloads go through `useDownload` and typed asset collections, not page-local URL
  construction.

## Loading and Error States

Use the shared loading and error components instead of page-local one-off markup:

```text
components/loading/
  LoadingSpinner
  PageLoading
  ResourceLoading
  SectionLoading
  InlineLoading

components/error/
  ErrorState
  ResourceErrorState
  NotFoundState
```

Loading, empty, error, and not-found states are distinct states. Do not show raw backend
exception messages to users. User-facing error copy should be classified and localized.

## Component Ownership

Keep UI ownership explicit:

```text
components/brand        logo and brand marks
components/shell        route shell implementations
components/navigation   public nav, app sidebar, settings nav
components/score        score capability context, score thumbnail, shared score surface
components/score-preview interactive Verovio preview viewport, controls, and playback shell
components/score-detail score detail tabs, actions, metadata, versions
components/review       import review UI
components/editor       editor-specific dialogs and controls
components/practice     practice-specific viewer and controls
components/external     share/public/invite surfaces
components/loading      loading primitives
components/error        error primitives
```

Only truly cross-domain primitives should live at component root.

## MusicXML and Rendering

Browser-side MusicXML parsing and editor utilities live under `src/lib/musicxml` and
`src/lib/editor`. The interactive Verovio code that remains is owned by score/practice/editor
domains. Detail pages should prefer backend render/playback assets and should not grow new
renderer-specific page logic.

## Validation

Normal frontend quality gates:

```text
npm run typecheck
npm run lint
```

Run targeted unit/component or Playwright checks when a change affects route behavior,
downloads, realtime invalidation, score editing, shell layout, or user-visible states.

## Guardrails

- Do not add compatibility re-exports for removed route or API names.
- Do not add fallback URLs or default backend origins for required runtime config.
- Do not expose MusicXML in external share/public flows unless the backend explicitly grants
  download permission.
- Do not put import-job review artifacts into score revision asset APIs.
- Do not split domains only by page names; split by ownership and lifecycle.
