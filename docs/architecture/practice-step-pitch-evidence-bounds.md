# STEP Pitch-Evidence Boundary Audit (T15)

Round45 audits branch `refactor/practice-foundation-v2` at approved baseline
`25737d23e623f6c5e2e524f9796b1535b243db14`, parent
`b77722d6db1345f5d3a8f9b93d4ebc085c73d0bc`. This is documentation only: both
128 guards, STEP schema 8/runtime version, Result/provenance and acoustic identities
remain unchanged. It complements the [parameter ledger](practice-acoustic-parameter-provenance.md)
and [resource semantics](practice-acoustic-resource-semantics.md).

## Findings and authority

T15 combines an unreachable-on-valid-MIDI distinct-Set guard with a reachable
raw-array work guard. These are different contracts. The latter cannot honestly
be derived from the former. T15 therefore leaves Future DERIVE for DELETE/REDESIGN;
the remaining numeric raw-work policy needs separate qualification. The 93-row
inventory remains intact, but T15's primary class is corrected from
REDUNDANT_OR_DERIVABLE_IMPLEMENTATION_MAGIC to UNQUALIFIED_RESOURCE_SAFETY_POLICY.
The primary class describes the currently effective raw-work admission policy,
not a claim that every part of the mixed row is necessary. Counts change from
13 to 12 redundant/derivable and 10 to 11 resource-safety; semantic-unresolved stays 0.
S09 stays KEEP DERIVED STORAGE, S10 KEEP DERIVED/SINGLE OWNER, and S15 KEEP EXACT
CONSTRUCTION. No other classification changes.

The existing [product contract](practice-product-contract.md#step_by_step)
describes bounded canonical pitch evidence. Its 1–128 entry statement is current
admission behavior; the word canonical is producer intent, not proof that the
implemented domain validator recognizes exactly the standard MIDI universe.
This audit records that gap without redefining the product pitch language.

## Complete production call graph

Repository searches for completeAttempt, both assembler constructors and both
controller/runtime constructors find one application completion sink. The
[hook](../../apps/customer-web/src/hooks/practice/use-step-local-practice.ts)
constructs StepPracticeController without an alternate MIDI platform. The
[browser platform](../../apps/customer-web/src/lib/practice/step/step-platform.ts)
constructs BrowserMidiController. Test-injected platforms are not another shipped
producer.

### MIDI facts and input assembly

The path is:

`MIDIInput midimessage → BrowserMidiController.message/dispatchMidiData → parseMidiMessage → MidiNoteFact → StepPracticeController onMidiNote → StepMidiAttemptInput.note → StepPitchEvidence → attemptSink.complete → analyzeAttempt → StepPracticeRuntime.completeAttempt`.

The relevant owners are [browser-midi-controller.ts](../../apps/customer-web/src/lib/practice/midi/browser-midi-controller.ts),
[step-practice-controller.ts](../../apps/customer-web/src/lib/practice/step/step-practice-controller.ts),
[step-midi-attempt-input.ts](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.ts)
and [domain/runtime.ts](../../apps/customer-web/src/lib/practice/step/domain/runtime.ts).

- The actual browser message data is Uint8Array. Element representation supplies
  integral, nonnegative bytes 0..255. parseMidiMessage requires at least 3 bytes,
  rejects noteNumber or velocity above 127, masks the status channel nibble and
  recognizes NOTE_ON/NOTE_OFF. Extra bytes do not create additional facts.
  It relies on Uint8Array for integer/nonnegative representation; it does not
  separately assert Number.isInteger or instanceof for forged direct JS calls.
- NOTE_ON with positive velocity emits NOTE_ON; zero velocity becomes NOTE_OFF.
  NOTE_OFF has velocity 0 and never opens/adds STEP evidence. The accepted
  noteNumber range on this actual path is exactly integer 0..127.
- midiNoteToPitch uses the twelve spellings C,C#,D,D#,E,F,F#,G,G#,A,A#,B and
  octave=floor(noteNumber/12)−1. It maps 0..127 injectively to C-1..G9. The helper
  itself does not validate arbitrary input numbers. The parser computes pitch
  from noteNumber in the same returned object, so it cannot emit inconsistent
  primitive fields from valid browser bytes.
- dispatchMidiData adds the timebase-derived SessionTime. The controller forwards
  this note unchanged. MidiNoteFact is structurally typed, not a runtime proof or
  branded validated object. StepMidiAttemptInput.note is a parser-backed internal
  callback on the shipped path, not a complete validator for arbitrary such objects.
  It does not inspect noteNumber, validate velocity, validate pitch syntax or check
  pitch===midiNoteToPitch(noteNumber). A forged NOTE_ON can supply noteNumber 60
  with any unrelated string, including E4 or an invalid pitch.
- A first eligible NOTE_ON opens an attempt and stores its pitch in a new Set.
  Subsequent notes must have the same domain and be within the half-open H35
  interval, otherwise they are ignored. The Set deduplicates exact strings.
  A new distinct pitch is rejected before insertion when size>=128; repeated
  pitches at size 128 do not fail. Failure cancels active ownership/timer and calls
  the failure sink, rather than publishing partial evidence.
- The timer seals one sorted, frozen, nonempty unique pitch array, confidence1
  and the original capture end. Timer epoch/cancel fences late completion. It
  clears the active Set; no target content drives closure and no Set spans attempts.
  Controller attemptSink checks active ownership, calls analyzeAttempt, then
  completeAttempt and post-verdict retirement. No other production caller of
  completeAttempt was found. MIDI input failures reach failAttempt, cancel/end
  the attempt and report STEP_ATTEMPT_FAILED; no synthetic verdict is created.

After completeAttempt, the immutable normalized record is retained only as the
current pendingPostVerdict in the [domain session snapshot](../../apps/customer-web/src/lib/practice/step/domain/session.ts).
The controller exposes it, commitPostVerdict/rearm consumes its verdict, and
[PracticeStatus](../../apps/customer-web/src/components/practice/practice-status.tsx)
selects MATCH/MISMATCH presentation. These consumers do not revalidate an entry
count, impose another pitch universe or feed evidence back into an assembler.
STEP has no attempt-history/learner-report Result pipeline; this local record is
not a new persisted raw-evidence wire format.

Thus the Set cap is unreachable for a legitimate parser-produced sequence: all 128
wire pitches may occur, but a 129th distinct canonical pitch does not exist.
It is reachable for inconsistent direct callbacks. A read-only current-module
probe sent 129 different grammar-valid strings with noteNumber 60 at one H35 time:
STEP_ATTEMPT_PITCH_LIMIT_EXCEEDED, retained Set cleared, no completion. Sending
all 128 real parser notes twice instead completed with 128 unique pitches and no
failure. This is not evidence that arbitrary direct facts are already validated.

### Microphone/source facts and input assembly

The path is:

`BrowserAcousticCapture/SourceChronology → StepAcousticCaptureBridge → SourceAnalysisRuntime → AcousticModelSession/decodeRobustPiano → sourcePublication/SourcePublicationSequence → StepMicrophoneInput.publication → StepAcousticAttemptAssembler.accept → StepPitchEvidence → StepMicrophoneInput completed handoff → controller attemptSink.complete → analyzeAttempt → completeAttempt`.

See [decoder](../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts),
[source publication](../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts),
[microphone owner](../../apps/customer-web/src/lib/practice/step/step-microphone-input.ts)
and [assembler](../../apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts).

- The shipped decoder iterates 88 piano classes, midiPitch=21+pitchIndex, so integer
  MIDI 21..108. pitchName derives the same twelve sharp/natural spellings from that
  number (A0..C8). The actual worker decoder therefore emits consistent pairs and
  at most 88 distinct pitch strings across any publication or H50 gesture.
- sourcePublication bounds event count, integer midiPitch21..108, coordinates,
  confidence and IDs. It copies e.pitch. SourcePublicationSequence checks the same
  numeric pitch range, pitch syntax, ordered source mapping/ownership and duplicate
  observation IDs. Neither cross-checks the pitch string against midiPitch.
  Sequence's regex alone is not proof of the decoder's 88-string identity universe;
  it even uses regex coercion rather than a separate typeof-string assertion.
- The assembler runs its own SourcePublicationSequence before retaining
  observations. Its Map is keyed by observationId, not pitch. Different attacks
  of the same pitch may be retained as different observations, but the final
  `new Set(bounded.map(o=>o.pitch))` removes repeated primitive pitch strings.
  Repetition cannot enlarge the final evidence array for a valid decoded stream.
  H50, frontier sealing and rejection of an active region crossing stay unchanged.
- StepMicrophoneInput defers its application completion handoff until the source
  delivery/assembler stack unwinds, then the same source-neutral controller sink
  completes the domain attempt. It does not add target-aware filtering.
- Important distinction: actual decoded production output is bounded by 88 distinct
  pitches; a structurally accepted publication with primitive string fields can
  carry all 280 syntax strings described below if its other facts are consistent.
  A read-only forged-worker-result probe passed sourcePublication and Sequence
  with midiPitch60, distinct target/observation IDs and 280 different syntax strings
  inside H50. The real assembler emitted 280 distinct entries; the domain rejected
  that raw array. This is validator-accepted forged data, not a legitimate decoder
  output or a new product pitch contract. Arbitrary non-string JS objects are not
  bounded by the primitive-string language argument and are not legitimate decoded
  facts; the domain's typeof check rejects them within its raw-work envelope.

Observation count is distinct from T15 pitch cardinality. Existing source event
bounds and H50/window topology bound active observation ownership (the T14 audit),
while final pitch deduplication bounds actual producer output to 88. This round
does not alter either mechanism or install another cap.

## Four cardinalities

| Quantity | Current meaning | What is actually proved |
| --- | --- | --- |
| A: raw entries | observedAttackPitches.length before normalization | Domain accepts1..128 entries; duplicates count. No MIDI byte stream or serialized array protocol supplies this length to completeAttempt. |
| B: distinct semantic pitches | normalizePitchSet(array).length | Exact string Set+sort, with no enharmonic conversion. For an accepted call B<=A<=128; this does not mean all possible domain values form a128-value universe. |
| C: valid producer output | Array emitted by each shipped assembler | MIDI A=B<=128; microphone A=B<=88. Both producers deduplicate. This proves their output bounds, not the treatment of arbitrary raw arrays. |
| D: malformed/direct raw work | Pre-normalization short-circuit length rejection | The existing raw128 guard avoids scanning/deduplicating/sorting an arbitrarily long array and bounds retained normalized entries. Why128 is an appropriate resource budget is unqualified. It cannot bound a caller's prior allocation, message rate, hostile getters/proxies or total process memory. |

The Set guard separately limits retained distinct strings for inconsistent MIDI
callbacks; it does not limit total NOTE_ON count or the size of a forged first
pitch string. A finite raw-work policy and an injective wire-universe proof must
not be conflated.

## Current duplicate-array behavior and defensive intent

For an owned ANALYZING attempt with valid time/confidence:

- **128 raw C4 entries** finalize and normalize to one C4.
- **129 raw C4 entries** throw STEP_ATTEMPT_EVIDENCE_INVALID before pitch iteration or
  normalization; no record is created and direct runtime ownership remains ANALYZING.
- Both actual assemblers emit unique arrays, so neither produces either repeated
  raw-array witness. An arbitrary in-process/direct caller can exercise them.

This is explicit in [step-attempt.test.ts](../../apps/customer-web/src/lib/practice/step/domain/step-attempt.test.ts):
`too many pitch entries` rejects Array(129).fill('C4'), and `accepts the pitch-entry
upper bound` accepts 128 repetitions. The test calls this untrusted protocol data.
The [domain evidence type](../../apps/customer-web/src/lib/practice/step/domain/attempt.ts)
says bounded pitch facts, and the product contract states1–128 entries. These are
positive evidence for maintaining direct-input defense, despite the narrow shipped
call graph. There is no contract evidence authorizing Option4 (delete raw cap on
trust alone). An internal API can still have a defensive runtime boundary.

## Pitch identity: intended canonical output is not the checked domain universe

The existing domain regex is `^[A-G]#?-?\d$`. For primitive strings it permits
7 letters×2 sharp choices×2 sign choices×10 digits=280 spellings. JavaScript flags
are unchanged; a trailing newline is rejected. This language includes E#4, B#3,
C-9, C-0 and G#9. A read-only invocation of the actual domain completeAttempt
accepted each singleton and finalized MISMATCH against C4. It does not establish
that such data is intended valid learner input. It establishes the validator's
accepted set. normalizePitchSet(['E#4','F4','E#4']) remains ['E#4','F4']; it does
not map E# to F, canonicalize -0, or enforce the MIDI number range.

| Owner | Actual canonicalization/validation | Consequence |
| --- | --- | --- |
| Backend score production | [score_loader.py](../../backend/app/processing/practice_score/score_loader.py) passes Partitura note_array to [score_timeline.py](../../backend/app/processing/practice_score/score_timeline.py); _event_from_notes uses _midi_pitch_name(int(pitch)), then [artifact serialization](../../backend/app/processing/practice_score/practice_score_artifact.py) preserves it. | The twelve sharp/natural spellings are produced, not E#/B# notation. Repository timeline conversion does not itself enforce0..127; an external parser assumption is not a domain-owned range proof. No score parser changes are proposed here. |
| Browser artifact/STEP target | [kernel/artifact.ts](../../apps/customer-web/src/lib/practice/kernel/artifact.ts) checks nonempty unique physical pitch strings and notation/target identity consistency; [step target projection](../../apps/customer-web/src/lib/practice/step/domain/target.ts) copies them. API pitch fields are strings. | Artifact admission does not enforce the evidence regex, MIDI range or canonical spelling. Consistently altered artifacts can pass this local validator; that does not make them shipped backend outputs. |
| Browser MIDI | Byte gate plus midiNoteToPitch on0..127 | Actual path has128 canonical identities; note() alone does not enforce that invariant. |
| Acoustic | Shipped decoder generates21..108 and pitchName; publication checks numeric range and syntax independently | Actual path has88 identities, but payload validation does not prove pair consistency. |
| StepPitchEvidence/domain | A nonempty string tuple in TypeScript; runtime validates raw count, typeof, regex, confidence/time/attempt ownership | No domain-owned canonical pitch↔MIDI identity contract exists. The accepted primitive pitch language is broader than Browser MIDI's128 values; a single accepted array is still capped at128 raw entries. |

Neither normal Browser MIDI nor the shipped decoder emits unusual E#/B# strings.
They can reach completeAttempt via direct accepted evidence or forged publications
that pass current validators. Do not label those counterexamples normal physical
producer facts, and do not use normal producers alone to claim that the domain
already guarantees standard MIDI identity for every admitted value.

The MIDI [assembler tests](../../apps/customer-web/src/lib/practice/step/step-midi-attempt-input.test.ts)
use noteNumber 60 for every chosen pitch, including E4. The controller tests use the
same convenience pattern. They prove gesture/application behavior, not parser
consistency. A future consistency regression must use real parser facts or honest
numbers for valid scenarios, and identify mismatched objects as malformed tests;
Round45 changes none of those tests.

## Candidate decision matrix

All candidates must retain score-blind assembly, one attempt's ownership, no
cross-attempt accumulation, exact string-set evaluation unless separately changed,
no target-aware closure, no evidence dropping, shared source-neutral evidence and
fail-closed malformed input. No domain dependency on browser/acoustic implementations
or universal coordinator is justified.

| Candidate | Correctness effect | Accepted-set change | Resource/boundedness effect | Dependency effect | Valid MIDI | Valid microphone | Result/schema/version | Evidence needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|1. Keep both128 guards; reclassify purposes | Preserves current checks but leaves MIDI identity assumption implicit | None | Set/raw-work defenses stay finite; numeric128 resource rationale still missing | None | Unchanged | Unchanged | None | Explicit raw-work contract and CPU/memory/workload evidence; this alone cannot close identity debt |
|2. Remove only MIDI Set guard | Valid wire facts remain finite; inconsistent callbacks no longer fail at129 | More malformed callbacks can be retained | Potentially unbounded arbitrary-string Set until timer delivery; domain rejection occurs too late to bound assembler storage | None | Unchanged | Unchanged | No Result shape change; input-contract change requires review | A proved exclusion of malformed callbacks or stronger identity boundary; not currently established |
|3. Replace MIDI cap with strong wire/fact consistency validation | Fail before retaining inconsistent noteNumber/pitch; finite wire universe bounds Set | Rejects inconsistent direct NOTE_ON facts earlier | At most128 distinct short canonical strings; raw domain guard remains separately intact | Source-aware MIDI application may use MIDI-owned validator; domain imports neither browser nor decoder | Unchanged with parser-consistent facts | Unchanged | No domain accepted-set/record/schema change if limited to this boundary | Parser-derived all-note/dedup tests, malformed-pair rejection before retention, no stale completion and normal controller regressions |
|4. Move runtime cardinality after dedup only | Confuses distinct cardinality with current raw admission unless separately specified |129 duplicate C4 would become accepted; distinct>128 still rejected | Arbitrary raw iteration/allocation remains unbounded; dedup before validating could also retain arbitrary strings | Can stay domain-local | Unchanged | Unchanged | Changes v8 direct evidence contract; runtime-version/product decision required; no necessary Result shape change | Justified trust exclusion or separate raw-work bound; current contract supports neither removing defense nor128 as the whole pitch universe |
|5. Split semantic distinct check from raw-work protection | Separates identity semantics from workload defense | Depends on independently chosen raw limit and pitch language;129 duplicates remain rejected if raw limit stays128 | Precheck bounds work; post-dedup checks cannot replace it | Domain owns raw evidence and semantic facts; no input-infrastructure import | Can remain unchanged | Can remain unchanged | Changes to raw/pitch admission need runtime-version review; no automatic Result field | Explicit domain pitch contract plus justified raw budget and duplicate/invalid-call regressions |
|6. Define domain-owned canonical pitch universe and derive distinct bound | Can prove finite semantic identity, but current broader admission must be addressed | Rejects/normalizes currently admitted unusual strings if restricted to MIDI; artifact edge cases need review | Finite distinct memory still does not bound an arbitrary raw duplicate array | Domain-owned contract with producer/score adapters; never domain importing BrowserMidiController or acoustic model | Current canonical output can remain unchanged | Current canonical output can remain unchanged | Domain semantic tightening needs explicit runtime-version/score-contract decision, not a mechanical schema claim | Complete score/parser range and spelling audit, compatibility/product decision, both producer and direct-call evidence |

Options1–4 in the task map to: keep an explicit raw policy (candidate1/domain
portion of 3), split precheck and post-dedup semantics (candidate5), strengthen
finite identity while retaining a raw-work owner (candidate3 now; candidate6 is
broader), or remove raw defense on trust (unsupported). No choice is justified
merely by reducing literal count.

## Exactly one recommended Round46 implementation

Recommend **candidate3, MIDI fact integrity only**: validate NOTE_ON integer
noteNumber0..127 and primitive pitch===the MIDI owner's canonical mapping before
opening/inserting assembler ownership, then remove only the unreachable distinct
128 Set guard. Keep the fact-validation helper with the MIDI fact/wire owner or
its source-aware input boundary; StepPracticeRuntime must not import it. Preserve
NOTE_OFF ignoring, H35/time ownership, score blindness, cancellation and failure
propagation. Do not implement a general domain pitch-universe migration in that
round. Existing synthetic valid-test helpers must use parser-consistent facts;
malformed helpers must assert early fail-closed behavior instead.

State the two guards and ownership separately:

- **StepMidiAttemptInput:** replace count-based defense with validated source fact
  identity before retention. The finite distinct bound is then a consequence of
  the MIDI wire/fact owner, not a new numeric Set policy. Until that change is
  independently implemented and tested, keep the existing guard unchanged.
- **StepPracticeRuntime:** keep its current pre-normalization raw128 rejection in
  its existing domain owner. Treat128 as the explicit, unqualified raw-work
  admission contract, not a derived distinct-pitch maximum. Do not move the check
  after normalizePitchSet and do not raise/delete it as part of MIDI cleanup.
- **129 duplicate C4 entries:** continue to reject, because they exceed the
  retained raw-work contract even though the eventual semantic set would have
  size 1. Changing this is a separate API/product decision requiring another raw
  work bound or an explicit removal of direct-input defense.
- **Malformed direct callers:** inconsistent MIDI identity fails before the Set;
  oversized raw evidence fails before pitch iteration/Set/sort; bounded raw arrays
  still undergo typeof/grammar/confidence/time/ownership checks. Do not promise
  defense against arbitrary hostile objects, prior caller allocation or all CPU
  scheduling from an entry count alone.
- **Versions:** this recommended source-boundary-only change leaves the domain
  v8 accepted evidence contract and records unchanged, so no STEP schema 8/runtime
  version or Result/provenance schema change is required. A later change to raw
  admission, normalization or domain spelling semantics needs an explicit version
  decision; it is not authorized by this recommendation.

T15 remains **unresolved**, in DELETE/REDESIGN with numeric raw-work qualification
still open; Future DERIVE is empty. This is not a claim that all magic numbers or
pitch-identity gaps are resolved. Round45 implements none of the candidate futures.

## Audit evidence and validation scope

Production source inspection establishes the contracts above. Read-only executable
characterization transpiled the current modules in memory (no repo source/test
edits), invoked the real parser/assemblers/domain, and confirmed the duplicate,
unusual-spelling, all 128 MIDI and forged-publication witnesses described here.
Those probes are audit observations, not added unit tests or device qualification.
Existing relevant tests may be run unchanged as confirmation; the completion
report records the exact tests and documentation/ledger checks actually executed.
No full-suite/typecheck/lint/E2E/backend/build success is inferred from docs-only
work. No acoustic identity advance, schema/version change or hosted rerun occurs.
