import type { PracticeRequirement } from './requirements';
export type PracticeReadiness = Readonly<{
  status: 'UNCONFIGURED' | 'CHECKING' | 'READY' | 'BLOCKED';
  fingerprint: string | null;
  components: Readonly<Partial<Record<PracticeRequirement, 'CHECKING' | 'READY' | 'BLOCKED'>>>;
  reason: string | null;
  progress: number | null;
}>;
export const unconfiguredReadiness: PracticeReadiness = Object.freeze({
  status: 'UNCONFIGURED', fingerprint: null, components: Object.freeze({}), reason: null, progress: null,
});
