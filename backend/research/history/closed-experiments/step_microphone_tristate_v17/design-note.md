# V17 Conservative Tristate: Design Only

P2 is a research policy, not a production microphone integration. Existing production already supports finalized RETRY/UNCERTAIN; V17 does not introduce a fourth verdict or change runtime correctness. MATCH and MISMATCH evidence remains unchanged; RETRY deliberately acknowledges insufficient certainty. Original observations remain in research sidecars, since existing RETRY records carry no asserted observed set.

## Honest Uncertainty

Exact acoustic evidence can support automatic progression on this exposed evidence. Target coverage with extras cannot establish physical-key correctness: the same proposed octave can be an acoustic extra or a hallucinated target. Returning RETRY preserves the distinction between unsupported certainty and an acoustically missing target. This is not model-quality improvement or universal safety proof; another exact-but-hallucinated set could still fail on other data.

## Persistent Ambiguity And User Escape

If successive legitimate gestures consistently contain acoustic extras, deterministic P2 can keep returning RETRY. This is `PERSISTENT_ACOUSTIC_AMBIGUITY_USABILITY_RISK`. Existing rate conversions are not repeated user performances; separate physical gestures returning RETRY motivate a risk, not a population retry estimate.

Do not auto-promote the third retry, majority-vote, union/accumulate evidence, auto-skip or fit confidence from these cases. Those would bypass safe target progression.

Current Skip is an explicit READY-only user action and records skip history, not MATCH. Hook/controller expose the last finalized verdict and phase; POST_VERDICT RETRY has a generic try-again message. Microphone input and an acoustic retry classifier remain disabled. No production copy/control is changed.

Possible future copy, design only: "I heard note evidence, but the microphone cannot reliably determine whether additional keys were played. Please retry, or continue manually." A localized Chinese equivalent may be considered in the separate UX phase. Do not assert that the intended physical notes definitely were played: wrong-octave target hallucination is a counterexample.

Future explicit Continue/Skip must remain separate from automatic MATCH. Under current semantics it can be actionable only after retirement/rearm makes READY visible. It cannot bypass POST_VERDICT by silently advancing the target, nor erase a RETRY record. Current Skip is not relabeled here.

## Retirement Remains Orthogonal

`REARM_REQUIRED_INDEPENDENT_OF_PITCH_VERDICT_POLICY`

RETRY finalizes one attempt, enters POST_VERDICT, retains target/generation and requires explicit rearm. Only strictly newer eligible source events may create fresh attempt identities. Equality, stale observations and old target generations remain retired. No fixed microphone cooldown duration is selected; future capturedThrough retirement is not a silence heuristic.

## Future Operating-Point Question

If the frozen cross-recording recurrence rule justifies further development, design a new prospective exposed-development study only. Optimize SAFE_AUTO_MATCH_COVERAGE on physically supported targets subject to DANGEROUS_TARGET_HALLUCINATION, required-target recall, runtime stability and latency. Raw EXTRA reduction or maximizing CORRECT alone is not the objective.

Study order: decoder .30/.05 operating point; then owned600/future170 versus previously identified owned600/future120 geometry challenger; only then a new readout if evidence demonstrates necessity. No threshold direction, sweep grid, geometry change or candidate mechanism is selected/executed in V17. Any future geometry study must preserve the full real 29120-sample input and explicitly freeze its context accounting.

`MODEL_INPUT_CONTRACT_NOT_REOPENED`

16k mono, 29120/1820ms, Robust ONNX identity and shared-model strategy remain current. Decoder A, .30/.05 and owned600/past1050/future170 remain current defaults, not a proven global optimum. Parameter study execution needs separate authorization and prospective freeze.

## Continuous Carry-Forward Only

Verify V16 code-inventory hashes, not its projection again. Keep internal MATCHED/WRONG/EXTRA ownership/finality. Acoustic WRONG/EXTRA are not established physical-key facts. Current final review exposes Extra playing count; there is no direct live WRONG/EXTRA badge or deterministic overall score formula in the inspected path. A source-sensitive presentation refactor can be discussed separately after audit, not implemented here.

Model-quality precision/recall/F1, false-positive onsets/minute, raw extras and decoder diagnostics stay intact. Lenient user feedback is not improved transcription.

STOP after additive evidence closure. No production change, model/decoder/PCM execution, new qualification, fresh holdout or microphone enablement.
