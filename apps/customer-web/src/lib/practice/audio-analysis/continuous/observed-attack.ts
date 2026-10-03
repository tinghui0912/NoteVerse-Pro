export type ObservedAttack = {
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
};
