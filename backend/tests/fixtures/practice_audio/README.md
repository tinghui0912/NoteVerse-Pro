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

## Public Samples

The `public_samples/` directory contains small, converted 16 kHz mono PCM WAV
fixtures downloaded from public datasets. The manifest uses only the converted
`*_16k.wav` files so replay tests stay fast.

| Fixture | Source | License note | Manifest role |
| --- | --- | --- | --- |
| `piano_uiowa_mf_c5_16k.wav` | University of Iowa Musical Instrument Samples, `Piano.mf.C5.aiff` | Public research sample collection | Positive piano start |
| `noise_esc50_rain_16k.wav` | ESC-50, `1-17367-A-10.wav` | ESC-50 public dataset | Noise negative |
| `keyboard_esc50_typing_16k.wav` | ESC-50, `1-137-A-32.wav` | ESC-50 public dataset | Keyboard negative |
| `tap_esc50_mouse_click_16k.wav` | ESC-50, `1-118206-A-31.wav` | ESC-50 public dataset | Tap/click negative |
| `speech_fsd_0_jackson_0_16k.wav` | Free Spoken Digit Dataset, `0_jackson_0.wav` | Public GitHub dataset | Speech negative |

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
