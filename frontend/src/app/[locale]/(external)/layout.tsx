import { ExternalViewerShell } from '@/components/external-viewer/external-viewer-shell';

export default function ExternalGroupLayout({ children }: { children: React.ReactNode }) {
  return <ExternalViewerShell>{children}</ExternalViewerShell>;
}
