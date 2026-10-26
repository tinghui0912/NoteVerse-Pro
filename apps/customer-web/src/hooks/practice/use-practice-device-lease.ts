'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { PracticeDeviceLease } from '@/lib/practice/device/practice-device-lease';
import type { PracticeDeviceConfiguration } from '@/lib/practice/device/device-contract';

/** Mounted only on the exact execution route, never the shared Practice layout. */
export function usePracticeDeviceLease(configuration: PracticeDeviceConfiguration, enabled: boolean) {
  const lease = useRef<PracticeDeviceLease | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<PracticeDeviceLease['snapshot']> | null>(null);
  const { mode, inputSource, recordingMode } = configuration;
  useEffect(() => {
    if (!enabled) return;
    const owner = new PracticeDeviceLease({ mode, inputSource, recordingMode });
    lease.current = owner;
    const unsubscribe = owner.subscribe(() => { if (lease.current === owner) setSnapshot(owner.snapshot()); });
    queueMicrotask(() => { if (lease.current === owner) void owner.open().catch(() => {}); });
    return () => { lease.current = null; unsubscribe(); owner.close(); };
  }, [enabled, mode, inputSource, recordingMode]);
  const renewFailed = useCallback(async () => {
    const owner = lease.current;
    if (!owner) return false;
    try { await owner.renewFailed(); return lease.current === owner && owner.snapshot().state === 'READY'; }
    catch { return false; } // Recovery stays with the page-scoped lease, independently of qualification.
  }, []);
  const observe = useCallback((listener: () => void) => lease.current?.subscribe(listener) ?? (() => {}), []);
  const borrow = useCallback(() => { const current = lease.current?.snapshot();
    return current?.state === 'READY' && Object.values(current.health).every(health => health === 'HEALTHY') ? current.roots : null; }, []);
  return { snapshot, renewFailed, observe, borrow };
}
