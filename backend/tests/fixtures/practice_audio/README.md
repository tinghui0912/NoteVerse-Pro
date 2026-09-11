# Practice Audio Replay Fixtures

This directory contains manifest-driven replay scenarios for the realtime practice
score-following gate.

`manifest.json` supports two kinds of frame sources:

- Generated frames: `sine`, `impulse`, `constant`, `silence`
- Real recordings: `wav`

Real recordings should be 16-bit PCM `.wav` files. Stereo files are downmixed to
mono by the test harness. Add them next to this README and reference them from a
scenario:

```json
{
  "id": "real_piano_first_phrase",
  "frames": [{ "type": "wav", "path": "real_piano_first_phrase.wav" }],
  "expect": {
    "started_frame": 3,
    "forbidden_states": ["lost"]
  }
}
```

The replay test currently checks:

- `started_frame`
- `started_frame_min` / `started_frame_max`
- `queued_frames`
- `queued_frames_min` / `queued_frames_max`
- `ready_to_start`
- `min_following_frames`
- `max_lost_frames`
- `max_no_input_streak`
- `forbidden_states`
- `forbidden_gate_reasons`
- `forbidden_runtime_reasons`
- `forbidden_queue_decisions`
- exact `state_at` frame assertions

Each replay frame records diagnostics from `BrowserAudioStreamAdapter`:

- `stream_state`
- `frame_class`
- `gate_reason`
- `runtime_reason`
- `queue_decision`
- `no_input_streak`
- `audio_active`
- `rms`
- `peak`

Prefer diagnostic assertions for regressions that should fail loudly for the
right reason. For example, negative samples should usually forbid
`queued_tonal`, while mixed active-piano samples should cap `max_no_input_streak`
or forbid `lost`.

Keep negative examples such as desk taps, keyboard clicks, and speech alongside
positive piano examples so threshold changes can be evaluated against both sides.

`profile_manifest.json` is the score-specific real-engine matrix. It is replayed
by `scripts/evaluate_practice_replay.py` inside the `practice` container, where
Matchmaker's real Chroma processor and first-note score validation are available.
It includes calibration silence before every scenario and validates starts,
negative non-starts, mixed inputs, the first emitted beat, and pause/resume.
For current scenarios, it validates the microphone startup and first expected
event behavior used by step-by-step practice.
The revised Once Again score currently exposes a follow-progress gap: the local
excerpt and the first 20 seconds of the complete `Once Again.wav` can start, but
do not yet advance through a meaningful score region. Those real-recording
scenarios are marked `known_gap`; promote them to `required` only after the
microphone follow engine produces stable accepted alignment advance, not merely
after startup succeeds.

`initial_alignment_manifest.json` is the P0 startup robustness baseline. It uses
the same real engine, but focuses on invariants that should hold before changing
the initial-alignment algorithm: leading sample phase offsets, armed delay before
correct entry, wrong notes followed by a correct restart, and alternate transport
chunk sizes. It also includes 1/4/8/12 repeated wrong-C4 attempts followed by a
correct Once Again restart, so restart behavior is checked after the engine is
already armed.

Full-performance fixtures should be rebuilt when the fixed-clock Performance
engine is introduced. Do not add new Matchmaker score-following manifests for
Continuous practice; the product decision is that visible Continuous progress is
owned by a clock, while microphone/MIDI events become timed evidence for the
result summary.

`tests/test_practice_microphone_capability_matrix.py` is the first microphone
recognition capability baseline. It is not a score-following replay manifest and
does not claim product-level chord support. It records the current conservative
observer's actual boundary:

- real public C4/C5 piano single notes should match;
- synthetic rolled C/E/G observations can be accumulated into one expected-group
  match;
- repeated same-pitch attacks require a release boundary before they become a
  second attempt, so sustained energy is not double-counted as another strike;
- simultaneous synthetic C/E/G and real C4+C5 octave mixtures are not treated as
  strict microphone chord support, because the live PCM observer still emits at
  most one dominant pitch.

Keep this matrix separate from evaluator unit tests. Evaluator tests that pass
known pitch sets such as `("C4", "E4")` prove business logic only; they do not
prove that real microphone PCM can produce those pitch sets.

## Paired MIDI + Microphone Ground Truth

`paired_ground_truth_manifest.json` defines the next recognition benchmark
source of truth. These scenarios are allowed to produce physical accuracy
metrics such as `expected_strike_recall` and `expected_strike_precision` only
after their status becomes `recorded`.

A recorded paired fixture must contain:

- microphone audio from the same take;
- physical MIDI NoteOn/NoteOff truth from the same take;
- synchronization metadata, preferably a shared capture clock or a clear
  alignment impulse;
- canonical replay audio identity for the resampled 16 kHz mono float32 PCM;
- MIDI artifact identity.

Do not mark a fixture as `paired_midi` when the MIDI was exported from
MusicXML, synthesized from the score, or captured from a different take. Those
fixtures can validate score expectation or synthesis behavior, but they are not
physical ground truth for an acoustic performance.

The first planned matrix intentionally focuses on one chord:

```text
Expected C-E-G

Actual:
C
E
G
C-E
C-G
E-G
C-E-G
```

The first six cases must not MATCH; the full chord should MATCH with high
first-attempt acceptance once the microphone recognizer is good enough. This
small matrix is more useful than another long song recording because it directly
measures false chord completion.

## Public Samples

The `public_samples/` directory contains small, converted 16 kHz mono PCM WAV
fixtures downloaded from public datasets. Public-sample manifest scenarios use
the converted `*_16k.wav` files so replay tests stay fast. Score-specific
quality scenarios may use local source recordings directly when the full
performance is needed.

| Fixture | Source | License note | Manifest role |
| --- | --- | --- | --- |
| `piano_uiowa_mf_c5_16k.wav` | University of Iowa Musical Instrument Samples, `Piano.mf.C5.aiff` | Public research sample collection | Positive piano start |
| `piano_uiowa_mf_c4_16k.wav` | University of Iowa Musical Instrument Samples, `Piano.mf.C4.aiff` | Public research sample collection | Wrong-pitch piano negative for Once Again |
| `noise_esc50_rain_16k.wav` | ESC-50, `1-17367-A-10.wav` | ESC-50 public dataset | Noise negative |
| `keyboard_esc50_typing_16k.wav` | ESC-50, `1-137-A-32.wav` | ESC-50 public dataset | Keyboard negative |
| `tap_esc50_mouse_click_16k.wav` | ESC-50, `1-118206-A-31.wav` | ESC-50 public dataset | Tap/click negative |
| `cough_esc50_16k.wav` | ESC-50, `1-19111-A-24.wav` | ESC-50 public dataset | Cough negative |
| `desk_knock_esc50_16k.wav` | ESC-50, `1-101336-A-30.wav` | ESC-50 public dataset | Desk-knock negative |
| `speech_fsd_0_jackson_0_16k.wav` | Free Spoken Digit Dataset, `0_jackson_0.wav` | Public GitHub dataset | Speech negative |
| `local_recordings/once_again_excerpt_16k.wav` | Derived from the local Once Again recording | Local test fixture | Real loudspeaker positive and mixed-input base |

Speech is included as a negative example because spoken vowels can look tonal in
short FFT windows. This guards against overly permissive low-level start paths.

## Mixed Scenarios

`manifest.json` can build deterministic mixtures at replay time:

```json
{
  "type": "mix_wav",
  "duration_seconds": 4,
  "sources": [
    { "path": "public_samples/piano_uiowa_mf_c5_16k.wav" },
    {
      "path": "public_samples/speech_fsd_0_jackson_0_16k.wav",
      "gain_db": -18,
      "offset_seconds": 0
    }
  ]
}
```

Use mixtures when the expected timing must be controlled, such as "tap before
piano" or "speech before piano". The current public samples are enough for the
first gate-level mixed tests:

- piano with keyboard typing
- piano with low-level speech
- piano with low-level rain
- tap before piano
- speech before piano
- tap during piano
- speech during piano
- strong keyboard typing during piano
- delayed tap without piano

They are not enough to evaluate full score-following quality. For that, add
longer real piano phrases, multiple pitches, tempo variation, pauses, and
recordings captured through the actual `/practice` microphone path.

## Real-Engine Replay

Run the score-specific matrix against the same Matchmaker engine used by the
practice service:

```powershell
docker compose -f docker-compose.backend-dev.yml exec -T practice python `
  scripts/evaluate_practice_replay.py `
  --score /app/data/work/storage-cache/scores/<score-id>/revisions/<revision-id>/score.musicxml
```

Run the P0 initial-alignment baseline with:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm practice-quality python `
  scripts/evaluate_practice_replay.py `
  --manifest tests/fixtures/practice_audio/initial_alignment_manifest.json `
  --score /app/data/work/storage-cache/scores/<score-id>/revisions/<revision-id>/score.musicxml
```

The command exits nonzero when any scenario violates its manifest expectation.
Use it after every change to `practice_alignment/profile.py`, start validation, or
the OLTW input policy. The lightweight `practice-quality` test suite continues
to cover deterministic gate and manifest behavior without running Matchmaker's
native Chroma implementation.
