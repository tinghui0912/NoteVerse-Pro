import type { ScoreArtifact } from '@/types/api';

export function scoreDownloadAvailability(artifacts: ScoreArtifact[]) {
  const renderedPages = artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE');
  const musicXml = artifacts.find((artifact) => artifact.kind === 'MUSICXML') ?? null;

  return {
    renderedPages,
    musicXml,
    imageCount: renderedPages.length,
    canDownloadImage: renderedPages.length > 0,
    canDownloadXml: musicXml !== null,
  };
}
