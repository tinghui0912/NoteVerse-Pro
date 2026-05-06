# Practice Verovio Migration Plan

## Purpose

This document defines a concrete frontend migration plan for the practice page.

Decision:

- use Verovio on the practice page
- keep OSMD on the rest of the product for now

This is a deliberate hybrid architecture.

## Why Verovio On Practice Only

The practice page has different requirements from the rest of the app.

It needs:

- realtime score-following feedback
- stable SVG element targeting
- time-based note lookup
- score position to time mapping
- fast DOM-level highlighting
- auto-scroll and auto-page-turn behavior

Those requirements align better with Verovio than with OSMD.

The rest of the product still benefits from keeping the current OSMD-based
stack:

- upload preview
- result display
- editor-related flows
- existing code that already assumes OSMD

So the correct move is not a full renderer rewrite. It is a targeted renderer
split by page responsibility.

## Current Baseline

The current practice page already has:

- backend practice REST integration
- backend practice WebSocket integration
- control message flow:
  - `client.init`
  - `client.pause`
  - `client.resume`
  - `client.finish`
- PCM frame streaming
- structured practice report retrieval
- Verovio dependency installed
- a first Verovio adapter and practice-specific score viewer
- real MusicXML rendering on the practice page

Current files:

- [page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/practice/[id]/page.tsx)
- [score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx)
- [practice.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/lib/api/practice.ts)
- [api.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/types/api.ts)

What is still missing is the rendering layer:

- note highlighting
- measure highlighting
- cursor following
- auto-scroll / auto-page

Real score rendering is now in place; the remaining work is the following and
polish layers.

The first follow layer is also now in place:

- note highlighting from `alignment.update`
- measure-level emphasis
- active page emphasis
- viewport-aware scroll following
- visible-page tracking for multipage practice rendering

## Proposed Frontend Architecture

Do not keep all logic inside the page component.

Split the practice feature into four frontend layers.

### 1. Page orchestration layer

Keep in:

- `frontend/src/app/[locale]/practice/[id]/page.tsx`

Responsibilities:

- session lifecycle
- WebSocket lifecycle
- microphone and PCM lifecycle
- report request
- page-level UI sections

This file should not contain Verovio-specific DOM logic.

### 2. Practice score container

Add:

- `frontend/src/components/practice/practice-score-viewer.tsx`

Responsibilities:

- initialize Verovio
- load MusicXML
- render SVG
- expose imperative hooks for highlighting and scroll sync

This replaces the placeholder [score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx) only for the practice page.

### 3. Verovio adapter layer

Add:

- `frontend/src/lib/practice/verovio-adapter.ts`

Responsibilities:

- wrap Verovio toolkit usage
- load MusicXML or MEI
- call `renderToSVG`
- call `renderToMIDI`
- expose time and element mapping helpers
- expose DOM helper methods

Keep this as the only place that directly knows the Verovio toolkit API.

### 4. Practice follow controller

Add:

- `frontend/src/lib/practice/follow-controller.ts`

Responsibilities:

- receive backend `alignment.update`
- map score position to target note / measure / time
- update active note classes
- update active measure classes
- drive scroll / page advance

This layer should know nothing about React state outside the minimal inputs it
needs.

## Suggested File Layout

Add:

- `frontend/src/components/practice/practice-score-viewer.tsx`
- `frontend/src/components/practice/practice-overlay.tsx`
- `frontend/src/lib/practice/verovio-adapter.ts`
- `frontend/src/lib/practice/follow-controller.ts`
- `frontend/src/lib/practice/practice-scroll.ts`
- `frontend/src/lib/practice/verovio-types.ts`

Keep using:

- [page.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/app/[locale]/practice/[id]/page.tsx)
- [practice.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/lib/api/practice.ts)
- [api.ts](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/types/api.ts)

Later, once the practice page is stable, the generic
[score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx)
can either remain as a shared placeholder wrapper or be replaced by a thin
redirect component.

## Data Flow

### Backend to frontend flow

1. page creates practice session
2. page opens practice WebSocket
3. backend sends `alignment.update`
4. page stores latest alignment payload
5. page passes alignment payload into `PracticeScoreViewer`
6. `PracticeScoreViewer` forwards it to `follow-controller`
7. `follow-controller` updates highlighted SVG nodes and scroll state

### Score load flow

1. page resolves the score source
2. page fetches MusicXML content or XML URL
3. `PracticeScoreViewer` gives the score to `verovio-adapter`
4. adapter loads the score into Verovio
5. adapter renders SVG into a managed container
6. adapter prepares timing helpers:
   - `renderToMIDI`
   - `getElementsAtTime`
   - `getTimeForElement`

## How To Get The Score Data

The practice page already has the task id from the route.

Recommended source order:

1. use the final score for owner practice
2. use `share_token` aware score fetch when entered from a shared page
3. keep this aligned with the existing XML/task file APIs

Practical recommendation:

- fetch the same score source used by the backend practice session creation
- for MVP, use the `final` source unless the page explicitly supports switching

This means we should add a small frontend helper that retrieves the MusicXML
content or download URL for the practice score before Verovio rendering starts.

## Verovio Adapter Contract

The adapter should expose a narrow interface.

Suggested shape:

```ts
type VerovioRenderResult = {
  svg: string;
  pageCount: number;
};

type ScoreTimeLookup = {
  getElementsAtTime: (ms: number) => string[];
  getTimeForElement: (xmlId: string) => number | null;
};

type VerovioAdapter = {
  loadMusicXml: (xml: string) => Promise<void>;
  renderPage: (page: number) => VerovioRenderResult;
  renderAllPages: () => VerovioRenderResult[];
  getElementsAtTime: (ms: number) => string[];
  getTimeForElement: (xmlId: string) => number | null;
  getCurrentPage: () => number;
  getPageCount: () => number;
};
```

Important:

- keep the toolkit instance private
- never let the page component manipulate Verovio directly

## How To Map Backend Alignment To Verovio

This is the most important design choice.

The backend currently sends:

- `event_index`
- `measure_index`
- `measure_number`
- `beat_position`
- `confidence`
- `timestamp_ms`

Verovio is strongest when working with:

- time in milliseconds
- element ids
- rendered SVG nodes

So the practice page should use a two-step mapping strategy.

### MVP mapping strategy

Use backend `timestamp_ms` as the primary signal.

Flow:

1. receive `alignment.update`
2. call `verovio.getElementsAtTime(timestamp_ms)`
3. highlight returned element ids
4. derive active measure from highlighted elements
5. scroll the first active note into view

This is the simplest route and matches Verovio's strongest APIs.

### Fallback mapping strategy

If `getElementsAtTime(timestamp_ms)` returns nothing or looks unstable:

1. use `measure_number`
2. locate the corresponding rendered measure group in SVG
3. highlight the measure container
4. keep last active note until a new note id appears

This gives graceful degradation instead of losing all visual feedback.

### Future stronger mapping

Once the backend starts returning a richer timeline or xml ids, the adapter can
skip time-based lookup and jump directly to the rendered note elements.

That would be ideal, but it is not required for the first Verovio migration.

## SVG Highlighting Model

Use CSS classes, not frequent full rerenders.

Recommended classes:

- `.practice-note-active`
- `.practice-note-recent`
- `.practice-measure-active`
- `.practice-page-active`

Recommended behavior:

- current notes get `.practice-note-active`
- recently active notes can briefly keep `.practice-note-recent`
- current measure gets `.practice-measure-active`
- remove old classes before applying new ones

This should happen by direct DOM operations on the rendered SVG subtree, not by
re-rendering React nodes on every alignment update.

## Auto-Scroll And Auto-Page Design

Do not page-turn on every update.

Use hysteresis.

Recommended behavior:

1. find the first active note element
2. measure its bounding rect relative to the score scroll container
3. if the element is comfortably visible, do nothing
4. if it crosses a lower threshold, smooth-scroll the container
5. if the next active note belongs to a different rendered page, switch page or
   scroll to the next page container

Recommended thresholds:

- keep active note within the middle 55% to 70% of the viewport
- never scroll upward unless the session is explicitly restarted

This keeps the cursor visually stable.

## Single-Page vs Multi-Page Rendering

Use multi-page SVG rendering for the practice page.

Reason:

- easier auto-scroll
- easier page boundary detection
- simpler DOM querying across the full score

Avoid single-page rerendering as the main model for MVP because it adds too
much page-switch churn.

Recommended rendering mode:

- render all pages as stacked SVG blocks inside one scroll container
- track current visible page for overlay display
- highlight within whichever page owns the active note

## Practice Overlay

Add a light overlay component above the score area for practice-only feedback.

Suggested content:

- connection status
- session state
- confidence percentage
- current measure number
- optional latency / sync indicator

This should not be baked into the SVG itself.

## React State Boundaries

Keep fast-changing highlight state out of normal React rendering when possible.

Recommended split:

- React state:
  - session detail
  - connection status
  - latest alignment payload
  - report data
  - maximize/minimize
- imperative controller state:
  - active note ids
  - active measure id
  - current visible page
  - last scroll target

This is important because alignment updates can be frequent.

## Audio Pipeline Recommendation

The current page now requires `AudioWorklet`.

Current state:

- `AudioWorklet` processor added for realtime PCM extraction
- no legacy `ScriptProcessorNode` fallback remains
- unsupported browsers now fail fast with an explicit in-page alert and toast guidance
- 16k PCM chunking still happens on the client before WebSocket send
- worklet-side sample batching now reduces per-frame messaging overhead
- WebSocket heartbeat now keeps the practice session active during longer runs

Further improvement is still recommended:

- tighten frame sizing for more stable backend cadence
- document the supported browser baseline clearly in product docs

## Dependencies

Add Verovio only to the practice-page path.

Suggested package strategy:

- install Verovio toolkit JS/WASM package
- lazy-load it inside `PracticeScoreViewer`
- avoid importing it into global app bundles

This keeps the rest of the product untouched.

## Implementation Phases

### Phase A. Renderer swap

Goal:

- replace the placeholder practice score area with a Verovio-rendered score

Tasks:

- add Verovio dependency
- implement `verovio-adapter.ts`
- implement `practice-score-viewer.tsx`
- load and render real MusicXML

Definition of done:

- practice page shows a real score
- no following yet required

Status:

- in progress
- dependency installation is complete
- adapter and practice-specific Verovio viewer are in place
- practice page now renders real MusicXML through Verovio

### Phase B. Alignment highlighting

Goal:

- highlight notes and measures from backend updates

Tasks:

- implement `follow-controller.ts`
- connect `alignment.update`
- use `getElementsAtTime(timestamp_ms)`
- apply CSS classes to SVG nodes

Definition of done:

- visible note and measure following on live updates

Status:

- in progress
- `alignment.update -> getElementsAtTime(timestamp_ms)` is now wired
- active notes are highlighted
- active measure emphasis is applied
- active page emphasis and basic follow scrolling are in place
- current visible page is now tracked from the rendered multipage viewport

### Phase C. Scroll and page turning

Goal:

- smoothly keep the active note visible

Tasks:

- implement scroll helper
- add viewport thresholds
- track current page
- smooth-scroll active elements into view

Definition of done:

- score follows the player visually without manual scrolling

Status:

- in progress
- page container focus is now triggered when the active follow page changes
- visible-page tracking is now derived from the multipage scroll viewport
- note-level follow scrolling and page-level focus now work together
- short note-drop windows now reuse the previous highlight briefly to reduce flicker
- page focus now uses a visibility threshold to avoid over-eager page jumps

### Phase D. Polish and hardening

Goal:

- make the page stable enough for core-product use

Tasks:

- upgrade PCM path to `AudioWorklet`
- improve overlay
- tune highlighting cadence
- add empty/error/loading states
- test long scores and shared-link entry

Definition of done:

- practice page is product-grade for MVP rollout

## Risks And Mitigations

### Risk 1. MusicXML conversion quirks in Verovio

Mitigation:

- keep OSMD on the rest of the app
- scope Verovio only to practice
- test the same score corpus used by the backend timeline builder

### Risk 2. Timestamp mismatch between backend and Verovio

Mitigation:

- use `timestamp_ms` first
- fall back to measure-based highlighting
- later enrich backend messages if needed

### Risk 3. Too many DOM updates

Mitigation:

- mutate only the active and previously active nodes
- avoid full SVG replacement on every update

### Risk 4. Scroll jitter

Mitigation:

- add viewport thresholds
- scroll only when active note leaves a safe zone
- never scroll backward during a forward live session

## Acceptance Criteria

This migration is successful when:

- the practice page renders real score SVG with Verovio
- live `alignment.update` visibly highlights notes
- the active measure is highlighted
- the score auto-scrolls with the user performance
- page transitions happen without losing highlight state
- backend session flow remains unchanged
- other pages still use OSMD without regression

## Recommended Next Step

Implement Phase A first:

1. add Verovio dependency
2. create `verovio-adapter.ts`
3. create `practice-score-viewer.tsx`
4. replace the current placeholder [score-viewer.tsx](/c:/Users/12631/Downloads/NoteVerse-Pro/frontend/src/components/score-viewer.tsx) usage inside the practice page only

After that, move directly to Phase B and wire `alignment.update` to note
highlighting before trying to polish auto-scroll behavior.
