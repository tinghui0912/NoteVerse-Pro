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

export type PracticeRootHealthSnapshot = Readonly<{
  health: Readonly<Partial<Record<PracticeLiveRoot, PracticeDeviceHealth>>>;
}>;
/** subscribe registers first and synchronously delivers current facts, closing the snapshot/subscribe gap. */
export type PracticeRootHealthPort = Readonly<{
  snapshot(): PracticeRootHealthSnapshot;
  subscribe(listener: (snapshot: PracticeRootHealthSnapshot) => void): () => void;
}>;
