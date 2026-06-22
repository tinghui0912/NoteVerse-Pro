import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('processing job upload contract', () => {
  it('submits and polls jobs without the retired task lifecycle endpoints', () => {
    const jobsApi = readSource('src/lib/api/jobs.ts');
    const tasksApi = readSource('src/lib/api/tasks.ts');
    const workflow = readSource('src/hooks/upload/use-upload-workflow.ts');

    expect(jobsApi).toContain("'/jobs'");
    expect(jobsApi).toContain('`/jobs/${jobId}`');
    expect(workflow).toContain('response.data?.job_id');
    expect(workflow).toContain('useJobDetail');
    expect(tasksApi).not.toContain('/tasks/submit-batch');
    expect(tasksApi).not.toContain('/tasks/status/batch');
  });
});
