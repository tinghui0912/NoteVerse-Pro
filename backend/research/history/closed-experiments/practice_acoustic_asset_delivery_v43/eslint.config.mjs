export default [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', window: 'readonly', navigator: 'readonly',
  fetch: 'readonly', AbortSignal: 'readonly', globalThis: 'readonly', FileSystemDirectoryHandle: 'readonly',
  FileSystemFileHandle: 'readonly', FileSystemWritableFileStream: 'readonly', SubtleCrypto: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', location: 'readonly', Request: 'readonly', performance: 'readonly',
  Blob: 'readonly', crypto: 'readonly'
} }, rules: { 'no-unused-vars': 'error', 'no-undef': 'error' } }];
