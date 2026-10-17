# Performance-Time Identity Repair And Clock Gate V3

This is not controller integration. The product change is limited to five segment
transform expressions in PerformanceClockRuntime, centralized in two private
anchor-plus-local-delta helpers. Clamps, traversal order, count-in, scope, and
completion authority are unchanged. No consumer tolerance is added.

The dedicated numeric suite first reproduced the exact V2 failure against the
unmodified runtime. Its repaired coverage includes 512 repeated pause/resume pairs,
1024 helper anchors, capture mapping, count-in, manual stop, natural completion,
fractional origins, and large origins. Every semantic anchor uses exact equality.

V1/V2 reports and the V1 archive remain immutable. The same render-timeline harness
is reused against the new product source, with explicit resume delta and future
terminal source-frame witnesses. No acceptance evidence is inherited. The failed
V1 output-timestamp mapper stays outside product compilation.

Sequence from the repository root:

1. Commit product numeric repair, tests, and qualification tooling.
2. `node apps/customer-web/scripts/audio-context-clock-v3/protocol.mjs freeze`
3. Commit/push freeze and verify exact remote HEAD.
4. `node apps/customer-web/scripts/audio-context-clock-v3/verify.mjs`
5. `node apps/customer-web/scripts/audio-context-clock-v3/browser.mjs`
6. `node apps/customer-web/scripts/audio-context-clock-v3/report.mjs evidence`
7. Commit/push evidence, then run `report.mjs github` and commit/push receipt.

Gate 1 executes the unchanged model-neutral Worker and exact model twice per rate,
offline after assets are ready. Only if both rates pass can Gate 2 start. Gate 2
executes A/B/C/D anew at both rates with a fake inference port and no neural runs.
All per-cell statuses and raw witnesses persist even when a gate stops partway.
Partial execution is never labeled NOT_STARTED.

This protocol proves only internal browser timeline consistency. It does not
qualify hardware latency, real devices, natural piano accuracy, UX latency,
commercial use, microphone availability, or controller integration itself.
