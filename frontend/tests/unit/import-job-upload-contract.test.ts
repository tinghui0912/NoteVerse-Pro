import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('import job upload contract', () => {
  it('submits and polls import jobs without the retired task lifecycle endpoints', () => {
    const importJobsApi = readSource('src/lib/api/import-jobs.ts');
    const workflow = readSource('src/hooks/upload/use-upload-workflow.ts');

    expect(importJobsApi).toContain("'/import-jobs'");
    expect(importJobsApi).toContain('`/import-jobs/${jobId}`');
    expect(workflow).toContain('response.data?.job_id');
    expect(workflow).toContain('useImportJobDetail');
    expect(importJobsApi).not.toContain('/tasks/');
  });
});
