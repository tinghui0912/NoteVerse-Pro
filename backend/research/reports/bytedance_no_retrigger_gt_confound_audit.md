# ByteDance No-Retrigger GT Confound Audit

Date: 2026-09-14

Scope:

- Research-only post-hoc audit.
- Dataset: inspected development + calibration MAESTRO public paired cases.
- Frozen evaluation set: not used.
- Model inference: not rerun.
- Thresholds, cadence, dedupe, event formulation: not changed.
- Production code: not modified.

Input artifacts:

```text
backend/data/work/datasets/maestro-v3.0.0/production_step_development_set/public_step_causal_cases_manifest.json
backend/data/work/datasets/maestro-v3.0.0/production_step_calibration_set/public_step_causal_cases_manifest.json
backend/data/work/datasets/maestro-v3.0.0/bytedance_rolling_step_events_dev_cal.json
```

Audit output:

```text
backend/data/work/datasets/maestro-v3.0.0/bytedance_no_retrigger_gt_confound_audit_dev_cal.json
```

Script:

```text
backend/scripts/audit_bytedance_no_retrigger_gt_confounds.py
```

## Question

Some held/pedal no-retrigger cases may be mislabeled because the selectors only
exclude same-pitch retriggers through approximately `first_target + 1.2s`, while
the exported clip extends to approximately `first_target + 1.5s`.

This audit asks whether reported `false_second_advance` events actually align
with a real same-pitch physical note-on inside the exported clip.

## Classification

For each held/pedal reported second event `e`, and each same-pitch physical
note-on `g` inside the exported clip after the first target:

```text
-120ms <= e - g <= +50ms
```

means:

```text
REAL_RETRIGGER_ALIGNED
```

Otherwise the event remains:

```text
NO_PHYSICAL_RETRIGGER
```

Nearest any-pitch physical strikes are recorded for diagnostics, but only a
same-pitch physical strike can make STEP2 a legitimate advance.

## Summary

| Event rule | Reported held/pedal false seconds | REAL_RETRIGGER_ALIGNED | NO_PHYSICAL_RETRIGGER | AMBIGUOUS |
| --- | ---: | ---: | ---: | ---: |
| temporally_bound | 6 | 2 | 4 | 0 |
| model_native_event_stream | 6 | 2 | 4 | 0 |

Breakdown by case family:

| Case family | REAL_RETRIGGER_ALIGNED | NO_PHYSICAL_RETRIGGER |
| --- | ---: | ---: |
| long-held | 0 | 2 |
| pedal-tail | 2 | 2 |

Paired false-under-both cases:

| Case | Expected STEP2 pitch | Classification | temporally_bound event | model_native event | Compatible same-pitch note-on |
| --- | --- | --- | ---: | ---: | --- |
| `s04_pedal_sustain_tail_without_retrigger_001` | `F#4` | NO_PHYSICAL_RETRIGGER | 1.150s | 1.153553s | none |
| `s05_long_held_note_without_retrigger_002` | `G#4` | NO_PHYSICAL_RETRIGGER | 1.180s | 1.184794s | none |
| `s05_pedal_sustain_tail_without_retrigger_001` | `F2` | REAL_RETRIGGER_ALIGNED | 2.370s | 2.366409s | `F2 @ 2.377623s` |
| `s06_pedal_sustain_tail_without_retrigger_001` | `G#4` | REAL_RETRIGGER_ALIGNED | 1.870s | 1.874106s | `G#4 @ 1.875015s` |
| `s02_pedal_sustain_tail_without_retrigger_002` | `A3` | NO_PHYSICAL_RETRIGGER | 1.590s | 1.585373s | none |
| `s04_long_held_note_without_retrigger_002` | `A5` | NO_PHYSICAL_RETRIGGER | 1.660s | 1.663016s | none |

## Interpretation

The confound is real:

```text
2 / 6 reported held/pedal false seconds
actually align with real same-pitch physical retriggers
```

Those two should not be counted as product false advances. In a real STEP
runtime, after STEP2 is active, a new correct same-pitch physical strike should
advance.

However, the confound does not explain all failures:

```text
4 / 6 reported false seconds
still have no compatible same-pitch physical retrigger
```

The remaining true no-retrigger failures are:

```text
long-held: 2
pedal-tail: 2
```

So the prior conclusion needs to be narrowed:

```text
ByteDance model-native onset stream does produce genuine false retrigger events
on some held/pedal no-retrigger audio,
but the current benchmark over-counted the problem by including two real
same-pitch retriggers in the exported clip.
```

## Next

Do not run separability audit yet if the benchmark itself is being corrected.
The next clean step is to fix the public paired case builder so held/pedal
no-retrigger cases use the same full-export-range same-pitch exclusion that
`same_note_retrigger` already uses:

```text
no uncounted same-pitch physical note-on anywhere in the exported clip
```

Then rebuild only the affected held/pedal cases and rerun the rolling STEP
benchmark before deciding whether to inspect false-event raw evidence.
