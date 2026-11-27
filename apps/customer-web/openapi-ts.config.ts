import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../backend/docs/contracts/openapi/customer-api.json',
  output: 'src/generated/api',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/client-fetch',
    { name: '@hey-api/sdk', client: false, operations: 'flat', paramsStructure: 'grouped' },
  ],
});
