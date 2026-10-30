'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { PracticeDeviceLease } from '@/lib/practice/device/practice-device-lease';
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
  const observe = useCallback((listener: () => void) => lease.current?.subscribe(listener) ?? (() => {}), []);
  const borrow = useCallback(() => { const current = lease.current?.snapshot();
    return current?.state === 'READY' && Object.values(current.health).every(health => health === 'HEALTHY') ? current.roots : null; }, []);
  return { snapshot, observe, borrow };
}
