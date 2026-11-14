import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const source = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');
describe('Save lifecycle ownership', () => {
  it('keeps protocol sequencing in an application command and query integration in the hook', () => {
    const hook = source('hooks/queries/use-performance-take-queries.ts');
    const command = source('lib/practice/saved-take/save-command.ts');
    expect(hook).toContain('new PerformanceTakeSaveCommand(input,');
    expect(hook).toContain('command.execute()');
    for (const method of ['reserveUpload(', 'finalizeTake(', 'uploadMediaToSignedUrl(', 'cancelUploadReservation(']) expect(hook).not.toContain(method);
    expect(command).toContain('this.transport.reserveUpload(');
    expect(command).toContain('this.transport.finalizeTake(');
    expect(command).toContain('.retain()');
    expect(command).toContain('releaseLocalMediaAsset(');
    expect(command).not.toContain('queryClient');
    expect(command).not.toContain('@tanstack/react-query');
  });
});
