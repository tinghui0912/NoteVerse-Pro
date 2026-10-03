export type ObservedAttack = {
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
};

export function stitchObservedAttacks(input: {
  previous: readonly ObservedAttack[];
  incoming: readonly ObservedAttack[];
  duplicateWindowMs: number;
}): ObservedAttack[] {
  if (input.duplicateWindowMs < 0) {
    throw new Error('Duplicate window must be non-negative.');
  }
  const output = [...input.previous];
  for (const attack of input.incoming) {
    const duplicateIndex = output.findIndex((candidate) =>
      candidate.pitch === attack.pitch
      && Math.abs(candidate.performanceTimeMs - attack.performanceTimeMs) <= input.duplicateWindowMs
    );
    if (duplicateIndex >= 0) {
      if (attack.confidence > output[duplicateIndex].confidence) {
        output[duplicateIndex] = attack;
      }
      continue;
    }
    output.push(attack);
  }
  return output.sort((left, right) => left.performanceTimeMs - right.performanceTimeMs);
}
