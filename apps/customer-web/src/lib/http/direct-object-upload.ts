import { ApiError } from './customer-browser-transport';

/** Signed storage targets are opaque capabilities, outside Customer session policy. */
export async function uploadMediaToSignedUrl(
  uploadUrl: string, method: string, headers: Record<string, string>, body: Blob | ArrayBuffer,
): Promise<void> {
  try {
    const target = new URL(uploadUrl);
    if (!['http:', 'https:'].includes(target.protocol)) throw new ApiError(0, 'direct_upload_failed');
    const response = await fetch(uploadUrl, { method, headers, body, credentials: 'omit' });
    if (!response.ok) throw new ApiError(response.status, 'direct_upload_failed');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'direct_upload_failed');
  }
}
