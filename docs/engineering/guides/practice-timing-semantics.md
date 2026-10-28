# Continuous Timing Semantics Audit

> Historical V3 record: this audit was performed against
> `2fcfb9582b7df89e1bd57af3a42beef0cb4f2354` and published in `7e3833a1`.
> Subsequent V4 production changes only the cohort solver and equal-objective
> ownership ties to chronological non-crossing order. The common-radius structural
> proof remains applicable. All V3 counts, identity-tie examples and numeric tables
> below remain historical evidence and have not been rewritten as V4 results.
> The current research CLI imports the current production identity and reports V4;
> its arbitrary-graph generic solver is a research-only V3 reference. See the
> [current research guide](practice-timing-research.md#ordered-v4-production-regression)
> for the subsequent production regression.

Research/proof round against the independently approved
`2fcfb9582b7df89e1bd57af3a42beef0cb4f2354` baseline. This document neither selects a
production policy nor authorizes timing/matcher changes. Production source remains
unchanged, including assignment V3, Result schema 5, MIDI coverage grace and source
mapping. See the [existing research guide](practice-timing-research.md) for the
unchanged 10,003-case baseline and optional local corpus workflow.

## Reproduce

From `apps/customer-web`:

```powershell
npm run audit:practice-timing
npm run audit:practice-timing -- --output "C:\Research output\timing-audit.json"
npx vitest run tests/research/practice-timing
npm run benchmark:practice-timing
```

The new CLI runs ten candidates against the existing 10,003 cases, plus 25 focused
adversarial scenarios, 32 tempo-scaling scenarios and the independent finite proof
search. It writes a separate version-1 `CONTINUOUS_TIMING_SEMANTICS_AUDIT` artifact
under ignored `artifacts/practice-timing/`, or a user-selected path. It does not
migrate an old research artifact. Generated JSON is not committed. Inputs, rule
metadata, ownership, target states, claimants, required/unclamped frontiers and
latency in milliseconds/local beats remain available in that artifact.

Research is owned only by `tests/research/practice-timing/`. Existing import guards,
strengthened with static-import/re-export/dynamic-import negative probes for the
new modules and CLI, forbid production from importing it. The existing benchmark
case generation, production policy/algorithm and old research schema are untouched.

## The four distinct questions

- **Eligibility (A):** is an exact-pitch event sufficiently near an expected onset
  to be accepted as candidate target evidence?
- **Ownership (B):** which target gets an event when multiple same-pitch targets
  could claim it? A unique owner still does not prove acceptable onset timing.
- **Decision frontier (C):** how much Performance-Time evidence coverage closes a
  target decision/assignment under the chosen policy?
- **Analysis availability (D):** when did the source reliably analyze that region?
  This is already owned by coverage and canonical Session-Time availability, not
  by a candidate's acceptance/ownership rule. No source delay or calibration is
  added to the research intervals.

Score, BPM and tempo maps provide target onsets, adjacent group/same-pitch onsets,
local beat duration, IOIs and scope boundaries. We use production tempo conversion.
This geometry can partition ownership. It does not establish how far an attack may
be from every target and still count as acceptable timing. Notation duration/end
is not automatically an attack deadline.

## Candidate definitions and conclusion matrix

All candidates are exact-pitch, one observation per matched target, unique
observation ownership. Events outside the captured performance/scope are excluded.
Let W be the imported current window, b_i target-local beat duration, h_i the
midpoint to the next scoped same-pitch onset, and q_i the nearest IOI. Midpoint
cells are lower-inclusive/upper-exclusive: equality belongs to the later onset.
The final scope endpoint is inclusive. These are explicit research conventions,
not a claim about learner intent. Scope-mid-score fixtures retain outside-scope
canonical group onsets for the group-IOI candidate only; same-pitch ownership uses
the scoped target set.

| Candidate | Eligibility | Ownership | Unbounded distance across scores/scopes? | Post-ownership overlap / unique owner | Generic matcher necessity | Free parameters |
| --- | --- | --- | --- | --- | --- | --- |
| CURRENT_FIXED_MS | absolute offset <= W | actual production finalizer/cohort matcher | no | yes / no | overlapping objective needed; generic implementation not mathematically necessary for primary objectives; exact ties not reproduced by tested DP | W remains unqualified policy parameter |
| MIDPOINT_ONLY | no independent cap | midpoint cells | **yes** | no / yes | no, independent per-target selection | no numeric tolerance; equality/scope choices still product decisions |
| CURRENT_WINDOW_MIDPOINT | absolute offset <= W | intersect W window with midpoint cell | no | no / yes | no | W plus ownership/equality choice |
| BEAT_RELATIVE_0.0625 | absolute offset <= b_i/16 | offline same-pitch graph | conditional: no on tested 40–240 BPM grid; yes if local beat duration is unbounded | possible / no | constant-tempo non-crossing optimum; variable-tempo ordered DP can fail | r=1/16, unqualified |
| BEAT_RELATIVE_0.125 | absolute offset <= b_i/8 | offline same-pitch graph | conditional: no on tested 40–240 BPM grid; yes if local beat duration is unbounded | possible / no | same conditional result | r=1/8, unqualified |
| BEAT_RELATIVE_0.25 | absolute offset <= b_i/4 | offline same-pitch graph | conditional: no on tested 40–240 BPM grid; yes if local beat duration is unbounded | possible / no | same conditional result | r=1/4, unqualified |
| BEAT_RELATIVE_0.5 | absolute offset <= b_i/2 | offline same-pitch graph | conditional: no on tested 40–240 BPM grid; yes if local beat duration is unbounded | possible / no | same conditional result | r=1/2, unqualified |
| BEAT_RELATIVE_1 | absolute offset <= b_i | offline same-pitch graph | conditional: no on tested 40–240 BPM grid; yes if local beat duration is unbounded | possible / no | explicit crossing-only counterexample at a tempo change | r=1, unqualified |
| GROUP_IOI_HALF_MIDPOINT | half nearest canonical group IOI | intersect radius with same-pitch midpoint cell | **yes**, long-rest/isolated pathology | no / yes | no | half-IOI acceptance is unqualified; midpoint geometry is structural |
| SAME_PITCH_IOI_HALF_MIDPOINT | half nearest same-pitch IOI | intersect radius with same-pitch midpoint cell | **yes**, long-rest/isolated pathology | no / yes | no | half-IOI acceptance is unqualified; midpoint geometry is structural |

The beat candidates have no independent absolute cap: bounded local beat durations
bound their radius, but an unboundedly slow local tempo would not. The table makes
only the tested tempo-domain claim, not an additional production tempo constraint.

Raw eligibility sets can overlap even when post-ownership sets do not. Inclusive
half-IOI windows can touch at one event time; midpoint ownership removes that
shared endpoint. The IOI candidates use scope boundaries when there is no IOI,
recorded explicitly in rule metadata; this is a tested research pathology, not an
approved fallback. No hybrid `min(ms, beats, IOI)` winner is constructed. A candidate
needing tolerance choices **requires unqualified policy parameters**.

For beat candidates, the offline reference uses the real production generic
matcher, with identity-sorted inputs, on the whole same-pitch graph. CURRENT uses
the actual finalizer's anchored direct-cohort commits. Thus these comparisons
include that declared ownership/commit distinction; differences cannot all be
attributed solely to changing r. No batch/global equivalence theorem is asserted
for the entire streaming finalizer.

## Negative controls, endpoints and observable colors

The isolated target `C4 @ 1000ms`, event `C4 @ 5000ms`, scope ending at 12000ms is
UNMATCHED under CURRENT/current-window clipping, but MATCHED under midpoint-only.
With targets at 1000 and 10000ms, the same event is still assigned to the first
midpoint cell, despite a 4000ms offset. Half-IOI radii also accept this long-gap
attack. Increasing an isolated scope or a gap makes accepted distances arbitrarily
large: **score-derived ownership alone does not imply acceptable onset timing**.

First/last midpoint cells extend to scope boundaries; pre-rest/post-rest controls
accept distant events. Half-IOI candidates reject those particular controls when
the other target is nearby, but accept the sparse/long-interior-gap and isolated
controls. Fixed W and midpoint-clipped W retain finite onset locality at both ends.
All policies still respect the explicit scope boundary and natural terminal.

A midpoint cut is not a behavior-preserving matcher simplification. Targets 1000
and 1250ms, events 1100 and 1110ms: CURRENT matches both targets; both events belong
to the earlier midpoint cell after clipping, so only one target matches. The cap
stays W, but legal ownership constraints and visible colors change.

At targets 1000 and 1300ms, event 1150ms:

| Target IDs in onset order | CURRENT colors | Right-owned midpoint colors |
| --- | --- | --- |
| a, z | green / red | red / green |
| z, a | red / green | red / green |

CURRENT chooses the identity-ordered tied claimant; renaming IDs can change which
notation target is green. This is deterministic, but no learner/product evidence
justifies lexicographic identity as intended ownership. A half-open coordinate rule
is more explicit, but choosing right instead of left is still a visible product
decision, not merely an internal diagnostic tie. Numerical probes at midpoint
plus/minus 1e-6ms freeze the research boundary convention without claiming hardware
measurement precision.

## Tempo scaling

The same four logical targets at relative beats 0,1,2,3 (translated by four beats)
are evaluated at 40/60/80/100/120/160/200/240 BPM. Offsets are 0, .2, .5 and .8 beats.
Target and event coordinates use PracticeTempoTimeline; local beat duration uses
its tempo and the existing beatsToMs primitive. No second product BPM conversion
or new timing constant is introduced.

For CURRENT, +.2 beat yields:

| BPM | Four target states | Claimants per event | First frontier latency ms | Local beats |
| --- | --- | --- | --- | --- |
| 40 | UNMATCHED / UNMATCHED / UNMATCHED / UNMATCHED | 0,0,0,0 | 250 | 0.1667 |
| 60 | MATCHED / MATCHED / MATCHED / MATCHED | 1,1,1,1 | 250 | 0.2500 |
| 80 | MATCHED / MATCHED / MATCHED / MATCHED | 1,1,1,1 | 250 | 0.3333 |
| 100 | MATCHED / MATCHED / MATCHED / MATCHED | 1,1,1,1 | 250 | 0.4167 |
| 120 | MATCHED / MATCHED / MATCHED / MATCHED | 1,1,1,1 | 750 | 1.5000 |
| 160 | MATCHED / MATCHED / MATCHED / MATCHED | 1,1,1,1 | 625 | 1.6667 |
| 200 | MATCHED / MATCHED / MATCHED / MATCHED | 2,2,2,1 | 550 | 1.8333 |
| 240 | MATCHED / MATCHED / MATCHED / MATCHED | 2,2,2,1 | 750 | 3.0000 |

Fixed-ms acceptance changes with tempo; cohort neighbors can also appear at the
inclusive 2W boundary, giving discontinuous decision latency as tempo changes.
For every beat-relative r, states/ownership/claimant counts in this constant-tempo
experiment are invariant under the scaling. That is characterization, not proof
that beat-invariance is the correct human tolerance model.

First-target latency for the same +.2-beat performance (milliseconds / local beats):

| Candidate | 40 BPM | 240 BPM |
| --- | --- | --- |
| CURRENT_FIXED_MS | 250 / 0.166667 | 750 / 3 |
| MIDPOINT_ONLY | 750 / 0.5 | 125 / 0.5 |
| CURRENT_WINDOW_MIDPOINT | 250 / 0.166667 | 125 / 0.5 |
| BEAT_RELATIVE_0.0625 | 93.75 / 0.0625 | 15.625 / 0.0625 |
| BEAT_RELATIVE_0.125 | 187.5 / 0.125 | 31.25 / 0.125 |
| BEAT_RELATIVE_0.25 | 375 / 0.25 | 62.5 / 0.25 |
| BEAT_RELATIVE_0.5 | 5250 / 3.5 | 875 / 3.5 |
| BEAT_RELATIVE_1 | 6000 / 4 | 1000 / 4 |
| GROUP_IOI_HALF_MIDPOINT | 750 / 0.5 | 125 / 0.5 |
| SAME_PITCH_IOI_HALF_MIDPOINT | 750 / 0.5 | 125 / 0.5 |

The beat .5 and 1 candidates use conservative connected-component closure; touching
overlapping windows can connect the whole four-target graph. These are safe offline
frontiers, not a claim of minimal possible streaming latency. The report retains
all eight BPMs and all four beat offsets for every candidate.

## Non-crossing proof and finite evidence

For t1 <= t2, o1 <= o2 and a **common radius R**, suppose crossing edges t1-o2 and
t2-o1 are legal. Then t1-R <= o1 <= o2 <= t1+R and
 t2-R <= o1 <= o2 <= t2+R imply both uncrossed edges are legal (use t1 <= t2 for the
outer inequalities). Absolute distance is Monge:

```text
|t1-o1| + |t2-o2| <= |t1-o2| + |t2-o1|
```

Uncrossing preserves matched vertices/cardinality and cannot increase cost.
Repeated inversion removal therefore gives a non-crossing maximum-cardinality,
minimum-cost optimum. This proof works for any common R; it does **not** select R.
It proves existence, not that production's identity-based tie chooses that optimum.

For non-crossing prefix solutions, ordered DP takes the best of skipping the last
target, skipping the last observation, or matching that pair when legal and extending
the smaller prefix. Compare cardinality first, cost second. These cases exhaust
non-crossing possibilities; the existence argument therefore establishes primary
objective equivalence. Its chronological tie rule remains a separate choice.

The independent enumerator explores every partial injective matching, including
unmatched vertices. On the six-coordinate grid, distinct targets and repeated-time
observations of size 0..3 give 3528 graphs: zero objective or non-crossing-existence
failures. Another 2000 fixed-seed small graphs have zero objective differences.
Ordered DP differs in exact ownership in 486 exhaustive and 52 generated graphs.
All 486 exhaustive generic crossing optima have the same primary objectives as an
ordered optimum; matched target sets in that finite grid do not differ. This finite
observation does not replace the separate visible midpoint-ID counterexample.

Example: targets [0,125], observations [125,125]. Generic pairs are (0,1),(1,0);
ordered pairs are (0,0),(1,1); both have cardinality 2, cost 125. The ordered DP's
chronological lexicographic tie is intentionally **not** presented as production tie
emulation. Replacing production matcher would require an explicit tie/product
contract decision even where primary objectives are equivalent.

Variable radii invalidate the legality step. Targets [1000,1250], observations
[1500,1750], radii [750,250] (one-beat radii at 80 and 240 BPM): only the crossing
solution can match both targets. The uncrossed second edge is illegal. Exhaustive
search found six non-crossing-existence failures among 495 variable-radius graphs;
2 targets plus 2 observations are the minimum number of vertices permitting a
crossing counterexample. The same failure is exercised by BEAT_RELATIVE_1; scaled counterexamples are
also tested for all five positive fractions.

All four midpoint-disjoint candidates pass 660 further exhaustive graphs with no
shared owner and no non-crossing-existence failure. Their proof is stronger than a
finite count: ordered disjoint cells forbid crossing legal edges. Each target can
independently choose its lowest-cost event; no bipartite ownership conflict remains.

Nearest-per-target greedy is not equivalent even under CURRENT: targets
[1000,1250], events [800,1100]. Nearest greedy consumes 1100 for the first target
and matches only one; optimum matches 800 then 1100, cardinality 2. This negative
control is retained uncorrected. Ordered DP solves common-radius primary objectives;
a generic augmenting-path implementation has no demonstrated mathematical necessity
for those objectives, but tested DP is not an exact deterministic drop-in.

## Decision frontiers are separate from analysis availability

- CURRENT records actual production directStrikeFrontier: latest direct same-pitch
  cohort onset + W, terminal-clamped; group frontier remains max child frontier.
  The 3W worst-case extension follows from direct neighbors within 2W, not an
  independent timing constant or proof that W is optimal.
- Midpoint-unique candidates use the right edge of eligibility intersected with
  ownership/scope. It is a safe worst-case closure for unmatched decisions and
  final minimum-error ownership. MATCHED target support may already be known
  earlier after accepted evidence; no theorem says every positive state must wait
  until that edge. Neighbor/cohort 3W waiting is unnecessary for disjoint cells,
  although an acceptance radius and source coverage are still needed.
- Overlapping variable-radius candidates close the entire connected interval
  component. This is a conservative offline reference and may wait through long
  chains; it is not a newly proposed production planner.
- Natural terminal clamps every required frontier to its Performance-Time terminal.
  Scope, first/last behavior and full input geometry are recorded. Resume count-in
  and pause change reached Session Time, not Performance-Time target/event geometry;
  the regression exercises the real clock and compares all candidates after mapping.
- No candidate folds pipeline delay or MIDI grace into its ownership formula.
  Session availability remains a separate established source/clock contract.

## Differences from the unchanged 10,003-case production characterization

Counts compare policy behavior, **not learner accuracy**. A case differs if a target
MATCHED/UNMATCHED state or event owner changes. Frontier/claimant differences are
counted separately; input generation and original report schema are untouched.
CURRENT is run through the real finalizer and reproduces the original outcomes.

| Candidate | Cases with assignment difference | Target-state differences | Event-owner differences | Ownership-claimant differences | Frontier differences |
| --- | --- | --- | --- | --- | --- |
| CURRENT_FIXED_MS | 0 | 0 | 0 | 0 | 0 |
| MIDPOINT_ONLY | 2464 | 6648 | 10328 | 14973 | 33201 |
| CURRENT_WINDOW_MIDPOINT | 1489 | 3258 | 6938 | 10381 | 16176 |
| BEAT_RELATIVE_0.0625 | 6918 | 27300 | 28226 | 30465 | 49004 |
| BEAT_RELATIVE_0.125 | 5252 | 19776 | 21722 | 25602 | 49004 |
| BEAT_RELATIVE_0.25 | 3169 | 10728 | 13372 | 18293 | 41268 |
| BEAT_RELATIVE_0.5 | 1975 | 5672 | 8557 | 14230 | 31927 |
| BEAT_RELATIVE_1 | 1643 | 4295 | 7049 | 17896 | 20507 |
| GROUP_IOI_HALF_MIDPOINT | 2819 | 9772 | 12702 | 17800 | 39210 |
| SAME_PITCH_IOI_HALF_MIDPOINT | 2647 | 7220 | 10606 | 16167 | 39035 |

Adversarial cases additionally cover long/isolated rests, first/final targets,
touching/overlapping/very fast repeats, two events between targets, missing-first /
missing-second, midpoint equality and either side, chords with one repeated member,
80-to-160 transition, variable-radius crossing, natural terminal clamp, and scope
beginning/ending mid-score. No production tests adopt a candidate expectation.

## Literature evidence and limits

These sources constrain hypotheses; they do not produce a NoteVerse threshold.
This was a focused source/abstract review, not a systematic review or learner study.

- [Repp (2005), Sensorimotor synchronization: a review of the tapping literature](https://pubmed.ncbi.nlm.nih.gov/16615317/),
  DOI 10.3758/BF03206433: reviews synchronization mechanisms and tapping evidence.
  Coordination with an external rhythm is a broader problem than target acceptance.
- [Repp and Su (2013), A review of recent research (2006–2012)](https://pubmed.ncbi.nlm.nih.gov/23397235/),
  DOI 10.3758/s13423-012-0371-2: extends evidence across tapping, movement and musical
  ensemble synchronization. It is not validation of a universal learner cutoff.
- [Repp (1994), Relational invariance across global tempo changes](https://pubmed.ncbi.nlm.nih.gov/8090862/),
  DOI 10.1007/BF00419657: two pianists and one composition showed roughly scaled
  large timing features alongside smaller details with different tempo dependence.
  Its limited design supports neither perfect scaling nor one universal fixed-ms rule.
- [Widmer and Goebl (2004), Computational Models of Expressive Music Performance](https://iwk.mdw.ac.at/goebl/papers/Widmer-Goebl_JNMR2004.pdf),
  DOI 10.1080/0929821042000317804: reviews multiple approaches to expressive tempo,
  timing and individual performance styles. [Cancino-Chacon et al. (2018)](https://www.frontiersin.org/journals/digital-humanities/articles/10.3389/fdigh.2018.00025/full)
  also discusses the distinction, and non-sharp boundary, between local tempo and
  expressive timing. This supports retaining both absolute and relational hypotheses.

Inference for this research: motor/perceptual musical timing can be tempo-sensitive
and tempo-flexible. Neither constant milliseconds nor constant beat fractions can
be declared the human optimum without the relevant evidence. No number from these
papers is promoted into code or product policy.

No external MIDI corpus was supplied or analyzed in this round. Existing local-only
corpus tooling characterizes performed density/spacing; without canonical score
alignment it cannot estimate candidate accuracy, intent, tolerance, false positives
or false negatives. No dataset was downloaded, committed or used to fit a tolerance.
Neither synthetic comparison nor corpus spacing measures physical input latency.

## Evidence levels and answers for the next independent production round

**PROVEN:** common-radius absolute-cost problems have a non-crossing optimum;
ordered disjoint cells remove claimant overlap and generic ownership competition;
group finality is max child frontier under the unchanged production contract.
Exhaustive search is finite regression evidence supporting the mathematical argument,
not itself a proof over all real coordinates.

**EMPIRICALLY CHARACTERIZED:** the exact baseline differences, tempo-scaling
outcomes, identity ties, greedy loss and pathological sparse cases above. They are
synthetic engineering evidence, not learner validation.

**UNRESOLVED PRODUCT PARAMETER:** W, beat fractions, half-IOI acceptance, midpoint
left/right choice, first/last scope behavior, exact tie fidelity and acceptable
feedback latency. Hardware/learner qualification and product decisions remain open.

**REJECTED CANDIDATE:** uncapped MIDPOINT_ONLY as a complete timing-acceptance rule,
because arbitrarily distant attacks are accepted. IOI-only locality is also not a
qualified acceptance replacement: large gaps and isolated fallback retain the same
pathology. Rejecting these complete rules does not reject midpoint ownership as a
separate hypothesis. No hybrid winner or replacement threshold is recommended.

A. Does +/-250ms have a structural proof? **No — it remains an algorithm-policy
parameter.** The common-radius theorem is true for any R, not specifically 250.

B. Can score geometry completely remove a timing parameter? **No.** It can define
ownership boundaries, but cannot by itself establish acceptable onset locality;
the long-gap/isolated controls demonstrate this distinction.

C. Is the generic matcher semantically necessary? Under current overlapping W,
overlap resolution and its primary objectives matter; ordered DP can solve those
objectives mathematically, but the tested tie behavior is not exactly equivalent.
Under midpoint-clipped W or the disjoint score-derived candidates, generic matching
is unnecessary once the changed ownership rule is accepted. Under varying beat
radii, non-crossing is not guaranteed, so this ordered DP cannot replace the general
solver. None of these results authorizes a production matcher/policy change now.
