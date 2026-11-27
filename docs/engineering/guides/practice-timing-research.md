# Practice Timing Measurement

## Questions and evidence scope

The current research tools characterize the active Continuous assignment policy and
measure local performed-MIDI spacing. They support open qualification questions:

- How do W250 and repeated-key claimant overlap behave across tempo and density?
- Which physical attacks are assigned to a neighboring target under generated intent?
- What spacing and repeated-key distributions occur in an explicitly chosen corpus?

The tools import the real production finalizer, tempo timeline and policy constants.
They are offline tooling under tests/research; production imports cannot reach them.
No tool changes a threshold or runs a product session. Research reports identify the
current policy and measured inputs rather than constituting product architecture.

## Synthetic assignment characterization

From apps/customer-web:

```sh
npm run benchmark:practice-timing -- --output /absolute/path/assignment.json
```

benchmark-practice-timing.mjs uses the Vite middleware TS runner
practice-timing-runtime.mjs and the explicit research command. It needs no HTTP
listener, application bootstrap or dataset download. The deterministic matrix uses
product tempo endpoints and intermediate60/80/100/120/160/200 BPM, spacings2/1/1⁄2/1⁄3/1⁄4
beats and offsets0 plus both signs of10/25/50/75/100/125/150/200/249/250/251/300ms.
Patterns cover isolated notes, repeated keys/chords, alternating keys, neighboring
groups and chord substitutions, with midpoint and tempo-transition probes.

The real finalizer sees ordinary immutable evidence. Intended target identity exists
only in the generator and supports measurement of neighbor assignment; it is never
provided to production evaluation. Reports retain observations/targets, ownership,
claimant counts, frontiers, offsets, aggregate denominators and limitations. Empty
distributions have explicit null statistics. Report validation rejects malformed
shape/keys, nonfinite metrics and incompatible policy metadata.

Synthetic intent is fixture truth, not human intent. Rates describe policy behavior,
not learner accuracy, acoustic recognition, physical latency or a fitted tolerance.
The common-radius [matching proof](practice-timing-semantics.md) and independently
enumerated production tests address solver correctness separately.

## Explicit local corpus spacing

```sh
npm run analyze:practice-midi-corpus -- --input /absolute/path/midi   --output /absolute/path/spacing.json --dataset-name study --dataset-version 1   --source-note "dataset provenance and license"
```

The analyzer accepts a local MIDI file or directory, with deterministic traversal
and no symlink following or network fetch. Tone parses paired positive-velocity
note starts. The report includes file successes/failures, NOTE_ON-start counts,
inter-onset intervals, same-key gaps, explicit local tempo and beat-normalized gaps.
Absent explicit tempo remains missing metadata, not measured default tempo. Malformed
or unreadable files are reported and cause a nonzero command exit; partial results
are saved with their failure list.

Wire-level unpaired starts are not represented by Tone's paired-note abstraction.
Corpus spacing without canonical score alignment cannot estimate assignment accuracy,
learner intent, acceptable timing, false-positive progression or physical latency.
Dataset provenance/version and source notes are supplied explicitly; generated MIDI
fixtures test tooling integrity without standing in for a real corpus study.

## Qualification work

Timing qualification needs aligned scores/performances and intended attack labels,
learner/tempo/task strata, repeated-note and chord errors, delivery/availability traces,
physical-device clock/latency measurements and predefined failure metrics. Workload
studies need browser scheduling, heap/GC/GPU and backlog measurements. Any numerical
policy decision requires its own evidence review; equal numbers across policies do
not establish a shared owner.

Background reading for study design includes
[Repp's synchronization review](https://pubmed.ncbi.nlm.nih.gov/16615317/),
[Repp and Su's review](https://pubmed.ncbi.nlm.nih.gov/23397235/), and
[expressive performance modeling](https://www.frontiersin.org/journals/digital-humanities/articles/10.3389/fdigh.2018.00025/full).
These readings do not supply a NoteVerse threshold or product qualification.
