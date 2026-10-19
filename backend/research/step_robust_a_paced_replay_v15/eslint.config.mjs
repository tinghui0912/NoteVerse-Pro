export default [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module',
  globals: { process: 'readonly', console: 'readonly' } }, rules: {
  'no-undef': 'error', 'no-unused-vars': ['error', { args: 'after-used' }], 'no-unreachable': 'error',
  'no-constant-binary-expression': 'error', 'no-debugger': 'error', 'no-duplicate-imports': 'error', eqeqeq: 'error'
} }];
