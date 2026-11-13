import { accountStorageUsageGet } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';


export const storageUsageApi = {
  current: (signal?: AbortSignal) =>
    responseData(accountStorageUsageGet({ ...customerTransport.authenticated, signal })),
};
