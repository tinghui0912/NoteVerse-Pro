import { createStepExecutionSession } from '@/lib/practice/step/step-execution-session';
import { createContinuousExecutionSession } from '@/lib/practice/continuous/continuous-execution-session';
import type { PracticeExecutionSessionFactory } from './execution-session';

/** The browser's cross-mode composition bridge; each adapter owns its concrete platform. */
export const browserExecutionSessionFactory: PracticeExecutionSessionFactory = request =>
  request.plan.mode === 'STEP_BY_STEP'
    ? createStepExecutionSession({ ...request, plan: request.plan })
    : createContinuousExecutionSession({ ...request, plan: request.plan });
