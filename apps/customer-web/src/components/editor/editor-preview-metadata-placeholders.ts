import type {ScoreDocument} from '@/lib/editor-domain';

export const SCORE_METADATA_PLACEHOLDER_SELECTOR = '[data-score-metadata-placeholder]';
export const SCORE_METADATA_PLACEHOLDER_CLASS = 'score-metadata-placeholder';

export type ScoreMetadataPlaceholderLabels = {
  notationTitle: string;
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
  document: ScoreDocument,
  labels: ScoreMetadataPlaceholderLabels
): ScoreMetadataPlaceholder[] {
  return [
    !document.metadata.notationTitle ? { className: 'score-metadata-placeholder-title', label: labels.notationTitle } : null,
    !document.metadata.subtitle ? { className: 'score-metadata-placeholder-subtitle', label: labels.subtitle } : null,
    !document.metadata.lyricist ? { className: 'score-metadata-placeholder-lyricist', label: labels.lyricist } : null,
    !document.metadata.composer ? { className: 'score-metadata-placeholder-composer', label: labels.composer } : null,
  ].filter((placeholder): placeholder is ScoreMetadataPlaceholder => Boolean(placeholder));
}

export function mountScoreMetadataPlaceholders(params: {
  container: Element;
  document: ScoreDocument | null;
  labels: ScoreMetadataPlaceholderLabels;
}): void {
  const { container, document, labels } = params;
  clearScoreMetadataPlaceholders(container);

  const page = container.querySelector<HTMLElement>('[data-score-page="1"]')
    ?? container.querySelector<HTMLElement>('[data-score-page]');
  if (!page || !document) return;

  getMissingScoreMetadataPlaceholders(document, labels).forEach((placeholder) => {
    const element = page.ownerDocument.createElement('button');
    element.type = 'button';
    element.dataset.scoreMetadataPlaceholder = 'true';
    element.className = `${SCORE_METADATA_PLACEHOLDER_CLASS} ${placeholder.className}`;
    element.textContent = placeholder.label;
    page.append(element);
  });
}
