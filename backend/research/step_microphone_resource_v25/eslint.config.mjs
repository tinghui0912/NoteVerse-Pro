export default [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module',
  globals: { process: 'readonly', console: 'readonly' } }, rules: { 'no-unused-vars': 'error', 'no-undef': 'error' } }];
