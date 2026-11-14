import { accountStorageUsageGet } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';


export const storageUsageApi = {
  current: (signal?: AbortSignal) =>
    responseBody(accountStorageUsageGet({ ...customerTransport.authenticated, signal })),
};
