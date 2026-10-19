# Production H50 Ownership Migration

The source pipeline emits score-blind source observations and an exclusive absolute `ownedThroughSourceSample` frontier. The new frontier is processed acoustic coverage, NOT physical captured-through and NOT permission to rearm. It has no transport, score, target or verdict meaning; Continuous projection ignores it. Model/readout/input/geometry/capability identities do not change.

`StepAcousticAttemptAssembler` has no target or runtime import. It consumes that source-neutral contract, uses a fixed PracticeTimebase source/sample anchor in the localSessionId domain, opens an opaque identity, and seals ordinary EVIDENCE only after the source frontier reaches T+50ms. Every source observation in [T,T+50ms) is retained, sorted by source sample then stable ID; confidence is the minimum. There is no timer, arrival-time mapping, target filter, early close, extension, RMS/flux/detector, decoder or resource startup.

Identical IDs are idempotent; changed immutable content fails closed. Ignored IDs remain identity fingerprints, never a deferred evidence queue. An identity registry cap fails closed without eviction. Empty sealed evidence, invalid source mapping, chronology regression on new unretired events, reentrancy and malformed data are terminal errors. Callers handle domain cancellation on failure/input loss; the assembler cannot mutate a runtime it does not know.

The component starts BLOCKED. `acceptInputAfter` is an external readiness/retirement notification, not runtime.rearm. It requires a finite nondecreasing source watermark at least as far as processed source coverage. Completion returns to BLOCKED before calling the sink. The caller/resource owner must separately establish safe physical captured-through and commit runtime rearm, then notify the assembler. No fixed microphone cooldown is chosen. Source timestamps <= retirement watermark remain stale even if delivered later; already seen IDs can never acquire a second attempt.

Runtime v6 remains untouched and alone compares observed evidence against expected target, records MATCH/MISMATCH/RETRY and commits advancement only at explicit rearm. MIDI's 35ms NOTE_ON coherence path is unchanged. The browser microphone controller still fails closed; this module is not wired into startup or capability selection.

## Immutable Replay

All V7 current-baseline publications are used directly. The new frontier envelope is the already established V6/V20 sourceOriginSample plus frozen ownedEndTarget * sourceRateHz / 16000. Exact window identity, origin and source-rate agreement are checked before replay. No observation is regenerated, raw tensor decoded, PCM opened or source runtime executed.

Every V15/V18 intended attempt uses a fixed source/sample anchor and its historical paced session epoch. A fresh assembler represents each frozen attempt fragment, with the cell's actual v6 runtime preserved across its attempts. This is an evidence migration check, not a physical capture/rearm/latency qualification. The production persistent-instance same-target test independently proves that delayed old evidence cannot satisfy two targets.

The production assembler opens and derives bounded EVIDENCE before any expected verdict comparison. The thin replay adapter checks complete bounded evidence against the immutable historical assembly, then forwards that unchanged EVIDENCE to actual runtime. No external P2 runs. Only afterwards are verdict parity and independent physical-support classification checked. All source anchor/end samples, IDs/order/full observation content, pitch sets, minimum confidence, domain and rate must match exactly; aggregate parity alone is insufficient. SampleIndex is newly retained in SessionTime using PracticeTimebase's fixed mapping, with no fitted alignment. Prior synthetic ms values are retained as diagnostics, never used to alter source samples.

Protocol, inputs, production sources, compiled graphs and tests are remotely frozen before the single baseline replay. Any per-row assembly/verdict divergence seals failure and STOP; H50 is never adjusted to fit outputs. V3-V23 history stays byte-identical. V23's 600/120 candidate is not a replay/reference input. Current baseline remains Robust, decoder A .30/.05 and 600/1050/170, not a global optimum.

Relevant local tests include STEP runtime/MIDI/controller/retirement/hooks/status/capability/architecture, source publication/runtime and affected Continuous regression. Acoustic model and decoder tests are deliberately excluded: all inference ports in source-runtime regression tests are deterministic test doubles, not real neural/model/decoder execution. No selected PCM codec decoding or Continuous acoustic evidence rerun occurs.

Success establishes the bounded semantic component only. Browser microphone enablement, microphone qualification, device UX latency and cooldown qualification remain absent. STOP for independent audit.
