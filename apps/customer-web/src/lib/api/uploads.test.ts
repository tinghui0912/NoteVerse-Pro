import { afterEach, expect, it } from 'vitest';
import { customerFetch } from '../../../tests/helpers/customer-http';
import { uploadsApi } from './uploads';
import { importJobsApi } from '@/features/imports/api/jobs';

afterEach(async () => { const {vi} = await import('vitest'); vi.unstubAllGlobals(); });
it('creates an Upload through the generated multipart collection operation', async () => {
  const upload = { upload_id: 'upload-uuid', original_filename: 'original.png', byte_size: 5 };
  const send = customerFetch(upload);
  const file = new File(['image'], 'original.png', {type: 'image/png'});
  expect(await uploadsApi.createUpload(file)).toEqual(upload);
  const request = send.mock.calls[0][0] as Request;
  expect(new URL(request.url).pathname).toBe('/api/v1/uploads');
  expect(request.method).toBe('POST');
  const body = await request.formData();
  const uploaded = body.get('file') as File;
  expect(uploaded.name).toBe('original.png');
  expect(await uploaded.text()).toBe('image');
});
it('deletes by public Upload identity through the generated operation', async () => {
  const send = customerFetch();
  await uploadsApi.deleteUpload('upload-uuid');
  const request = send.mock.calls[0][0] as Request;
  expect(request.method).toBe('DELETE');
  expect(new URL(request.url).pathname).toBe('/api/v1/uploads/upload-uuid');
});
it('submits ordered Upload identities through the generated Import request', async () => {
  const send = customerFetch();
  await importJobsApi.submitImportJob(['upload-b', 'upload-a'], {}, 'stable-request');
  expect(await (send.mock.calls[0][0] as Request).json()).toEqual({upload_ids: ['upload-b', 'upload-a'], options: {}, idempotency_key: 'stable-request'});
});
