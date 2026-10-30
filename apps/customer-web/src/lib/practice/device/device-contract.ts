import type { PracticeLiveRoot } from '@/lib/practice/planning/resource-plan';

export type PracticeDeviceRoots = Readonly<{
  [Root in PracticeLiveRoot]: Root extends 'midi' ? MIDIAccess | null : MediaStream | null;
}>;
export type PracticeDeviceHealth = 'HEALTHY' | 'INTERRUPTED' | 'LOST';
export type PracticeDeviceIssue = Readonly<{
  resource: PracticeLiveRoot;
  phase: 'OPEN' | 'RUNTIME';
  condition: 'INTERRUPTED' | 'LOST' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'BUSY' | 'UNAVAILABLE';
}>;
