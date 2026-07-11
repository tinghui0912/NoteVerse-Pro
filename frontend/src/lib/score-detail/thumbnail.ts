export function scoreThumbnailUrl(artifactId?: string | null) {
  return artifactId ? `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download` : null;
}

export function shareDerivedThumbnailUrl(token: string, artifactId?: string | null) {
  return artifactId
    ? `/api/v1/score-grants/${encodeURIComponent(token)}/artifacts/${encodeURIComponent(artifactId)}/view`
    : null;
}

export function publicDerivedThumbnailUrl(slug: string, artifactId?: string | null) {
  return artifactId
    ? `/api/v1/publications/${encodeURIComponent(slug)}/artifacts/${encodeURIComponent(artifactId)}/view`
    : null;
}
