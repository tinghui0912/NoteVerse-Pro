import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';

export type PracticeBundleBinding = Readonly<{
  scoreId: string;
  revisionId: string;
  bundleId: string;
}>;
/** One authorized revision binding and its complete immutable musical representation. */
export type AdmittedPracticeBundle = Readonly<{
  binding: PracticeBundleBinding;
  artifact: PracticeScoreArtifact;
  musicXml: string;
}>;
