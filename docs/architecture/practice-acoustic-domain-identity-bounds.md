# Acoustic Domain Identity Admission

## Contract and defensive boundaries

isAcousticDomainIdentity in the selected source-publication.ts owns the primitive
string predicate Boolean(value) && value.length<=192. Length counts UTF-16 code
units. Identity strings are opaque: no trimming, normalization, byte budget or
reserved-delimiter grammar applies. The TypeScript contract declares primitive
strings; arbitrary JavaScript values outside it are not covered by this predicate.

| Independently callable boundary | Field | Position and failure owner |
| --- | --- | --- |
| SourceAnalysisRuntime.create | sourceDomainId | After exact option fields, before construction; INVALID_ACOUSTIC_DOMAIN |
| ContinuousAcousticProjection.create | sessionDomainId | After exact option fields, before source factory; INVALID_ACOUSTIC_DOMAIN |
| StepAcousticAttemptAssembler constructor | sourceDomainId | Before local-session/mapping checks; STEP_ACOUSTIC_SOURCE_MAPPING_INVALID |
| StepMicrophoneInput.setup | sourceDomainId | After abort/context/rate/local-session checks, before inference/FIR/capture; STEP_MICROPHONE_CONNECTION_INVALID |

Nested checks defend direct calls even when a product caller already validated the
same source ID. Continuous projection's session field and source runtime's source
field are distinct identities. Continuous input obtains inference/FIR resources
before projection admission; rejected connection follows its disposal path. STEP
setup can reject the source field before those acquisitions.

Empty IDs reject; length1 and192 accept; length193 rejects.96 emoji have192 code
units and accept, while97 exceed the budget. A192-unit non-ASCII string accepts
regardless of larger UTF-8 encoding. Whitespace, colons, Unicode, NUL and newline
are accepted opaque values. Publication consumers compare equality and construct
expected IDs; they do not reverse-parse these delimiters into semantic fields.

## Generated identity paths

createLocalSessionId(prefix) returns <prefix>:<random>. Continuous uses the default
local-practice prefix (14 units); STEP uses step (4 units). The generator accepts
arbitrary prefixes. Native crypto.randomUUID yields36 characters. Fallback uses
<prefix>:<Date.now()>-<Math.random()> without fixed decimal padding.

For prefix length P, timestamp string length T and random string length R:

| Generator | Session length | Source length with :capture |
| --- | --- | --- |
| Native UUID | P+37 | P+45 |
| Fallback | P+2+T+R | P+10+T+R |
| Fallback conservative native bound | At most P+43 | At most P+51 |

A native integral Date string takes at most17 characters including sign; the
shortest binary64 decimal representation of nonnegative Math.random below1 takes
at most24. These conditional generator bounds do not bound arbitrary prefixes or
replacement providers. UUID-generated product lengths are51/59 for Continuous and
41/49 for STEP. Generated length does not derive the direct-call budget192.

Continuous controller/session timebase → microphone connection sessionDomainId →
sourceDomainId=sessionDomainId+:capture → projection/session gate → source runtime
source gate → sequence/observations → Continuous projection and evidence store.

STEP controller localSessionId → localSessionId+:capture → StepMicrophoneInput setup
→ source runtime → assembler/sequence → numeric StepPianoKeyEvidence → source-neutral
STEP domain completion. Timebase/attempt ownership retains the local session ID.

Suffix composition permits session184/source192 and rejects session185/source193 at
the source-runtime gate. Direct projection session192/source192 accepts.184 is an
arithmetic consequence of the suffix, not a policy constant. The source cap does
not independently impose a192 cap on every local-session field.

## Payload amplification

For source-domain length D, sourceObservationId is
<D>:r<region>:w<window>:p<pitch>:f<target>. Accepted safe integer coordinates and piano
MIDI range give at most59 suffix characters. A source publication with N observations
has one header domain and two domain-bearing fields per observation (domain and
prefixed ID):2N+1 fields. This describes string content, not allocated heap bytes.

Continuous projection with M retained observations has2M+1 source-prefix fields and
one session field; terminal publication has <D>:terminal plus its session identity.
The immutable evidence store clones publications, retains IDs as Map keys and
receipts, and builds indexing/header identities. Result7 retains accepted observation
IDs/provenance in its flat/nested assignment projection. Configured stack provenance
itself does not include source/session IDs.

The STEP H50 Map retains observation IDs and frozen observation copies; a sealed
header plus K observations has2K+1 domain-bearing fields and additional key references.
Shared STEP evidence contains numeric keys, confidence and capture-end Session Time,
rather than the source observation payload. Diagnostic/snapshot arrays have their
own bounded retention and can also carry source-domain strings.

N is bounded upstream by maxEventsPerWindow=183×88=16104. H50/window topology bounds
an active gesture to two accepted publications. Session totals depend on their own
retention rules. Strings can share references or rope storage; shallow copies do
not prove deep copies, and object/hash/serialization costs require measurement.

## Qualification

192 is an UNQUALIFIED_RESOURCE_SAFETY_POLICY budget. Long direct IDs amplify retained
content, hashing, comparisons and serialized payload work, so short generated product
IDs alone do not justify removing direct-call defense. The current predicate has
one selected-source owner and four defensive error owners. Neither semantic namespace
uniqueness nor universal device/browser memory headroom follows from length admission.
Workload and representation measurements are needed to qualify or change the budget.
