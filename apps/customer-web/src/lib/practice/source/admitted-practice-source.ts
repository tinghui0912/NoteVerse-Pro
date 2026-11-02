import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

/** Complete, immutable representation owned by one admitted browser flow. */
export type AdmittedPracticeSource = Readonly<{
  sourceId: string;
  artifact: PracticeScoreArtifact;
  musicXml: string;
}>;
