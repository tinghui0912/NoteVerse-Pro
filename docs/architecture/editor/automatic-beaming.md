# Automatic Beaming

Automatic beaming is domain notation policy. `editor-domain/document-commands.ts`
recomputes beam relationships when a meter command changes the effective context.
`editor-musicxml` serializes those relationships; it does not run a separate XML
beaming algorithm.

## Grouping

The policy reads event positions, exact rhythmic lengths, effective meter and
explicit voice identity. Ordinary meters group by denominator beats. Compound
meters with an eighth-note denominator and a numerator divisible by three group
three eighths per beat. Events must be contiguous, pitched, beamable and wholly
inside the same group. Rests, gaps, longer notes and group boundaries terminate a
run. A chord advances musical time once.

The supported relationship model records primary beam groups. Explicit join and
break commands modify that same domain intent. Import rejects unsupported beam
levels and hooks instead of reducing their meaning to primary groups. Composite
and staff-specific meters require explicit adapter support and are rejected.

## Scope and preservation

A meter command affects the selected measure and following measures of the same
part until the next explicit meter change. Beam intent outside that scope remains
unchanged. Load, undo, redo and unrelated pitch/fingering/stem edits preserve
existing grouping. Voice deletion removes its events and touching relationships.
Unsafe source contexts fail explicitly.

## Validation

Domain grouping, command, session and source-preserving round-trip tests define the
current policy. Read-only MusicXML validation reports malformed beam levels and
closure at interchange boundaries. Rendered beam geometry belongs to Verovio.
