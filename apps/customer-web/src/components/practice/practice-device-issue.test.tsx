// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '../../../messages/en/practice.json';
import { PracticeDeviceIssue } from './practice-device-issue';
import type { PracticeDeviceIssue as DeviceIssue } from '@/lib/practice/device/device-contract';

afterEach(cleanup);
for (const resource of ['inputMicrophone', 'recordingMicrophone', 'camera', 'midi'] as const) {
  for (const condition of ['INTERRUPTED', 'LOST', 'PERMISSION_DENIED', 'NOT_FOUND', 'BUSY', 'UNAVAILABLE'] as const) {
    it(`${resource} / ${condition} exposes only the relevant page-device recovery action`, () => {
      const onReconnect = vi.fn(), onConfigure = vi.fn();
      const issue: DeviceIssue = { resource, phase: condition === 'INTERRUPTED' || condition === 'LOST' ? 'RUNTIME' : 'OPEN', condition };
      render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeDeviceIssue {...{ issue, onReconnect, onConfigure }} />
      </NextIntlClientProvider>);
      expect(screen.getByRole('status')).toHaveTextContent(messages[`deviceResource_${resource}`]);
      if (condition === 'INTERRUPTED') expect(screen.queryAllByRole('button')).toHaveLength(0);
      else {
        fireEvent.click(screen.getByRole('button', { name: condition === 'LOST' ? messages.deviceReconnect : messages.deviceRetry }));
        expect(onReconnect).toHaveBeenCalledOnce(); expect(onConfigure).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: messages.setupChangeConfiguration }));
        expect(onConfigure).toHaveBeenCalledOnce();
      }
    });
  }
}
