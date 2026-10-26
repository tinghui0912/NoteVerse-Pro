export type ContinuousObservation = Readonly<{
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'MIDI' | 'ACOUSTIC';
  provenance?: Readonly<{
    sourceDomainId: string;
    sourceSampleRateHz: number;
    sourceEventSample: number;
  }>;
}>;

export type ContinuousEvidencePublication = Readonly<{
  publicationId: string;
  sessionDomainId: string;
  analyzedThroughPerformanceMs: number;
  /** When this evidence/coverage became known, in the publication's session domain. */
  availabilitySessionTimeMs: number;
  observations: readonly ContinuousObservation[];
}>;
