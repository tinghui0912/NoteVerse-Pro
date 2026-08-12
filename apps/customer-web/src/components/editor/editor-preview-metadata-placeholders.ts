import type { ScoreData } from '@/types/score-types';

export const SCORE_METADATA_PLACEHOLDER_SELECTOR = '[data-score-metadata-placeholder]';
export const SCORE_METADATA_PLACEHOLDER_CLASS = 'score-metadata-placeholder';

export type ScoreMetadataPlaceholderLabels = {
  mainTitle: string;
  subtitle: string;
  lyricist: string;
  composer: string;
};

type ScoreMetadataPlaceholder = {
  className: string;
  label: string;
};

export function clearScoreMetadataPlaceholders(container: Element): void {
  container
    .querySelectorAll(SCORE_METADATA_PLACEHOLDER_SELECTOR)
    .forEach((element) => element.remove());
}

export function getMissingScoreMetadataPlaceholders(
  scoreData: ScoreData,
  labels: ScoreMetadataPlaceholderLabels
): ScoreMetadataPlaceholder[] {
  return [
    !scoreData.mainTitle ? { className: 'score-metadata-placeholder-title', label: labels.mainTitle } : null,
    !scoreData.subtitle ? { className: 'score-metadata-placeholder-subtitle', label: labels.subtitle } : null,
    !scoreData.lyricist ? { className: 'score-metadata-placeholder-lyricist', label: labels.lyricist } : null,
    !scoreData.composer ? { className: 'score-metadata-placeholder-composer', label: labels.composer } : null,
  ].filter((placeholder): placeholder is ScoreMetadataPlaceholder => Boolean(placeholder));
}

export function mountScoreMetadataPlaceholders(params: {
  container: Element;
  scoreData: ScoreData | null;
  labels: ScoreMetadataPlaceholderLabels;
}): void {
  const { container, scoreData, labels } = params;
  clearScoreMetadataPlaceholders(container);

  const page = container.querySelector<HTMLElement>('[data-score-page="1"]')
    ?? container.querySelector<HTMLElement>('[data-score-page]');
  if (!page || !scoreData) return;

  getMissingScoreMetadataPlaceholders(scoreData, labels).forEach((placeholder) => {
    const element = page.ownerDocument.createElement('button');
    element.type = 'button';
    element.dataset.scoreMetadataPlaceholder = 'true';
    element.className = `${SCORE_METADATA_PLACEHOLDER_CLASS} ${placeholder.className}`;
    element.textContent = placeholder.label;
    page.append(element);
  });
}
