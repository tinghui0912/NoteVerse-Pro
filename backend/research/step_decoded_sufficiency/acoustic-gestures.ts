// Research-only, score-blind decoded coherence. No target or truth imports.
export type DecodedObservation = Readonly<{
  observationId: string; pitch: string; eventMs: number; availabilityMs: number; confidence: number;
  sourceDomainId: string; sourceSampleRateHz: number; sourceEventSample: number;
}>;
export type DecodedPublication = Readonly<{
  publicationId: string; frontierMs: number; availabilityMs: number;
  observations: readonly DecodedObservation[];
}>;
export type DecodedGesture = Readonly<{
  eventMs: number; captureEndMs: number; observations: readonly DecodedObservation[];
}>;
export const DECODED_CHORD_COHERENCE_MS = 35;
export class DecodedGestureAssembler {
  private pending: DecodedObservation[] = [];
  private frontier = -Infinity;
  push(publication: DecodedPublication): readonly DecodedGesture[] {
    const late = publication.frontierMs < this.frontier;
    const input = [...(late ? [] : this.pending), ...publication.observations]
      .sort((a, b) => a.eventMs - b.eventMs || a.observationId.localeCompare(b.observationId));
    this.frontier = Math.max(this.frontier, publication.frontierMs);
    const groups: DecodedObservation[][] = [];
    for (const observation of input) {
      const last = groups.at(-1);
      if (last && observation.eventMs < last[0].eventMs + DECODED_CHORD_COHERENCE_MS) last.push(observation);
      else groups.push([observation]);
    }
    const complete = groups.filter(g => g[0].eventMs + DECODED_CHORD_COHERENCE_MS <= this.frontier);
    if (!late) this.pending = groups.filter(g => g[0].eventMs + DECODED_CHORD_COHERENCE_MS > this.frontier).flat();
    return complete.map(g => Object.freeze({ eventMs: g[0].eventMs,
      captureEndMs: g[0].eventMs + DECODED_CHORD_COHERENCE_MS, observations: Object.freeze(g) }));
  }
}
