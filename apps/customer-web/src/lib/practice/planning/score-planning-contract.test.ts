import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PracticeScoreArtifact } from '../kernel/artifact';
import { resolvePracticeScope, type PracticeScope } from '../kernel/scope';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '../kernel/tempo';

type Case = { name: string; score: Pick<PracticeScoreArtifact, 'moments' | 'scoreEndBeat' | 'scoreTempoSegments'>;
  scope: PracticeScope; tempoSelection: PracticeTempoSelection; error?: 'scope' | 'tempo_selection'; expected?: unknown };
const cases: Case[] = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../contracts/practice/score-planning-cases.json'), 'utf8')).cases;

describe('shared server/browser score planning contract', () => {
  it.each(cases)('$name', row => {
    const artifact = row.score as PracticeScoreArtifact;
    const resolve = () => {
      const scope = resolvePracticeScope(artifact, row.scope);
      const projection = scope.kind === 'FULL' ? { kind: scope.kind, startBeat: scope.startBeat, terminalBeat: scope.terminalBeat }
        : { kind: scope.kind, startBeat: scope.startBeat, terminalBeat: scope.terminalBeat, startGroupId: scope.startGroupId, endGroupId: scope.endGroupId };
      return { scope: projection, tempoPlan: resolvePracticeTempoPlan(artifact, row.tempoSelection) };
    };
    if (row.error) expect(resolve).toThrow();
    else expect(resolve()).toEqual(row.expected);
  });
});
