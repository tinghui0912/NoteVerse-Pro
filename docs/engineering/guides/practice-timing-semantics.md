# Continuous Matching Evidence

## Current objective

The source-neutral same-key solver accepts pairs satisfying |event−target|<=W,
with W=250ms inclusive. Its objectives, in order, are maximum matched cardinality,
minimum total absolute error, and lexicographically earliest chronological
noncrossing pairs. Targets order by onset, canonical score order and identity;
events order by event time and identity. The product contract describes streaming
cohort finality separately from solving one cohort.

## Common-radius uncrossing proof

Let t1<=t2 and o1<=o2. Suppose crossing pairs(t1,o2) and(t2,o1) are legal under a
common radius R. From o1>=t2−R>=t1−R and o1<=o2<=t1+R, pair(t1,o1) is legal.
From o2>=o1>=t2−R and o2<=t1+R<=t2+R, pair(t2,o2) is legal. Absolute distance is
Monge:

```text
|t1−o1|+|t2−o2| <= |t1−o2|+|t2−o1|
```

Uncrossing preserves matched vertices/cardinality and cannot increase cost.
Repeated inversion removal produces a noncrossing maximum-cardinality/minimum-cost
optimum. The result holds for any common R; it does not determine the value250.
It is a mathematical argument about ordered coordinates and the common-radius
eligibility relation. Float64 boundary implementation is separately exercised by
numeric and predicate regressions, including large-coordinate endpoint cases.

## Dynamic programming and deterministic ties

A suffix state(i,j) chooses the best of skipping target i, skipping observation j,
or matching them when legal and extending(i+1,j+1). Compare cardinality first and
cost second. These cases exhaust noncrossing possibilities. The production solver
stores scalar suffix tables and reconstructs the earliest chronological pair that
preserves the optimum; it does not assign a weighted scalar score to the objectives.

Overlapping windows make ownership consequential. With targets1000/1250 and events
800/1100, taking the nearest observation for the first target can lose cardinality.
Both observations can be matched by the optimum. Equal-cost midpoint ownership is
a deterministic chronological product convention, not evidence of learner intent.

The proof is scoped to a solved same-key cohort. It does not assert equality between
streaming commits and arbitrary whole-session batch assignment. With different
radii per target, uncrossing legality need not hold; the common-radius premise is
essential to the current solver contract.

## Implementation evidence

The independent exhaustive oracle in
[same-key-matching.test.ts](../../../apps/customer-web/src/lib/practice/continuous/domain/evaluation/same-key-matching.test.ts)
enumerates partial injective matchings and checks production cardinality, cost and
chronological ownership. It covers3528 six-coordinate graphs of up to3 targets and
3 observations, plus2000 deterministic generated small graphs. Additional witnesses
cover equal-time observations, midpoint/ID order, inclusive±W, W+1, large coordinates,
input order, immutability and malformed identities. Finite enumeration supports the
implementation; the mathematical proof establishes the general relationship.

Two same-key radius-W windows overlap iff their onsets differ by at most2W. A direct
cohort's latest endpoint is therefore at most anchor+3W. Group frontier is max child
frontier; natural terminal clamps reached coordinates. These derived relationships
are not independent tolerance choices. Event/source time and publication availability
remain different coordinates, and pause/count-in operate through segmented clocks.

## Qualification limits

W250, delivery grace250, H35 and H50 have separate owners/purposes. Solver correctness
and current synthetic behavior do not establish optimal learner tolerance, physical
latency or a universal device claim. Fixed milliseconds express a different fraction
of a beat at different tempi; finite synthetic tests characterize that consequence.
Current [measurement tooling](practice-timing-research.md) supports further empirical
work without entering production dependencies or changing product policy.
