import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

process.env.NEXT_BACKEND_ORIGIN = 'http://localhost:8000';

afterEach(() => {
  cleanup();
});
