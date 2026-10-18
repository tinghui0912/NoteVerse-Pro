# Additive v3 Source-Purpose Correction

The immutable v3 disposition remains
`STEP_WAITING_H50_PRIMARY_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED`.
This does not invalidate an acoustic result: v3 executed no new neural inference.
The historical `primaryEligibleRecordingCount = 25` is not edited.

The repository's frozen corrected dataset inventory,
`backend/research/reports/phase9g_d1r_corrected_local_public_dataset_inventory_2026-10-12.json`,
independently identifies MAESTRO as:

```text
license = CC BY-NC-SA 4.0
trainingOverlapStatus = KNOWN_TRAINING_DOMAIN_OVERLAP
currentlyAllowedResearchRole =
DEVELOPMENT_ADAPTER_VALIDATION_ONNX_PARITY_PIPELINE_DEBUGGING_ONLY
```

Therefore the MAESTRO item is development-only, not authorized for final primary
model-independent qualification. Noncommercial license terms do not themselves
prohibit noncommercial research; a known license is simply insufficient evidence
of an authorized qualification purpose. The new policy separates these facts.

The corrected recording-level engineering truth baseline has **24 Vienna items**.
Its counts, recomputed using hash-verified original v3 code, are:

| Family | Truth metadata opportunities |
| --- | ---: |
| correct_single | 8 |
| correct_chord | 17 |
| same_pitch_sustain | 0 |
| same_chord_sustain | 1 |
| single_busy_retrigger | 0 |
| chord_busy_retrigger | 2 |
| post_ready_repeat | 0 |
| multiple_wrong_then_correct | 0 |
| partial_then_full | 0 |

This matches the required independent baseline exactly. The five gaps and all
selector geometry remain unchanged. Batik may only fill these gaps; it cannot
replace the retained Vienna cases.

## Purpose Scope

Vienna's historical authorization is an external proxy candidate after protocol
and alignment verification, not official product-capture metrics. The older
9G-D.3 performer-level external-final exclusion remains intact. This task's
recording-level, noncommercial engineering truth discovery is not a new claim of
performer-disjoint scientific validation or commercial eligibility.

Batik provenance is pinned to `pymatchmaker/matchmaker-benchmark-data` commit
`fd1c78749b08182e8c078993fcf0645cd4a0a22e`. The publisher metadata lists 36
performance MIDI/audio pairs. Its attribution describes JKU Yamaha Disklavier
recordings driven by the corpus human performance MIDI, with original timing
and dynamics, not the commercial Roland Batik recording. Attribution and license
hashes are recorded in `batik-byte-manifest.json`. This is a publisher provenance
claim, not independent audio alignment or compressed-source suitability proof.

The inspected upstream ByteDance README declares MAESTRO v2.0.0 training.
Batik's status is only
`NO_DOCUMENTED_TRAINING_OVERLAP_IN_INSPECTED_UPSTREAM_DECLARATION`, not proof
that Batik was absent from all training. The active Robust ONNX identity and
local checkpoint lineage remain protected and unchanged.

## No Audio Or Acoustic Execution

Only public metadata and MIDI bytes are acquired. No audio object is fetched.
Audio SHA256 and PCM identities remain unknown. Future audio is identified by
its immutable upstream Git blob and metadata row, not a fabricated SHA256.
The unmodified canonical v3 truth-pair identity consequently binds a null
`audioSha256`; its source envelope also binds the upstream audio object. It is
not an acoustic-byte qualification identity.

Because no audio is acquired, the selector's duration field for Batik uses MIDI
end-of-track as **symbolic performance extent**. No selector code or numerical
rule changes. Real audio boundaries, synchronization, past/future PCM context
and exact model-input preservation remain unmeasured and must pass a separately
authorized prospective acquisition protocol. No MIDI opportunity is called
READY PASS, BUSY PASS, acoustic PASS, H50 QUALIFIED, or PRIMARY QUALIFIED.

All production paths, v3 evidence, H50, decoder, FIR, source ownership, capture
transport, STEP/MIDI/Continuous semantics and capability values are untouched.
No neural execution or microphone integration is authorized in this phase.
