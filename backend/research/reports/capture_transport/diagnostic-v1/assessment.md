# Diagnostic freeze v1 (not acceptance)

Starting HEAD: b3468c3938d0074163605360f84bb47af3eb899d.
Tooling: 056f312c. Prospective freeze: b8e642b9a81db6fde7c3ee8dad1e18b6f2d24a26.
Freeze SHA256: 1cd9711fbe6ee7c3395a227aa722acd3df2d66b0245c1d504276f4d6c58493d9.
Every execution contains its independent pre-execution remote verification proof.
Product source diff is empty. STEP execution is prohibited.

## Source audit

The sole capture Worklet posts one mono Float32 chunk per nonempty render quantum.
BrowserAcousticCapture calls bridge.receive synchronously, then posts ACK.
ContinuousCaptureBridge validates SourceChronology, splits at scheduled source
boundaries and synchronously calls the projection/runtime append (FIR/ring/window
planning). Inference is sequential in a Worker. ACK does not wait for inference.
There is no intermediate PCM queue. Capture disposal stops only analysis-owned
resources, not the borrowed session AudioContext/root microphone.

Observed quanta are 128 samples: 344.53125 messages/s at 44100, 375 at 48000.
32 credits cover 92.8798186ms / 85.3333333ms respectively, far below the
2048-sample resource policy's maximum transport capacity. Guard remains unchanged.

## Reproduced credit failure

Continuous 44100 four cells PASS, then 48000 natural PASS. 48000
count_in_cancel_multiple_pause_manual_stop fails with credit overflow.
Worker INFER sent at 4628.024999976158ms. ACK 1102 sent at
4637.139999985695ms; next PCM arrival 1103 at 5881.264999985695ms.
Worklet nextAck remains 1103 while sequence reaches 1135; currentFrame 145280.
Peak depth=32, maximum arrival gap=1244.1399999856949ms,
maximum synchronous receive callback=1.2000000476837158ms, ACK order violations=0,
chronology failures=0. Root is live and AudioContext running.
No completed publication, one inference outstanding. 11 completed neural runs
are confirmed across cells, plus one unresolved run; exact total is unknown.

This establishes the immediate causal sequence: delivery/ACK scheduling stalls
while render quanta continue, then the 32-message guard fails closed. It does not
identify the browser/native scheduler internals responsible for the 1.24s gap.
Long-task entries are empty, not proof of absence of native/browser starvation.
Synchronous bridge consumption is not a measured multi-second blocker.

The canonical runner polls refresh at 5ms, collects two ORT load warnings with
remote Error-argument evaluation, switches offline once after assets-ready, and
does not request PCM or serialize diagnostics during active capture. Diagnostic
snapshots are collected after the run. There is no evidence tying those harness
operations to the recorded inference-time scheduling gap. No harness or product
semantic repair is justified from that attribution alone.

## Stress matrix limitation

Both 0ms cells PASS. Other six cells fail CAPTURE_CHRONOLOGY_VIOLATION before
the scheduled stall: first PCM [0,128), second [1024,1152), for example.
The sequence is consecutive but AudioContext frame/source range is not.
These are NOT credit failures or evidence of supported stall tolerance.
The stress harness starts capture immediately after AudioContext resume, unlike
the product's asset/model preparation interval. Follow-up diagnostic contract
uses a fixed pre-capture 500ms preparation and records every recent process call.
This tests startup attribution without discarding already-owned PCM or changing
the production capture implementation. No behavior repair or acceptance claim.

## Verification

151 Vitest files, 1131 passed, 0 failed; TypeScript, Next webpack build PASS.
Node 4 tests PASS (2 accounting + 2 research). Docker asset unittest 4 PASS,
model-access routes 3 PASS. Existing prefer-const lint warning retained verbatim
in verification.json, plus Docker pytest asyncio_mode configuration warning.

No acceptance freeze/repair yet. Musical/controller parity not run. STEP not run.
Capabilities remain MODEL_NOT_VALIDATED / ATTEMPT_ANALYZER_NOT_VALIDATED,
productionMicrophone=false, D4=false. No real-device/scientific claim.
