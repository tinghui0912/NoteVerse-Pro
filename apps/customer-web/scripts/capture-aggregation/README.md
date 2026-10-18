# Fixed shared capture repair qualification

The sole product transport aggregates exactly2048 consecutive real mono source
samples, retains32 transfer credits and one8192-byte accumulator. ACK follows
synchronous authoritative consumer acceptance. No ACK is moved earlier.

STABILIZING holds only unpublished startup PCM. A frame gap retires that
provisional partial block. First full block fixes source0/origin and ACTIVE.
After ACTIVE every gap/input loss/invalid message is fatal; no origin reset.
connect readiness means first block accepted and acknowledged, not acoustic
preroll. The session-owned clock, model geometry and Continuous semantics do not
change. STOP never pads or flushes an incomplete block. Existing real tail
completion keeps capture alive until a whole block supplies needed model context.

Execution order (repository root):

```
node apps/customer-web/scripts/capture-aggregation/protocol.mjs freeze
# Commit the prospective artifact, push, verify the exact remote freeze.
node apps/customer-web/scripts/capture-aggregation/protocol.mjs verify
node apps/customer-web/scripts/capture-aggregation/verify.mjs
node apps/customer-web/scripts/capture-aggregation/transport.mjs stress
node apps/customer-web/scripts/capture-aggregation/transport.mjs cold
node apps/customer-web/scripts/capture-aggregation/regression.mjs
node apps/customer-web/scripts/capture-aggregation/regression.mjs musical
node apps/customer-web/scripts/capture-aggregation/musical-parity.mjs
```

First failed gate stops execution. No cell retries, no source edits after freeze.
Supported stalls are0/50/100/250/1000ms at both rates;1700ms must fail closed.
Five independent fresh Chrome/context cold starts at each rate are fixed before
execution. Research wrappers annotate the exact production Worklet class, verify
sample checksums and strip diagnostics before product chronology validation.
Diagnostics never retain PCM. Unit parity uses a byte-archived old Worklet only
as a test reference, never as a product import, selector or fallback.

Full static execution writes source/window SHA witnesses for frozen musical PCM
at44100/48000 and exact boundaries inside2048-sample chunks. Canonical Continuous
runner remains the only browser execution algorithm, with phase-specific proof
and output locations. Wall-time availability/finalization is reported separately
from exact semantic parity; no latency SLO is claimed.

STEP is not executed. H50 remains NOT_QUALIFIED. Continuous/STEP acoustic status
stays MODEL_NOT_VALIDATED/ATTEMPT_ANALYZER_NOT_VALIDATED;productionMicrophone=false;
D4=false. This is transport engineering, not model science or device enablement.
