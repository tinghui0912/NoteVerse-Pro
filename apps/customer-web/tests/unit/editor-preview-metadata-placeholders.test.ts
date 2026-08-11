// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  SCORE_METADATA_PLACEHOLDER_CLASS,
  SCORE_METADATA_PLACEHOLDER_SELECTOR,
  clearScoreMetadataPlaceholders,
  getMissingScoreMetadataPlaceholders,
  mountScoreMetadataPlaceholders,
} from '@/components/editor/editor-preview-metadata-placeholders';
import type { ScoreData } from '@/types/score-types';

const labels = {
  mainTitle: 'Title',
  subtitle: 'Subtitle',
  lyricist: 'Lyricist',
  composer: 'Composer',
};

function createScoreData(overrides: Partial<ScoreData> = {}): ScoreData {
  return {
    measures: [],
    ...overrides,
  };
}

function createContainer() {
  const container = document.createElement('div');
  container.innerHTML = `
    <section data-score-page="1">
      <button data-score-metadata-placeholder="true" class="${SCORE_METADATA_PLACEHOLDER_CLASS} stale">Stale</button>
    </section>
  `;
  return container;
}

describe('editor preview metadata placeholders', () => {
  it('projects missing score metadata fields to placeholder descriptors', () => {
    expect(getMissingScoreMetadataPlaceholders(createScoreData({ mainTitle: 'Sonata' }), labels)).toEqual([
      { className: 'score-metadata-placeholder-subtitle', label: 'Subtitle' },
      { className: 'score-metadata-placeholder-lyricist', label: 'Lyricist' },
      { className: 'score-metadata-placeholder-composer', label: 'Composer' },
    ]);
  });

  it('clears existing placeholders', () => {
    const container = createContainer();

    clearScoreMetadataPlaceholders(container);

    expect(container.querySelectorAll(SCORE_METADATA_PLACEHOLDER_SELECTOR)).toHaveLength(0);
  });

  it('mounts placeholder buttons on the first score page', () => {
    const container = createContainer();

    mountScoreMetadataPlaceholders({
      container,
      scoreData: createScoreData({ mainTitle: 'Sonata', composer: 'Composer Name' }),
      labels,
    });

    const placeholders = Array.from(container.querySelectorAll<HTMLButtonElement>(SCORE_METADATA_PLACEHOLDER_SELECTOR));
    expect(placeholders.map((placeholder) => placeholder.textContent)).toEqual(['Subtitle', 'Lyricist']);
    expect(placeholders.map((placeholder) => placeholder.type)).toEqual(['button', 'button']);
    expect(placeholders.map((placeholder) => placeholder.className)).toEqual([
      'score-metadata-placeholder score-metadata-placeholder-subtitle',
      'score-metadata-placeholder score-metadata-placeholder-lyricist',
    ]);
  });

  it('does not mount placeholders when all score metadata is present', () => {
    const container = createContainer();

    mountScoreMetadataPlaceholders({
      container,
      scoreData: createScoreData({
        mainTitle: 'Sonata',
        subtitle: 'Op. 1',
        lyricist: 'Poet',
        composer: 'Composer',
      }),
      labels,
    });

    expect(container.querySelectorAll(SCORE_METADATA_PLACEHOLDER_SELECTOR)).toHaveLength(0);
  });

  it('clears stale placeholders when score data or score pages are unavailable', () => {
    const withoutScoreData = createContainer();
    mountScoreMetadataPlaceholders({
      container: withoutScoreData,
      scoreData: null,
      labels,
    });
    expect(withoutScoreData.querySelectorAll(SCORE_METADATA_PLACEHOLDER_SELECTOR)).toHaveLength(0);

    const withoutPage = document.createElement('div');
    withoutPage.innerHTML = `<button data-score-metadata-placeholder="true">Stale</button>`;
    mountScoreMetadataPlaceholders({
      container: withoutPage,
      scoreData: createScoreData(),
      labels,
    });
    expect(withoutPage.querySelectorAll(SCORE_METADATA_PLACEHOLDER_SELECTOR)).toHaveLength(0);
  });
});
