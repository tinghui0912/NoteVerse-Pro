# ADR 0001: Verovio playback backend

- Status: Accepted for phased migration
- Date: 2026-06-20
- Scope: P3-2 playback replacement technical spike

## Context

The temporary `OsmdScorePreviewController` hides both OpenSheetMusicDisplay and
`osmd-audio-player` behind stable renderer, playback, and cursor contracts. Removing
OSMD therefore requires a real audio scheduler and cursor time source, not only a new
SVG renderer.

The repository currently ships one local MusyngKite asset,
`acoustic_grand_piano-mp3.js` (about 2.3 MB). `soundfont-player` was previously only a
transitive dependency of `osmd-audio-player`, so relying on it after OSMD removal would
have been accidental.

## Decision

Use this phased replacement:

1. Verovio remains the source of SVG, base64 Standard MIDI, and XML-ID timemap data.
2. `@tonejs/midi` parses the Verovio MIDI into normalized note events. It is used as a
   parser only; Tone.js synthesis and transport are not introduced.
3. A NoteVerse-owned playback controller schedules those events and owns play, pause,
   stop, seek, tempo scaling, playback snapshots, and timemap cursor snapshots.
4. `soundfont-player` becomes an explicit dependency and is isolated behind
   `VerovioAudioEngine`. It owns AudioContext unlock, sample scheduling, stop, and close.
5. Renderer imports remain separate from the `verovio/playback` entry so practice and
   read-only viewers do not load MIDI or soundfont code.

`soundfont-player` is an intentionally narrow compatibility choice, not a new general
audio framework. Its CommonJS packaging and age are contained behind the audio-engine
interface so it can be replaced without changing the score or UI contracts.

## Parity evidence

| Capability | Spike result | Evidence / remaining gate |
| --- | --- | --- |
| MusicXML/MIDI timeline | Proven | Real Verovio WASM fixture produces MIDI notes and XML-ID timemap events |
| Instrument/soundfont loading | Partial | Local acoustic piano is supported; other GM programs deliberately fall back to piano until assets are licensed and shipped |
| Play, pause, stop, seek, tempo | Proven in controller | Deterministic injected-engine tests cover scheduling and state transitions |
| Note/page cursor sync | Proven | Timemap XML IDs resolve through `getPageWithElement` |
| Multi-page following | Proven at data level | Controller test crosses pages; large local score produced three pages and 201 visual events |
| Mobile/browser support | Chromium proven | A real click unlocked Web Audio and decoded the local asset; physical mobile verification remains a release gate |
| AudioContext unlock/cleanup | Browser proven | Chromium smoke and deterministic tests verify resume, stop, close, and timer cleanup |
| Bundle/startup cost | Controlled, not final | Playback has a separate entry; production build must remain green and P3-3 should record browser chunk and soundfont decode timing |

## Measurements

The committed `chords-voices.musicxml` fixture produced three notes, one visual event,
and a 0.5-second MIDI timeline in the integration test.

A read-only probe used the existing local 174,620-byte OMR MusicXML sample. Verovio
loaded it as three pages and produced 287 MIDI notes, 201 visual events, and a
746.6-second timeline. On the development machine, WASM initialization plus score load
took about 391 ms; MIDI/timemap extraction completed at about 472 ms total. Verovio
reported pre-existing cross-measure tie warnings but completed successfully.

## Consequences and gates

- P3-3 migrated results, share, and editor; P3-4 removed the legacy controller after
  browser and contract validation passed.
- The legacy renderer and player packages are no longer production dependencies.
- Multi-instrument fidelity is not claimed. The UI must not imply original
  instrumentation while only the piano asset is available.
- Before adding more local instruments, confirm asset licensing and budget their
  download/decode cost explicitly.
- The independent Node ESM probe needs CommonJS default-import interop for
  `@tonejs/midi`; the supported application path is the verified Next/Vite bundle.

## Rejected alternatives

- Keep `osmd-audio-player`: rejected because it preserves OSMD scheduler and cursor
  coupling and blocks dependency removal.
- Parse and schedule MusicXML directly: rejected because it duplicates tempo, tie,
  voice, repeat, and articulation semantics already emitted by Verovio MIDI.
- Introduce full Tone.js: rejected for this phase because only MIDI parsing and sample
  scheduling are required.
- Web MIDI output only: rejected because it requires external hardware/software and
  cannot provide the in-browser listen feature.
