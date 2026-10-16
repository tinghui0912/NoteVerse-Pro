# Disabled Real-Capture Boundary

XC4 model/threshold/decoder/geometry identity is unchanged. XC6 is a separate,
internal source/capture adapter, not Practice capability or scorer qualification.
No normal Practice UI imports this module. It requires engineeringOnly:true.

The new AudioWorklet is model-neutral. It averages channels, transfers float32
chunks, and derives chronology from currentFrame relative to the first actual
input frame. Empty-input gaps cannot be hidden by a synthetic chunk counter.
The bridge validates sequence, rate, sample ranges, context frame and context
time. Score-shaped fields are rejected. It never acquires a microphone itself.

44.1k capture uses the exact existing XC4 FIR and XC5 CAPTURE branch. The one new
48k source adapter was triggered by a prospectively frozen, browser-faithful
getUserMedia/AudioContext/AudioWorklet metadata probe. It uses SciPy1.14.1's same
Kaiser beta5 design family, up1/down3,61 float32 taps,30 real source samples of
lookahead (0.625ms). Coefficients and adapter code are separately content addressed.
The first10 origin-boundary outputs are not fed into the model. There is no
padded finish, gain fitting or timing shift. Other source rates are rejected.

The 48k adapter emits validated16k PCM through XC5's explicit already16k injection
port. This is NOT a claim that microphone hardware is16k, nor a silent alteration
of the XC4 FIR. Outer observations restore original48k source coordinates and
record both acoustic-core and source-adapter SHA256. Raw capture chronology is
audited separately from the filtered PCM timeline. No coefficient sweep exists.

Start and stop are external source-sample boundary commands, not message arrival
timestamps or model decisions. The48k adapter requires these commands on its
target grid (raw index divisible by3); the browser fixture schedules them on
384-source-sample boundaries. This is an engineering interface constraint, not
a change to fixed BPM, score positions, or a claim about natural human timing.
The fixture's external performance-origin clock uses AudioContext.getOutputTimestamp
to map the source boundary to monotonic performance time. It continues after tail
capture closes. Inference never sets the clock.

At least1050ms of fully real model past is required. Early start returns
ACOUSTIC_PREROLL_NOT_READY. A scheduled boundary is applied to filtered PCM only
when the corresponding samples exist; FIR lookahead does not move the external
performance origin. Stop partitions the packet at the exact boundary and later
samples are context-only. Capture closes once the last real input is queued;
already in-flight, post-tail blocks remain explicitly counted. Unexpected context
suspension after start scheduling fails closed and requires a new session/pre-roll.

PCM retention follows the existing XC5 timeline, not an indefinite-memory claim.
44.1k stores raw source PCM;48k stores filtered16k PCM, with raw chronology metadata
only. Queued model windows can grow if inference falls behind; nothing is silently
dropped. This must be bounded before product enablement. No privacy policy is
inferred from a byte calculation.

The integration harness serves the pinned, unbundled ORT1.20.1 ESM/WASM assets to
preserve their worker bootstrap URLs. This corrects harness packaging, not the
model/provider/thread-count policy. WebGPU only; no automatic provider fallback.
The page hook is guarded against worker import; favicon204 prevents the previously
attributed403. Historical XC5 source/reports are not edited.

Product microphone remains MODEL_NOT_VALIDATED, no R2 promotion, no verdict UI,
no server inference, no score following, no commercial qualification or UX SLO.
