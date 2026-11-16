/** Object-storage failures are separate from Customer application error responses. */
class DirectUploadError extends Error {
  readonly code = 'direct_upload_failed';

  constructor(readonly status: number) {
    super('Direct object upload failed');
    this.name = 'DirectUploadError';
  }
}

/** Signed storage targets are opaque capabilities, outside Customer session policy. */
export async function uploadMediaToSignedUrl(
  uploadUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Blob | ArrayBuffer,
): Promise<void> {
  try {
    const target = new URL(uploadUrl);
    if (!['http:', 'https:'].includes(target.protocol)) throw new DirectUploadError(0);
    const response = await fetch(uploadUrl, { method, headers, body, credentials: 'omit' });
    if (!response.ok) throw new DirectUploadError(response.status);
  } catch (error) {
    if (error instanceof DirectUploadError) throw error;
    throw new DirectUploadError(0);
  }
}
