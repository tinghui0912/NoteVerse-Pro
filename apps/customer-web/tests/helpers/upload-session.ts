import type { UploadSessionRead } from '@/generated/api';
export function uploadSessionFixture(
  overrides: Partial<UploadSessionRead> = {},
): UploadSessionRead {
  return {
    session_id: 'session-1',
    mode: 'SINGLE_PUT',
    status: 'UPLOADING',
    expected_byte_size: 12,
    expected_content_type: 'audio/wav',
    expires_at: '2099-01-01T00:00:00Z',
    part_size: 16 * 1024 ** 2,
    part_count: 1,
    recommended_concurrency: 3,
    upload_target: {
      url: 'https://objects.example/upload',
      method: 'PUT',
      headers: { 'content-type': 'audio/wav', 'content-length': '12' },
      expires_in: 900,
    },
    ...overrides,
  };
}
