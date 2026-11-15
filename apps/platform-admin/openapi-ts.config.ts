import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../backend/docs/contracts/openapi/control-plane-api.json',
  output: 'generated/api',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/schemas',
    '@hey-api/client-fetch',
    { name: '@hey-api/sdk', client: false, operations: 'flat', paramsStructure: 'grouped' },
  ],
});
