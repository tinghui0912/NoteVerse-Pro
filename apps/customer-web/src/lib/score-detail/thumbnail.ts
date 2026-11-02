export function scoreThumbnailUrl(renderAssetId?: string | null) {
  return renderAssetId ? `/api/v1/render-assets/${encodeURIComponent(renderAssetId)}/download` : null;
}
