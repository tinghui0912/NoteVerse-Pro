# RTT Shared Streaming Onset Frontend Decision

NoteVerse git HEAD: `bfd061300491301ce2966af4db13bf327eb29107`
RTT upstream commit: `b3197cfa538cc6f7698042b87ecee709223fc58e`
Checkpoint SHA256: `901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1`
Checkpoint bytes: `67843364`

## Upstream Reproduction

Identity gate: `PASS`
Input scaling chosen: `OFFICIAL_RUNTIME`
Reason: inference.py loads float PCM with librosa and passes it into CustomAMT.forward(); CustomAMT.forward divides input by int16 range.
Sample rate: `16000`; hop: `160`; n_fft: `2048`; fft_delay: `160`.
Causal conv confirmed: `True`; unidirectional GRU confirmed: `True`.

## Causal Prefix Invariance

Verdict: `PASS`
Max absolute delta: `0.00037776`
Algorithmic acoustic delay: `10ms` from `fft_delay=160` at 16kHz.

## Development Acoustic Stream

Verdict: `FAIL`

| Criterion | Result |
|---|---|
| correct_single | `{'hit': 11, 'sampleCount': 16, 'recall': 0.6875, 'verdict': 'FAIL'}` |
| complete_chord | `{'hit': 2, 'sampleCount': 16, 'recall': 0.125, 'verdict': 'FAIL'}` |
| same_note_retrigger_second | `{'hit': 9, 'sampleCount': 16, 'recall': 0.5625, 'verdict': 'FAIL'}` |
| dense_repeated_pitch | `{'hit': 0, 'sampleCount': 0, 'recall': None, 'verdict': 'NOT_EVALUATED'}` |
| fast_adjacent_pitch | `{'hit': 0, 'sampleCount': 0, 'recall': None, 'verdict': 'NOT_EVALUATED'}` |
| partial_overlapping_notes | `{'hit': 0, 'sampleCount': 0, 'recall': None, 'verdict': 'NOT_EVALUATED'}` |
| soft_attack | `{'hit': 0, 'sampleCount': 0, 'recall': None, 'verdict': 'NOT_EVALUATED'}` |
| loud_attack | `{'hit': 0, 'sampleCount': 0, 'recall': None, 'verdict': 'NOT_EVALUATED'}` |
| wrong_semitone | `{'falseAccepts': 1, 'sampleCount': 16, 'verdict': 'FAIL'}` |
| wrong_octave | `{'falseAccepts': 0, 'sampleCount': 16, 'verdict': 'PASS'}` |
| missing_chord_tone | `{'falseAccepts': 0, 'sampleCount': 16, 'verdict': 'PASS'}` |
| long_held_no_retrigger | `{'falseOnsetCases': 3, 'sampleCount': 16, 'verdict': 'FAIL'}` |
| pedal_sustain_no_retrigger | `{'falseOnsetCases': 1, 'sampleCount': 16, 'verdict': 'FAIL'}` |

Event-level onset metrics:

```json
{
  "10ms": {
    "matched": 1390,
    "gt": 2893,
    "predicted": 2655,
    "precision": 0.52354,
    "recall": 0.48047,
    "f1": 0.501081
  },
  "20ms": {
    "matched": 1656,
    "gt": 2893,
    "predicted": 2655,
    "precision": 0.623729,
    "recall": 0.572416,
    "f1": 0.596972
  },
  "30ms": {
    "matched": 1667,
    "gt": 2893,
    "predicted": 2655,
    "precision": 0.627872,
    "recall": 0.576218,
    "f1": 0.600937
  },
  "50ms": {
    "matched": 1669,
    "gt": 2893,
    "predicted": 2655,
    "precision": 0.628625,
    "recall": 0.57691,
    "f1": 0.601658
  }
}
```

Event pressure:

```json
{
  "eventsPerMinute": {
    "count": 128,
    "min": 48.0,
    "median": 456.0,
    "p95": 768.0,
    "max": 960.0,
    "mean": 479.302912
  },
  "unmatchedEventsPerMinuteAt50ms": {
    "count": 128,
    "min": 0.0,
    "median": 144.0,
    "p95": 360.0,
    "max": 432.0,
    "mean": 178.242145
  },
  "duplicatesPerPhysicalStrikeAt50ms": {
    "count": 128,
    "min": 0.0,
    "median": 0.0,
    "p95": 0.053611,
    "max": 0.090909,
    "mean": 0.006166
  }
}
```

## Staged Stop

Development = `FAIL`
Calibration = `NOT RUN`
Browser = `NOT RUN`
Stop reason: Gate C acoustic onset stream hard criteria failed; staged stop before product replay.

## Final Verdict

```text
RTT Shared Streaming Onset Frontend = FAIL
```

Production microphone remains disabled after Phase 7.
No production integration was performed.
