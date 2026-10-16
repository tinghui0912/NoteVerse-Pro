# XC2 R2 Direct Conflict Reservation

Disposition: DIRECT_CONFLICT_RESERVATION_PARTIALLY_RECOVERS_SAFETY

POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION. NO_OPTIMAL_PROFILE_CLAIM.

R1 provenance: R1_EVIDENCE_PROVENANCE_RECONCILED_NO_SCIENTIFIC_CHANGE. Exact894813...bytes reconstructed; only four added report fields and one asset-verification link differ from committedfa03b6...state.

## Policy

w=250ms. Literal direct overlap |u-t|<=500ms gives strike coverage at mostt+750ms; no recursive cohort expansion.
Only the anchor commits. Future assignments and eligibility reservations are reversible, not semantic ownership.
WRONG never consumes an observation reserved for an uncommitted direct correct-match claimant. A group closes without unresolved reserved evidence instead of extending through its competitors competitors.
Group bound is max strike time+750ms (at most group start+770ms here). EXTRA bound is observation time+1000ms+group span (at most1020ms), not R1s520ms.

## Baseline Evaluation Recovery

| Fixed truth -> R1 | R1 cases | R2 recovered | Still incorrect |
|---|---:|---:|---:|
| MISSING_TO_WRONG | 9 | 9 | 0 |
| INCOMPLETE_CHORD_TO_WRONG | 4 | 4 | 0 |
| CORRECT_TO_INCOMPLETE_CHORD | 3 | 1 | 2 |
| CORRECT_TO_WRONG | 1 | 0 | 1 |
| CORRECT_TO_MISSING | 2 | 0 | 2 |

Counts track all R1 fixed-truth errors, including errors already present under original XC2. Full case receipts distinguish original-correct/R1-regressed cases from pre-existing acoustic errors.

## Correctness

| Split/config | Original agreement | R1 agreement | R2 agreement | New errors vs R1 | New errors vs original |
|---|---:|---:|---:|---:|---:|
| DEVELOPMENT/LINEAR_A_600_220 | 287/303 | 277/303 | 286/303 | 2 | 1 |
| EVALUATION/LINEAR_A_600_220 | 332/342 | 319/342 | 332/342 | 2 | 0 |
| DEVELOPMENT/BAND_LIMITED_A_600_170 | 286/303 | 277/303 | 285/303 | 2 | 1 |
| EVALUATION/BAND_LIMITED_A_600_170 | 330/342 | 317/342 | 330/342 | 2 | 0 |

Full JSON retains all three fixed-truth confusion matrices, raw counts/rates, every new regression and assignment disagreement, causal witnesses and per-class P50/P95/P99/max.

## Baseline Verdict Latency

| Class | Original P95 ms | R1 P95 ms | R2 P95 ms |
|---|---:|---:|---:|
| CORRECT | 4747.72 | 2055.03 | 2266.86 |
| MISSING | 27333.24 | 1568.59 | 1751.37 |
| WRONG | 27095.01 | 1544.90 | 1782.71 |
| INCOMPLETE_CHORD | 26747.65 | 1643.00 | 1791.96 |
| EXTRA | 1756.75 | 1734.64 | 1906.73 |

Class-conditional counts are retained. Product latency SLO is not frozen; these are logical replay finalization times, not new UI/runtime qualifications.

No neural inference or runtime sessions. No production ledger changes. Historical XC2 and R1 reports unchanged. F5/R4/9G-B remain unchanged, microphonefalse, noD4, no production winner. Commercial qualificationNOT_PERFORMED.
