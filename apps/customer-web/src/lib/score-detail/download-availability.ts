import type { ScoreRevisionAssets } from '@/types/api';

export function scoreDownloadAvailability(assets: ScoreRevisionAssets) {
  const renderedPages = assets.render_assets.filter((asset) => asset.kind === 'RENDERED_PAGE');
  const musicXml = assets.revision_sources.find((source) => source.format === 'MUSICXML') ?? null;

  return {
    renderedPages,
    musicXml,
    imageCount: renderedPages.length,
    canDownloadImage: renderedPages.length > 0,
    canDownloadXml: musicXml !== null,
  };
}
