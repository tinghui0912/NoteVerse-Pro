# Fresh Physical Strike Evidence (Research Only)

This directory is not an application dependency. No product source is changed.
Robust perception runs independently; these detectors never gate its input.
Fresh gesture evidence is not pitch correctness, an attempt verdict, or TOO_QUIET.

## Prospective Development Budget

Exactly four definitions, no threshold search, no optional fusion in this cycle:

1. `decoded`: current authoritative decoder A (.30/.05), first-anchor 35ms
   pitch-agnostic grouping.
2. `historical`: exact historical causal RMS/flux DetectorConfig and algorithm,
   extracted without its unavailable benchmark imports. No retuning.
3. `rise`: local onset peak >= .30, frame support >= .05, onset contrast >= .15
   against the preceding 50ms minimum; local peak radius 20ms.
4. `support`: the same peak requirement, 80ms onset contrast >= .25, plus
   frame support rise >= .05 OR onset contrast >= .50.

The two morphology definitions test whether a new regression-onset peak can
separate attacks that a broad threshold region merges. The second additionally
tests evidence of renewed frame support, without requiring a sustained note to
disappear. These are engineering hypotheses, not qualified physical detectors.
All per-pitch evidence is discarded after pitch-agnostic first-anchor grouping.
Coherence is 35ms, not recursive; no additional refractory is added. A peak uses
only its declared model window, including the existing 170ms future context.
First frame on a plateau wins. Half-open 600ms anchor ownership applies.

Development eligibility, before any qualification selection: zero negative-guard
false tokens, zero duplicate tokens, recall >=90% overall, retrigger and chord.
If neither morphology candidate passes, STOP without selecting a best available
candidate or opening qualification audio. This stricter early stop avoids an
unjustified qualification run; qualification metrics remain NOT_EXECUTED.

## Data Contract

MIDI grouping uses the existing STEP 35ms fixed first-anchor gesture convention;
it never extends transitively. Match tolerance is fixed inclusive +/-100ms,
one-to-one maximum-cardinality/minimum-error. Any additional token within 100ms
of an already matched gesture is a duplicate, not another successful detection.
All unmatched tokens and exact failed source/case identities remain reported.

MAESTRO historical development/calibration is DEVELOPMENT ONLY. Historical frozen
STEP cases are excluded. SMD may only be reserved as source-disjoint qualification
relative to this trigger development; it is already AMT/Continuous-exposed and is
not globally blind. Hashes and exposure audit do not establish commercial rights.
No Vienna media is read. No dataset is downloaded.

Negative guards are interior note-on-free intervals of ANY pitch, independently
constructed from MIDI, with 100ms exclusion at either adjacent note-on. Held and
pedal subtypes require MIDI note/pedal state, not an old target-pitch label.
Strong acoustic sustain cannot be established from MIDI labels alone; it requires
a separately reported energy diagnostic, never detector conditioning.

Stage A serves only opaque PCM jobs, model and FIR/ORT assets. It must seal all
candidate outputs before Stage B opens truth. MIDI, family labels, truth, and
target times are never HTTP routes. Full PCM/raw tensors may exist only in this
isolated research transaction, never product state.

## Protections

Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED;
productionMicrophone=false; D4=false. 9G-B STATISTICAL_TIE/winner=null;
F5 NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER. No scientific winner claim.
