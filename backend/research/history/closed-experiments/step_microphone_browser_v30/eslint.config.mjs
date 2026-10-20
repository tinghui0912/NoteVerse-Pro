export default [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', window: 'readonly', navigator: 'readonly',
  fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly'
} }, rules: { 'no-unused-vars': 'error', 'no-undef': 'error' } }];
