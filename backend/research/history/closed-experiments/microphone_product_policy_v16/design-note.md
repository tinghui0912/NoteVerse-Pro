# V16 Prospective Product Interpretation Boundary

Research only. No production interface, scoring, feedback or capability change.

## Evidence Is Not Sensor Truth

MIDI NOTE_ON is direct key-event evidence. MIDI STEP keeps exact normalized key-set equality; physical extras are product-significant.

Microphone events are probabilistic. An unmatched pitch need not mean an extra physical key; a target pitch proposal need not mean the user pressed the correct physical octave. Finality settles domain ownership, not sensor correctness. A finalized MISSING strike is primary negative target evidence, not independently proven physical silence.

V15 remains valid for its exact-set question. Prospectively:

`V15_EXACT_SET_BLOCKER_DOES_NOT_BY_ITSELF_PROVE_NEW_ACOUSTIC_READOUT_IS_REQUIRED`

This does not qualify a relaxed rule. P0/P1 will be applied without threshold, confidence, octave, cardinality or temporal modifications. If coverage accepts a target not contained in frozen physical truth, unconditional coverage MATCH is blocked. A future three-state MATCH/MISMATCH/UNCERTAIN policy may be worth investigating, but no uncertainty classifier or P2 exists in V16. No new neural model or readout is automatically authorized.

## STEP Design Concept Only

```text
One STEP runtime / one target owner / one attempt owner
    evidence acquisition
        -> semantic attempt lifecycle and ownership
        -> prospective StepVerdictPolicy
             MIDI       -> EXACT_SET
             MICROPHONE -> NOT_YET_FROZEN
```

This interface is not implemented. V13 remains unchanged and exact-set. Research P1 results do not advance any real target, alter an active target, or replay V15 under a modified runtime.

Retirement is orthogonal to pitch interpretation:

`REARM_REQUIRED_FIXED_COOLDOWN_DURATION_NOT_YET_ESTABLISHED`

Only READY opens a new attempt. POST_VERDICT remains non-READY. MATCH advancement and next READY are one explicit rearm commit. Source time must remain authoritative: stale or equal-watermark events cannot become new attempts just because a callback arrives late. A repeated C4 target must require a distinct fresh observation/gesture identity. Old target-generation completion cannot affect the next generation.

Future microphone capture may continue without pause/resume. Its input owner must establish a physical capturedThrough retirement watermark. A fixed silence cooldown is not equivalent to that contract. No microphone cooldown duration is selected here. No RMS, flux, transient, onset or second-strike detector is introduced.

## Continuous Design Concept Only

```text
Acoustic/MIDI observation
        -> deterministic ContinuousFinalizer ownership/finality
        -> prospective source-sensitive ContinuousProductProjection
```

MATCHED, WRONG, EXTRA, MISSING, reservations and finality stay internal and exact. EXTRA closes residual observation ownership; removing it would leave incomplete ledgers. Projection does not reassign any observation, retime evidence or change target matches.

MIDI WRONG/EXTRA can keep direct key-event interpretation. For microphone, finalized WRONG/EXTRA can be presented as POSSIBLE_UNMATCHED_ACOUSTIC instead of a physical-key accusation. MISSING remains negative target evidence after finality, with acoustic limitations disclosed. MATCHED remains positive target evidence, not a guarantee of physical correctness.

Prefer prompt positive feedback where justified. Current live coloring waits for finalized groups; a future low-latency provisional positive display would need a separate non-authoritative presentation contract. Never promote unfinalized ownership or render an immediate red extra-note claim from a raw acoustic proposal. Even after finality, unmatched acoustic wording should remain qualified unless independently validated.

Current code already has no direct live EXTRA/WRONG observation badge. Expected MISSING strikes are red, including those in WRONG groups. Final review displays extras.length under physical-sounding Extra playing wording. Completion dialog has no numerical score/count input. The transient completed evaluation is not uploaded by the durable performance-take save API; inspected create/read schemas and saved-media list have no accuracy/overall performance score field.

Consequently, C0/C1 can compare category interpretation over the same completed evidence, not claim an implemented numerical score improvement. Strong-negative category-item counts are diagnostics, not unique user mistakes or a newly invented score formula. Model-quality precision, false-positive onsets/minute, misses and raw extra counts remain research diagnostics, independent of user penalties.

## Future Evidence

Existing exposed completed acoustic ledgers can establish lossless source-sensitive category projection, not real microphone reliability or pedagogical safety. Future work needs independently frozen physical truth, actual-device/room/instrument coverage, calibrated wrong-octave/extra-key false-claim evidence and a separately preregistered uncertainty/scoring contract. Do not access or choose a fresh holdout in V16.

Shared Robust remains shared; no alternative model, decoder execution, production winner, qualification or microphone enablement follows automatically. Independent audit is the only next action.
