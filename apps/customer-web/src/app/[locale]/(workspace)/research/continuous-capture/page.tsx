import { notFound } from 'next/navigation';
import ResearchContinuousCaptureClient from './research-continuous-capture-client';

export default function ResearchContinuousCapturePage() {
  if (process.env.RESEARCH_CAPTURE_HARNESS_ENABLED !== '1') notFound();
  return <ResearchContinuousCaptureClient />;
}
