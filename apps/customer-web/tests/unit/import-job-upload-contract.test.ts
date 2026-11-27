import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('import job upload contract', () => {
  it('submits and polls ImportJobs through generated operations', () => {
    const importJobsApi = readSource('src/features/imports/api/jobs.ts');
    const workflow = readSource('src/features/imports/submission/use-import-upload-workflow.ts');

    expect(importJobsApi).toContain('importJobsSubmit');
    expect(importJobsApi).toContain('importJobGet');
    expect(workflow).toContain('response?.job_id');
    expect(workflow).toContain('useImportJobDetail');
  });
});
