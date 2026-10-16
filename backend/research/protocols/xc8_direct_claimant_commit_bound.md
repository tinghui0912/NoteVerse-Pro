# XC8: Literal Direct Claimant Commit Reservation

This derivation precedes candidate implementation and replay. w=250ms is the
unchanged assignment/WRONG association window. Groups retain the frozen XC2
maximum20ms spread contract; this is not a new swept tolerance. Let a=min group
strike time, b=max group strike time and delta=b-a.

Expected strike t accepts observation o only when |o-t|<=w. Its unchanged R2
literal one-hop same-pitch cohort is C(t)={u:|u-t|<=2w}. Its strike commit
frontier H(t)=max(u+w:u in C(t))<=t+3w. It depends on cohort members' LOCAL
window ends, never H(u), their commit status or graph connectivity.

A local incompatible observation for group g has o in[a-w,a+w]. Its literal
correct claimants D(o)={s:s.pitch=o.pitch,|s-o|<=w} satisfy s<=a+2w. Waiting
for each such strike's OWN fixed commit H(s) therefore requires at most a+5w.
Do not wait for any member of C(s) to commit, for its group to finalize, for
H(u) at u in C(s), or for any unrelated group. H(s) is the precomputed fixed
one-hop window-coverage formula, not a recursive invocation of group policy.

G(g)=max(b+w, max H(t) for own strikes, max H(s) for literal correct claimants
of local incompatible observations). Hence G(g)<=max(b+3w,a+5w), or relative
to a, max(delta+3w,5w). With delta<=20ms, G(g)<=a+1250ms. The local pool is
complete once a+w is covered. Already consumed local observations remain in
the horizon calculation, preserving stable coverage witnesses, as in R2.

For residual observation o, direct correct s<=o+w implies H(s)<=o+4w.
A directly legal WRONG group has a<=o+w, so G(g)<=o+max(delta+4w,6w).
E(o)=max(o,direct correct H,direct WRONG group G)<=o+1500ms at delta<=20ms.
This is a fixed composition of literal interval queries, not recursive cohort
expansion or a transitive component. The number/length of later score events
cannot increase these bounds. Dense chains are explicitly tested.

All eligible strike commitments run first in unchanged R2 time/ID order. At
G(g), every literal correct claimant has had its own H covered and thus has
committed. Consumed evidence stays consumed; released evidence is eligible for
deterministic max-cardinality/min-absolute-error WRONG assignment across ready
groups. An unresolved direct claimant at a claimed covered G is an error, not
a reason to finalize without evidence or extend a horizon. Provisional
reservations never confer semantic ownership.

Terminal completion explicitly clamps frontiers, retains unclamped witnesses,
and resolves all reservations. Manual unmatched strikes whose local window
was not reached stay NOT_REACHED. A terminal clamp is not unobserved future
acoustic coverage. Logical availability also includes the delay until the next
frozen acoustic publication; these frontier bounds are not wall-clock latency
SLOs and cannot guarantee against a stalled publisher.

The causal audit supports this mechanism in background R2 EVALUATION verdicts,
but NOT as the explanation of every named target regression. In particular,
competing WRONG owners and correctly MATCHED observations cannot be repaired
by assigning an observation twice. No additional policy or threshold is tested.
