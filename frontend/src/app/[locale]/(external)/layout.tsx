import { ExternalViewerShell } from '@/components/shell/external-viewer-shell';

export default function ExternalGroupLayout({ children }: { children: React.ReactNode }) {
  return <ExternalViewerShell>{children}</ExternalViewerShell>;
}
