import { ExternalViewerShell } from '@/components/shell';

export default function ExternalGroupLayout({ children }: { children: React.ReactNode }) {
  return <ExternalViewerShell>{children}</ExternalViewerShell>;
}
