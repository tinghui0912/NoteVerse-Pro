import type { PracticeDeviceHealth, PracticeRootHealthPort, PracticeRootHealthSnapshot } from '../device/device-contract';
import type { PracticeLiveRoot } from '../planning/resource-plan';

/** Explicit normalized physical facts for application tests; no browser observation. */
export function rootHealthFixture(initial: Partial<Record<PracticeLiveRoot, PracticeDeviceHealth>> = {}) {
  let snapshot: PracticeRootHealthSnapshot = Object.freeze({ health: Object.freeze({
    inputMicrophone: 'HEALTHY', recordingMicrophone: 'HEALTHY', camera: 'HEALTHY', midi: 'HEALTHY', ...initial,
  }) });
  const listeners = new Set<(snapshot: PracticeRootHealthSnapshot) => void>();
  const port: PracticeRootHealthPort = Object.freeze({ snapshot: () => snapshot,
    subscribe: (listener: (snapshot: PracticeRootHealthSnapshot) => void) => {
      listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); };
    } });
  return { port, set(root: PracticeLiveRoot, health: PracticeDeviceHealth) {
    snapshot = Object.freeze({ health: Object.freeze({ ...snapshot.health, [root]: health }) });
    for (const listener of [...listeners]) listener(snapshot);
  }, listenerCount: () => listeners.size };
}
