import type { ScoreArtifact } from '@/types/api';

export function firstRenderedPageArtifact(artifacts: ScoreArtifact[]) {
  return artifacts
    .filter((artifact) => artifact.kind === 'RENDERED_PAGE')
    .sort((left, right) => (left.page_number ?? 0) - (right.page_number ?? 0))[0] ?? null;
}

export function scoreThumbnailUrl(artifactId?: string | null) {
  return artifactId ? `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download` : null;
}

export function shareThumbnailUrl(token: string, artifacts: ScoreArtifact[]) {
  const artifact = firstRenderedPageArtifact(artifacts);
  return artifact
    ? `/api/v1/score-grants/${encodeURIComponent(token)}/artifacts/${encodeURIComponent(artifact.artifact_id)}/view`
    : null;
}

export function publicThumbnailUrl(slug: string, artifacts: ScoreArtifact[]) {
  const artifact = firstRenderedPageArtifact(artifacts);
  return artifact
    ? `/api/v1/publications/${encodeURIComponent(slug)}/artifacts/${encodeURIComponent(artifact.artifact_id)}/view`
    : null;
}
