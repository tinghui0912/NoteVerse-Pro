# ADR 0001: Verovio Playback Boundary

Status: Accepted

## Context

Score rendering, audio scheduling and cursor state need a shared musical
timeline without making rendering clients load the audio stack.

## Decision

Verovio supplies SVG, Standard MIDI and XML-ID timemap data. `@tonejs/midi`
parses the MIDI into normalized note events. The NoteVerse playback controller
owns play, pause, stop, seek, tempo scaling and playback/cursor snapshots.
It uses an injected `VerovioAudioEngine` for clock and sample scheduling.

`SoundfontAudioEngine` isolates `soundfont-player`, AudioContext resume,
instrument preparation, scheduling, stop and close. The shipped local
MusyngKite acoustic piano is the supported instrument. Other programs resolve
to that piano; this does not establish original-instrument fidelity.

Renderer exports and the `lib/score/verovio/playback` entry are separate so
render-only callers do not load MIDI parsing or soundfont assets. Engine
substitution must preserve the controller contracts rather than changing
score or UI identity.

## Invariants and boundaries

- Timemap XML IDs and page mapping drive cursor snapshots across pages.
- The engine owns the audio clock; UI timer cadence is not musical identity.
- Stop/close releases scheduled samples, timers and AudioContext resources.
- Browser user-gesture requirements apply to AudioContext resume.
- Asset licensing, size and decode cost must be reviewed before shipping an
  additional instrument. No remote instrument fallback is implied.
- Deterministic injected-engine tests establish scheduler/state behavior;
  browser and physical-device tests establish playback lifecycle support.
- The supported module-loading path is the Next/Vite application bundle;
  standalone Node consumers must account for MIDI parser module interop.
