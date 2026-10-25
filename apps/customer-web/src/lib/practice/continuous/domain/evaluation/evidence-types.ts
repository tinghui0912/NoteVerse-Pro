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
  availabilityTimeMs: number;
  observations: readonly ContinuousObservation[];
}>;
