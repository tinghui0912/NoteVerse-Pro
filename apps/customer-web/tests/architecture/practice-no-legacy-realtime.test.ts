import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"].*practice\/protocol['"]/,
  /from\s+['"].*practice\/session-policy['"]/,
  /from\s+['"].*practice-types['"]/,
  /from\s+['"].*use-practice-socket['"]/,
  /from\s+['"].*use-practice-session['"]/,
  /from\s+['"].*use-practice-audio-stream['"]/,
  /from\s+['"].*use-practice-midi-stream['"]/,
  /from\s+['"].*use-practice-targets['"]/,
  /from\s+['"].*practice\/audio-stream['"]/,
  /from\s+['"].*follow-controller['"]/,
  /practice-pcm-processor\.js/,
];

const FORBIDDEN_TOKEN_PATTERNS = [
  /routeWebSocket\(/,
  /PRACTICE_WEBSOCKET_PROTOCOL_VERSION/,
  /['"]client\.init['"]/,
  /['"]client\.midi_event['"]/,
  /['"]alignment\.update['"]/,
  /['"]performance\.clock_sync['"]/,
  /\bPracticeConnectionStatus\b/,
];

function getSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next' && entry !== 'generated') {
        files.push(...getSourceFiles(fullPath));
      }
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !fullPath.includes('tests/architecture')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architecture Guard: No Legacy Practice Realtime Files, Imports, or Protocols', () => {
  const srcDir = resolve(__dirname, '../../src');
  const e2eDir = resolve(__dirname, '../e2e');
  const allFiles = [...getSourceFiles(srcDir), ...getSourceFiles(e2eDir)];

  it('ensures no customer-web source or E2E files import legacy realtime practice modules', () => {
    const violations: { file: string; pattern: string; line: string }[] = [];

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: file.replace(resolve(__dirname, '../..'), ''),
              pattern: pattern.toString(),
              line: line.trim(),
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ensures no customer-web source or E2E files use legacy realtime protocol tokens', () => {
    const violations: { file: string; pattern: string; line: string }[] = [];

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        for (const pattern of FORBIDDEN_TOKEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: file.replace(resolve(__dirname, '../..'), ''),
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

  it('ensures speedRatio is completely purged from active local practice core and hooks', () => {
    const localCoreDir = join(srcDir, 'lib/practice/local-core');
    const coreFiles = getSourceFiles(localCoreDir).filter(
      (f) => !f.includes('.test.') && !f.includes('__fixtures__')
    );
    const hookFile = join(srcDir, 'hooks/practice/use-local-practice.ts');
    const filesToCheck = [...coreFiles, hookFile];

    const violations: { file: string; line: string }[] = [];
    for (const file of filesToCheck) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (/\bspeedRatio\b/.test(line)) {
          violations.push({
            file: file.replace(resolve(__dirname, '../..'), ''),
            line: line.trim(),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ensures PracticeScoreArtifact uses schemaVersion 1 and scoreTempoSegments', () => {
    const artifactFile = join(srcDir, 'lib/practice/local-core/artifact.ts');
    const content = readFileSync(artifactFile, 'utf-8');

    expect(content).toContain('PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1');
    expect(content).not.toContain('PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 2');
    expect(content).toContain('scoreTempoSegments: TempoSegment[]');
    expect(content).not.toMatch(/\btempoSegments\s*:\s*TempoSegment\[\]/);
  });

  it('ensures DEFAULT_PERFORMANCE_TEMPO_BPM (120 legacy fallback) is never used in local practice', () => {
    const localPracticeDir = join(srcDir, 'lib/practice');
    const files = getSourceFiles(localPracticeDir).filter(
      (f) => !f.includes('.test.') && !f.includes('__fixtures__')
    );
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toContain('DEFAULT_PERFORMANCE_TEMPO_BPM');
    }
  });
});
