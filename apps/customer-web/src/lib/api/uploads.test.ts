import { uploadSession } from '@/lib/upload/upload-session-client';
import { uploadSessionFixture } from '../../../tests/helpers/upload-session';
vi.mock('@/lib/upload/upload-session-client', () => ({uploadSession: vi.fn()}));
import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../../../tests/helpers/customer-http';
import { uploadsApi } from './uploads';
import { importJobsApi } from '@/features/imports/api/jobs';

afterEach(async () => { const {vi} = await import('vitest'); vi.unstubAllGlobals(); });
it('admits JSON metadata, transfers by session and finalizes the business resource', async () => {
  const upload = { upload_id: 'upload-uuid', original_filename: 'original.png', byte_size: 5 };
  const send = customerFetch({upload_session:uploadSessionFixture()});
  send.mockResolvedValueOnce(Response.json({upload_session:uploadSessionFixture()})).mockResolvedValueOnce(Response.json(upload));
  const file = new File(['image'], 'original.png', {type:'image/png'});
  expect(await uploadsApi.createUpload(file,'request-1')).toEqual(upload);
  const request=send.mock.calls[0][0] as Request;
  expect(new URL(request.url).pathname).toBe('/api/v1/uploads');
  expect(request.headers.get('Content-Type')).toBe('application/json');
  expect(await request.json()).toEqual({client_request_id:'request-1',filename:'original.png',byte_size:5,content_type:'image/png'});
  expect(uploadSession).toHaveBeenCalledWith('session-1',file,expect.objectContaining({cancel:expect.any(Function)}));
  expect(new URL((send.mock.calls[1][0] as Request).url).pathname).toBe('/api/v1/uploads/session-1/finalize');
});
it('returns a committed request replay without transferring again', async () => {
  vi.mocked(uploadSession).mockClear();
  const upload={upload_id:'committed'};
  const send=customerFetch({upload});
  expect(await uploadsApi.createUpload(new File(['x'],'a.png'),'same')).toEqual(upload);
  expect(send).toHaveBeenCalledOnce();
  expect(uploadSession).not.toHaveBeenCalled();
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
