import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../backend/docs/contracts/openapi/practice-api.json',
  output: 'src/generated/practice-api',
  plugins: ['@hey-api/typescript'],
});
