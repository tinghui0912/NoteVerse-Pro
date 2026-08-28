import type {
  PracticeEvaluationProfile,
  PracticeSessionDetailRead,
} from '@/generated/practice-api';

export type PracticeSummaryArtifactKind =
  | 'learning-summary'
  | 'performance-summary'
  | 'section-summary';

export type PracticeSummaryArtifact = {
  kind: PracticeSummaryArtifactKind;
  scopeKind: 'full-piece' | 'selected-range';
  evaluationProfile: PracticeEvaluationProfile;
  titleKey: string;
  subtitleKey: string;
  completionLabelKey: string;
  accuracyLabelKey: string;
  coverageLabelKey: string;
  difficultMeasuresLabelKey: string;
  difficultMeasuresEmptyKey: string;
  recommendationsEmptyKey: string;
};

export function practiceSummaryArtifactForSession(
  session: PracticeSessionDetailRead | null
): PracticeSummaryArtifact {
  const evaluationProfile = session?.evaluation_profile ?? 'LEARNING';

  if (session?.practice_scope) {
    const isPerformanceSection = evaluationProfile === 'PERFORMANCE';
    return {
      kind: 'section-summary',
      scopeKind: 'selected-range',
      evaluationProfile,
      titleKey: 'sectionSummaryTitle',
      subtitleKey: 'sectionSummarySubtitle',
      completionLabelKey: isPerformanceSection ? 'performanceCompletion' : 'learningCompletion',
      accuracyLabelKey: isPerformanceSection ? 'performanceAccuracy' : 'learningAccuracy',
      coverageLabelKey: isPerformanceSection ? 'performanceCoverage' : 'learningCoverage',
      difficultMeasuresLabelKey: 'sectionMeasuresToReview',
      difficultMeasuresEmptyKey: 'sectionMeasuresEmpty',
      recommendationsEmptyKey: 'sectionRecommendationsEmpty',
    };
  }

  if (session?.progression_mode === 'CONTINUOUS') {
    return {
      kind: 'performance-summary',
      scopeKind: 'full-piece',
      evaluationProfile,
      titleKey: 'performanceSummaryTitle',
      subtitleKey: 'performanceSummarySubtitle',
      completionLabelKey: 'performanceCompletion',
      accuracyLabelKey: 'performanceAccuracy',
      coverageLabelKey: 'performanceCoverage',
      difficultMeasuresLabelKey: 'performanceProblemMeasures',
      difficultMeasuresEmptyKey: 'performanceProblemMeasuresEmpty',
      recommendationsEmptyKey: 'performanceRecommendationsEmpty',
    };
  }

  return {
    kind: 'learning-summary',
    scopeKind: 'full-piece',
    evaluationProfile,
    titleKey: 'learningSummaryTitle',
    subtitleKey: 'learningSummarySubtitle',
    completionLabelKey: 'learningCompletion',
    accuracyLabelKey: 'learningAccuracy',
    coverageLabelKey: 'learningCoverage',
    difficultMeasuresLabelKey: 'learningDifficultMeasures',
    difficultMeasuresEmptyKey: 'learningDifficultMeasuresEmpty',
    recommendationsEmptyKey: 'learningRecommendationsEmpty',
  };
}
