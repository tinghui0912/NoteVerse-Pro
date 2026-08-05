export function scoreThumbnailUrl(renderAssetId?: string | null) {
  return renderAssetId ? `/api/v1/render-assets/${encodeURIComponent(renderAssetId)}/download` : null;
}

export function shareDerivedThumbnailUrl(token: string, renderAssetId?: string | null) {
  return renderAssetId
    ? `/api/v1/score-grants/${encodeURIComponent(token)}/render-assets/${encodeURIComponent(renderAssetId)}/view`
    : null;
}

export function publicDerivedThumbnailUrl(slug: string, renderAssetId?: string | null) {
  return renderAssetId
    ? `/api/v1/publications/${encodeURIComponent(slug)}/render-assets/${encodeURIComponent(renderAssetId)}/view`
    : null;
}
