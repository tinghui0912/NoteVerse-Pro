# Practice Timing Policy Research

This is a research harness for the **current** fixed Continuous assignment policy.
It neither selects a replacement policy nor calibrates a device. Production owns
the window, matching, finality and tempo conversion; research imports those owners.
See the [Practice product contract](../../architecture/practice-product-contract.md)
for the product's timing coordinates and unchanged policies.

## Run the synthetic characterization

From `apps/customer-web`, with the existing Node dependencies installed:

```powershell
npm run benchmark:practice-timing
npm run benchmark:practice-timing -- --output "C:\Research output\synthetic.json"
npx vitest run tests/research/practice-timing
```

The CLI uses the installed Vite TS loader without starting an HTTP listener or
bootstrapping the application. It imports `ContinuousAssignmentFinalizer`,
`ContinuousExpectedStrike`, `ContinuousEvidencePublication`, the production
claimant/cohort functions and `PracticeTempoTimeline`. It does not inject another
window or implement another matching algorithm. Normal unit/coverage runs also
include the deterministic research tests; they require no external corpus,
internet, loopMIDI or physical keyboard.

The default compact JSON is
`apps/customer-web/artifacts/practice-timing/synthetic_assignment.json` (git ignored).
Do not commit or upload generated large reports. A user-specified output directory
is allowed; keep it outside version control. The separate research schema is
version 1, with generated-at time, known benchmark kind, current production policy
identity/window, case counts, outcomes and aggregate metrics. Validators reject
unknown versions/kinds/fields, non-finite numbers and invalid counts without repair
or migrations. This schema is unrelated to Practice Result schema 5.

### Deterministic experiments

- Tempo grid: product min/max (currently 40/240), plus 60, 80, 100, 120, 160 and
  200 BPM. Beat spacing: 2, 1, 1/2, 1/3 and 1/4 canonical quarter-note beats.
- Offsets: 0 and both signs of 10, 25, 50, 75, 100, 125, 150, 200, 249, 250,
  251 and 300ms. All beat-to-performance conversion uses the product timeline.
- Families: isolated control, same-pitch repeated notes, alternating C/D,
  same-pitch repeated groups, repeated C/E/G chords, chords with one repeated
  member, dense neighboring groups, and a C/E/G target with an A substitution.
- `FULL_SWEEP`: every target generates one observation at the specified offset.
  The substitution family changes only fixture pitch, retaining its intended slot.
- `SINGLE_PROBE`: repeated-note targets A and B each generate a lone observation
  across the same sweep. This exposes claimant competition without other evidence
  forcing maximum-cardinality matching back toward intended identity.
- One exact midpoint `TIE_CASE` freezes stable identity selection. Tests also
  reverse expected input order and cover cardinality-before-cost, minimum absolute
  timing error, and retention of unmatched observations as unattributed at every BPM.
- An 80→160 score-tempo transition characterizes a fixed +250ms on both sides.

There are **10,003 cases**: 8,000 full-matrix cases, 2,000 single probes, one tie
and two transition controls. Exact isolated controls must match at every tempo;
failure aborts the benchmark. Inclusive ±250 boundaries and excluded ±251 direct
claimants are tested explicitly. A dense pattern can still assign an observation
outside its *intended* window to a legal neighboring same-pitch strike; it must not
be called outside *every* window merely because its generated offset exceeds 250.

Each observation row records intended and assigned strike identities, raw assignment
kind, observed pitch and performance coordinates, intended target matched/unmatched state, production timing offset, generated
offset, legal same-pitch claimant count (0/1/2+), neighbor misassignment and
unattributed state. Intended identity is research-only; it never enters production
evidence. Assignment relations are exact same-pitch `STRIKE_MATCH` or `UNATTRIBUTED`;
non-target pitches are never assigned to target slots.
Same-pitch consecutive expected gaps and cohort membership come from the production
cohort function. No transitive cohort closure is invented.

### Reading the table

The terminal table has BPM, beat duration, assignment window in local beats, nominal
adjacent **group** spacing, claimant-overlap rate, neighbor-misassignment rate and
unattributed rate. It aggregates **FULL_SWEEP observations only**, equally sampling
the fixed tempo/spacing/family/offset matrix, with observations as the denominator.
Probes/ties/transitions remain individually available in JSON. Actual consecutive
same-pitch spacing is in each case's `samePitchSpacingMs`; it may differ from group
spacing (e.g. C/D/C/D) or be null for an isolated note. Cohort-gap counts have their
own denominator: consecutive expected same-pitch gaps, counted per case.

The current ±250ms half-window corresponds to:

| BPM | Beat duration (ms) | Assignment half-window (beats) |
| --- | ---: | ---: |
| 40 | 1500 | 0.167 |
| 60 | 1000 | 0.250 |
| 80 | 750 | 0.333 |
| 100 | 600 | 0.417 |
| 120 | 500 | 0.500 |
| 160 | 375 | 0.667 |
| 200 | 300 | 0.833 |
| 240 | 250 | 1.000 |

Adjacent same-pitch cohorts meet at spacing ≤ twice the current window, a derived
500ms rather than another product constant. In this grid, repeated same-pitch
2-beat spacing first meets that condition at 240 BPM; 1 beat at 120; 1/2 beat at
60; 1/3 beat at 40; 1/4 beat throughout the supported grid. At equality there is
only a touching inclusive point; below it there is a positive overlap interval.
The 80→160 transition changes the same 250ms from 1/3 to 2/3 local beat.

These geometric facts do not imply every observation is ambiguous. Claimant count,
other observations, maximum cardinality, timing cost and stable identities jointly
determine the actual outcome. Midpoints can tie; observations past a midpoint can
prefer a neighbor, while dense complete gestures can preserve intended matching
through cardinality constraints. Finite offset/family sampling defines these rates;
they are neither population accuracy nor a recommended replacement tolerance.
No automatic policy recommendation is emitted.

## Optional local MIDI corpus analysis

Prepare local `.mid`/`.midi` files yourself, outside the repository. The analyzer
does not fetch archives, follow URLs, create a network cache or process audio.
For example, the official [MAESTRO dataset page](https://magenta.tensorflow.org/datasets/maestro)
offers a v3.0.0 MIDI-only archive and states the external CC BY-NC-SA 4.0 license.
Review its license/citation requirements and record the exact dataset version.
Do not commit MAESTRO, MAPS or any other external corpus. No such dataset is owned
by this repository or required by CI.

```powershell
npm run analyze:practice-midi-corpus -- --input "C:\Corpora\maestro-v3.0.0" --dataset-name "MAESTRO" --dataset-version "3.0.0" --source-note "Locally prepared MIDI-only archive"
npm run analyze:practice-midi-corpus -- --input "C:\Research\tiny.mid" --output "C:\Research output\spacing.json"
```

Quoted paths are normal Node arguments, including spaces and Windows drive paths;
no Bash environment syntax is needed. Recursive discovery is sorted and accepts
case-insensitive `.mid`/`.midi` files. Other directory entries are ignored, symlinks
are not followed, and an explicitly selected non-MIDI file or remote URL is rejected.
SMF formats 0/1 with PPQ timing are supported; SMPTE division and invalid/truncated
containers fail explicitly. The existing `@tonejs/midi` parser is the sole MIDI parser.

The report records total discovered MIDI files, successes/failures, parsed NOTE_ON
starts, global inter-onset intervals, consecutive same-pitch gaps, explicit local
tempo and gaps normalized by local beat duration. Counts refer to Tone's paired,
positive-velocity note starts, **not a raw wire-message counter**; unpaired note-ons
are not represented. All tracks/channels are merged by pitch and onset, including
simultaneous starts (zero IOI). Files never contribute gaps across file boundaries.
Sustain duration does not change onset spacing. These definitions matter for
non-piano/multi-track data; select an appropriate corpus and preserve its metadata.

Distributions retain count/min/p50/p90/p99/max (sorted nearest-rank floor index).
Empty distributions use null quantiles. Tempo is note-weighted and uses explicit
tempo metadata active at each note. Missing tempo contributes to
`implicitTempoNoteCount`, not a fabricated observed 120 BPM. The parser's standard
implicit tempo can still supply seconds. A same-pitch gap is normalized using the
earlier onset's explicit local beat duration; a gap crossing a tempo boundary is
not claimed to be integrated score beats. The overlap threshold is read from the
same imported production manifest (twice its window), never copied into the CLI.

Invalid/read-failed files are listed by path plus stable category; raw parser error
messages are not report truth. Partial JSON is written and the CLI exits **1** if
any MIDI file failed; a fully successful/empty directory analysis exits **0**.
Discovery/argument/output errors also exit nonzero. No files are silently skipped
because they failed parsing. Default output is the ignored
`artifacts/practice-timing/midi_corpus_spacing.json`.

Synthetic fixtures are generated in tests: a handful of C/D/E starts and two tempo
events, not copyrighted compositions or checked-in corpus binaries. Tests cover
the real CLI, nested/spaced/Unicode paths, metadata, gaps and corrupt-file behavior.
There is no registered "missing corpus" test to skip in normal CI.

Performance MIDI (including MAESTRO) is **not** NoteVerse canonical score alignment.
Corpus analysis characterizes performance spacing/density only. It cannot measure
NoteVerse assignment accuracy, physical key intent or browser input latency.

## Optional manual virtual MIDI qualification

[loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) creates Windows
virtual loopback MIDI ports between applications. With loopMIDI plus FreePiano or
an equivalent MIDI source configured to send to that port:

1. Create a named port, select it as the virtual source's MIDI output, then allow
   browser Web MIDI access through normal Setup. Do not install a driver from this
   script; this workflow is manual and optional.
2. Enter Practice and verify browser discovery, MIDIAccess ownership, NOTE_ON
   delivery and native `MIDIMessageEvent.timeStamp` plumbing.
3. Exercise Pause/Resume Count-In; notes during count-in must not enter performance
   evaluation. Exercise End/Start and same-page Device Lease reuse.
4. Disconnect/reconnect the virtual port; verify the existing device fault/recovery
   behavior. Leave Practice and verify listeners/lease ownership are released.

Virtual MIDI timing is **not physical digital-piano latency**. It can qualify Web
MIDI delivery/lifecycle plumbing, not key actuation, hardware generation, USB,
Bluetooth, driver latency or jitter. Do not derive production calibration offsets
from this workflow. This round adds documentation, not a virtual MIDI harness.

A future hardware/loopback rig must independently measure physical key actuation →
device MIDI generation → USB/Bluetooth/driver → browser native timestamp, including
end-to-end latency/jitter. Hardware is not a prerequisite for this musical-policy
benchmark. Non-zero calibration needs its own empirical protocol; API latency hints
and ordinary user playing offsets are insufficient.

Paired audio/MIDI qualification is also separate future work: acoustic event-time
mapping error, model onset-delay distributions and decoder latency could be studied
then. This tool does not download or batch-process a large audio corpus.

## Production isolation

Research lives in `apps/customer-web/tests/research/practice-timing/` and two explicit
Node commands. The production-source AST guard forbids importing these modules or
their CLI runners from app/components/hooks/practice code. Research may consume
production; the reverse dependency is prohibited. No report enters Result, learner
metrics, Review, analytics, Share Video, PerformanceTake or backend.

STEP 35ms/H50 50ms, Continuous ±250ms and MIDI coverage grace 250ms are unchanged.
Strike decision frontiers come from the current direct same-pitch cohort policy;
a group's unclamped decision frontier is the maximum of its child strike frontiers.
These are derived relationships, not independent group timing bounds. This research
does not establish 250ms as the optimal product value.

The current assignment identity is `CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V3`.
MIDI evidence remains `MIDI_NOTE_ON_SESSION_TIME_WITH_250MS_COVERAGE_GRACE_V2`;
target states are source-blind MATCHED/UNMATCHED, without a second interpretation
tree or group verdict. Result is schema 5. `CONTINUOUS_NO_INPUT_TIMING_CALIBRATION_V1` still means
`calibrationApplied=false`, with no offset or calibration UI.
