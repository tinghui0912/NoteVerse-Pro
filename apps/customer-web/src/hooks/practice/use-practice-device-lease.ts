'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { PracticeDeviceLease } from '@/lib/practice/device/practice-device-lease';
import type { PracticeRootHealthPort, PracticeRootHealthSnapshot } from '@/lib/practice/device/device-contract';
import type { PracticeResourcePlan } from '@/lib/practice/planning/resource-plan';

/** Mounted only on the exact execution route, never the shared Practice layout. */
export function usePracticeDeviceLease(resources: PracticeResourcePlan | null, enabled: boolean) {
  const lease = useRef<PracticeDeviceLease | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<PracticeDeviceLease['snapshot']> | null>(null);
  useEffect(() => {
    if (!enabled || !resources) return;
    const owner = new PracticeDeviceLease(resources);
    lease.current = owner;
    const unsubscribe = owner.subscribe(() => { if (lease.current === owner) setSnapshot(owner.snapshot()); });
    queueMicrotask(() => { if (lease.current === owner) void owner.open().catch(() => {}); });
    return () => { lease.current = null; unsubscribe(); owner.close(); };
  }, [enabled, resources]);
  const healthSnapshot = useCallback((): PracticeRootHealthSnapshot =>
    lease.current?.rootHealth.snapshot() ?? Object.freeze({ health: Object.freeze({}) }), []);
  const subscribeHealth = useCallback<PracticeRootHealthPort['subscribe']>(listener => {
    const owner = lease.current;
    if (!owner) throw new Error('PRACTICE_DEVICE_UNAVAILABLE');
    return owner.rootHealth.subscribe(listener);
  }, []);
  const rootHealth = useMemo<PracticeRootHealthPort>(() => ({
    snapshot: healthSnapshot, subscribe: subscribeHealth,
  }), [healthSnapshot, subscribeHealth]);
  const borrow = useCallback(() => { const current = lease.current?.snapshot();
    return current?.state === 'READY' && Object.values(current.health).every(health => health === 'HEALTHY') ? current.roots : null; }, []);
  return { snapshot, rootHealth, borrow };
}
