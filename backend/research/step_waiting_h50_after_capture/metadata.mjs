const pitches = group => [...new Set(group.notes.map(n => n.pitch))].sort((a, b) => a - b);
const sameSet = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Audits the already frozen occurrence, never searches for a replacement. */
export function fixedRapidPair(first, second) {
  if (!first || !second) return null;
  const firstPitches = pitches(first), secondPitches = pitches(second);
  const sharedPitches = firstPitches.filter(p => secondPitches.includes(p));
  const gapSeconds = second.time - first.time;
  return {firstTime: first.time, secondTime: second.time, gapSeconds, firstPitches, secondPitches, sharedPitches,
    exactRepeatedChord: firstPitches.length > 1 && sameSet(firstPitches, secondPitches),
    eligibleRapidSamePitchOrChord: gapSeconds >= .2 && gapSeconds <= .25 && sharedPitches.length > 0};
}

export function selectedOccurrenceAudit(c) {
  const selected = c.selected.physical;
  const occurrence = group => group ? {
    time: group.time,
    pitches: pitches(group),
    samePitchGaps: group.notes.map(note => {
      const prior = c.truth.flatMap(g => g.notes).filter(n => n.pitch === note.pitch && n.time < note.time)
        .sort((a, b) => b.time - a.time)[0];
      return {pitch: note.pitch, time: note.time, priorTime: prior?.time ?? null,
        gapSeconds: prior ? note.time - prior.time : null};
    })
  } : null;
  const intended = occurrence(selected), second = occurrence(c.selected.secondPhysical);
  return {id: c.id, topology: c.topology, recordingId: c.source.recordingId,
    audioSha256: c.source.audioSha256, midiSha256: c.source.midiSha256, intended, second,
    selectedPair: fixedRapidPair(selected, c.selected.secondPhysical),
    intendedContainsRapidSamePitch: [intended, second].some(g => g?.samePitchGaps.some(n => n.gapSeconds !== null && n.gapSeconds >= .2 && n.gapSeconds <= .25))};
}

/** Counterevidence to a stronger, incorrect claim that the entire slices lack rapid repeats. */
export function otherRapidEvents(c) {
  const previous = new Map(), results = [];
  for (const group of c.truth) for (const note of group.notes) {
    const prior = previous.get(note.pitch);
    if (prior !== undefined && note.time - prior >= .2 && note.time - prior <= .25) {
      results.push({id: c.id, pitch: note.pitch, priorTime: prior, time: note.time, gapSeconds: note.time - prior,
        selectedIntendedOccurrence: group.time === c.intendedTime});
    }
    previous.set(note.pitch, note.time);
  }
  return results;
}
