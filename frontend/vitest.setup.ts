import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8000/api/v1';
process.env.NEXT_PUBLIC_CSRF_COOKIE_NAME = 'noteverse_csrf';
process.env.NEXT_PUBLIC_CSRF_HEADER_NAME = 'x-csrf-token';
process.env.NEXT_BACKEND_ORIGIN = 'http://localhost:8000';

afterEach(() => {
  cleanup();
});
