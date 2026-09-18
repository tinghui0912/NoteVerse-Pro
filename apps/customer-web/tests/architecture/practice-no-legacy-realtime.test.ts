import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"].*practice\/protocol['"]/,
  /from\s+['"].*practice\/session-policy['"]/,
  /from\s+['"].*use-practice-socket['"]/,
  /from\s+['"].*use-practice-session['"]/,
  /from\s+['"].*use-practice-audio-stream['"]/,
  /from\s+['"].*use-practice-midi-stream['"]/,
  /from\s+['"].*use-practice-targets['"]/,
  /from\s+['"].*practice\/audio-stream['"]/,
  /from\s+['"].*follow-controller['"]/,
  /practice-pcm-processor\.js/,
];

function getSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !fullPath.includes('tests/architecture')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architecture Guard: No Legacy Practice Realtime Files or Imports', () => {
  const srcDir = resolve(__dirname, '../../src');
  const allFiles = getSourceFiles(srcDir);

  it('ensures no customer-web source files import legacy realtime practice modules', () => {
    const violations: { file: string; pattern: string; line: string }[] = [];

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: file.replace(srcDir, 'src'),
              pattern: pattern.toString(),
              line: line.trim(),
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ensures practice page uses browser-local practice architecture', () => {
    const practicePageFile = join(srcDir, 'app/[locale]/(workspace)/score/[id]/practice/page.tsx');
    const content = readFileSync(practicePageFile, 'utf-8');

    expect(content).toContain('useLocalPractice');
    expect(content).toContain('usePracticeScoreArtifact');
    expect(content).not.toContain('usePracticeSocket');
    expect(content).not.toContain('usePracticeSession');
    expect(content).not.toContain('usePracticeAudioStream');
    expect(content).not.toContain('WebSocket');
  });
});
