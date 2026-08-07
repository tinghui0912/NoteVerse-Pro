# Practice Workspace Design QA

## Comparison target

- Source: `C:\Users\12631\Downloads\原型图1\Practice03.png`
- Implementation route: `http://127.0.0.1:3000/zh/score/41721b5c-4edd-4bdb-a74b-4ab3e88ff2a9/practice`

## Result

**Final result: blocked**

The local implementation redirects to the sign-in page before the practice workspace can render. The authenticated score view is required to compare the score canvas, floating control dock, and right-side settings panel against the supplied reference. TypeScript and ESLint checks pass for the implementation.

## Intended implementation changes

- Two-column desktop workspace: score canvas on the left, sticky practice settings on the right.
- Desktop workbench height constrained to the viewport, with the score scrolling inside its own canvas.
- Persistent control dock directly below the score canvas, rather than below the complete score document.
- Immersive score view includes the same bottom control dock with reserved score padding, so pause and end controls remain accessible.
- Session status is a compact, light-surface HUD within the score frame; it remains visible in immersive mode while the bottom dock stays available for commands and future practice tools.
- Metronome, loop-section, and hands-separately controls have visually distinct disabled placeholders until their behavior is implemented.
- Practice settings use a right-side drawer: it starts closed, closes when practice begins, and can be opened from the score HUD in either normal or immersive view.
- The normal practice route uses a full-width score stage beneath the app navigation, with a content-width bottom control dock.
- Responsive single-column fallback below the `xl` breakpoint.
- Real session status and a functional next-note hint setting; no placeholder device controls.
