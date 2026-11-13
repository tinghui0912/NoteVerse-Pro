import { renderAssetViewUrl } from '@/lib/api/native-resource-urls';

export function scoreThumbnailUrl(renderAssetId?: string | null) {
  return renderAssetId ? renderAssetViewUrl(renderAssetId) : null;
}
