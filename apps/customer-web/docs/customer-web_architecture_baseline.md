# Customer Web Architecture Baseline

This document records the current frontend domains, contracts and lifecycle ownership.

## Purpose

The frontend should stay organized around stable product domains, explicit route shells,
typed API contracts, and reusable state components. The goal is to make feature work easy
to place within clear ownership boundaries.

## API Contract Ownership

The generated Customer API types, SDK operations and Fetch runtime in
`src/generated/api/` come from
`../../backend/docs/contracts/openapi/customer-api.json` and must not be edited
manually. Run `npm run generate:api` after an approved backend contract
change; CI runs `npm run check:api` to reject stale output.

`src/lib/api/*` contains feature adapters and generated result projections.
HTTP operation definitions belong to generated code, and browser transport
policy belongs to `src/lib/http/`.
Frontend view models, form state, browser-only protocol messages, and display
helpers remain frontend-owned. HTTP DTO consumers must import the generated
types directly. View models and form state stay frontend-owned.

## Route Shells

Routes are grouped by user intent, not simply by login state:

```text
src/app/[locale]/
  (public)/      marketing, pricing, and help pages
  (auth)/        login, register, password recovery, email verification
  (app)/         authenticated product pages
  (workspace)/   focused editor, practice, and review-edit surfaces
  (external)/    share and invite entry points
```

Rules:

- App pages use `AppShell` with the left navigation and top status bar.
- Workspace pages use `WorkspaceShell` and keep only the focused resource toolbar.
- Public/help pages keep public navigation; logged-in state changes the right-side user area
  but does not turn them into AppShell pages.
- Auth pages use a low-distraction Auth shell.
- External pages are not AppShell pages. They expose only the actions allowed by the share,
  or invite contract.

## Score Detail Model

Score detail and share detail pages are lightweight detail pages, not full
browser score-player pages.

They use:

- a score hero with thumbnail, title, primary actions, and a simple play/pause cover button;
- tabs for score information, version history, sharing, and collaborators;
- backend-generated render assets for thumbnails and downloadable images;
- backend-generated playback audio for cover playback.

Practice is the focused browser-local practice surface.

Practice execution is owned by Customer Web once the required score artifacts are loaded.
`STEP_BY_STEP` progresses by local correctness decisions for bounded attempts.
`CONTINUOUS_PLAY` progresses from the fixed local tempo clock; the user follows the
score cursor, and MIDI or acoustic evidence is downstream correctness/timing evidence
only. `StepPracticeController` and `ContinuousPracticeController` own their respective
application lifecycles; React subscribes to snapshots and sends commands. The shared
acoustic foundation is score-blind. Both modes support browser-local microphone
analysis when browser/runtime prerequisites are available. Capability detection does
not qualify physical-device recognition quality, permission UX or end-to-end latency.
See [Practice Product Contract](../../../docs/architecture/practice-product-contract.md).

## Asset Vocabulary

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
external visitors. External share payloads only include revision sources when the
server-side policy allows download. Import-job review artifacts are a separate pipeline
concept and should not be modeled as score revision assets.

## API and Server State

All product API calls belong under `src/lib/api/*`. Pages and components should not create
ad hoc `fetch` calls for backend product data.

Rules:

- Next server validates its required backend origin in `next.config.ts`; browser
  protocol identities come from generated constants.
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
components/external     share/invite surfaces
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

- Keep route and API ownership explicit through their domain interfaces.
- Do not add fallback URLs or default backend origins for required runtime config.
- Do not expose MusicXML in external share flows unless the backend explicitly grants
  download permission.
- Do not put import-job review artifacts into score revision asset APIs.
- Do not split domains only by page names; split by ownership and lifecycle.

## Customer HTTP operations

Customer OpenAPI owns request and response contracts. Customer Web generates
TypeScript types, flat SDK operations and the bundled Fetch runtime. SDK calls
receive an explicit browser policy client. Generated operations own method,
path, path parameters, query serialization and request body encoding.

`src/lib/http/customer-browser-transport.ts` owns credentials, CSRF injection,
single-flight refresh, one replay, login redirects, cancellation and network
observability. Feature adapters return direct generated representations or apply
frontend transformations. `responseBody` extracts the HTTP body from SDK result
metadata; the SDK result `.data` is not a wire envelope. Commands without a
representation return 204 and adapters resolve to `void`. Page-number resources
use `items`, `page`, `page_size`, `total` and `total_pages`. Customer success has no
generic envelope; localized success presentation belongs to frontend i18n.
Application errors retain `{ code, request_id }`. Public/auth bootstrap and silent session probes choose
policy explicitly; transport does not classify authentication URLs.

Browser-native EventSource, image/audio and avatar URLs are separate transports.
`src/lib/api/native-resource-urls.ts` adapts generated OpenAPI route metadata and
operation input types through the generated Fetch URL serializer. Score and Guest
Preview media, render thumbnails and EventSource consume those native URLs.
Profile presentation uses server-provided API-rooted avatar URLs directly.
Signed storage upload uses
`src/lib/http/direct-object-upload.ts`, omits credentials and uses the exact
server-provided target and headers. Static FIR assets and local Blob snapshots
are resource reads outside Customer HTTP operations.

`contracts/http/customer-browser-protocol.json` owns the fixed Customer API prefix
and session/CSRF cookie and header identities. Generated TypeScript constants are
shared by browser transport, Next proxy and Next rewrites; Backend consumes the
Python projection. `NEXT_BACKEND_ORIGIN`, public origins, cookie Secure/SameSite
policy and session lifetimes remain deployment policy. Generated SDK paths already
include the API prefix, so browser transport base URLs express only the origin.
`generate:browser-protocol` and `check:browser-protocol` cover both protocol
projections and native route metadata from committed OpenAPI.
