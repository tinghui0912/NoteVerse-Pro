import type {
  NormalizedClientError,
  ObservabilityContext,
  ObservabilityPrimitive,
  ObservabilitySink,
} from './types';

let activeSink: ObservabilitySink | null = null;

const SENSITIVE_KEY_PATTERN = /(password|token|secret|cookie|musicxml|xml|content|body|file|image|audio)/i;

function normalizePrimitive(value: ObservabilityPrimitive): ObservabilityPrimitive {
  if (typeof value === 'string' && value.length > 300) {
    return `${value.slice(0, 300)}...`;
  }
  return value;
}

function sanitizeContext(context: ObservabilityContext): ObservabilityContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '[redacted]'];
      }
      if (Array.isArray(value)) {
        return [key, value.map(normalizePrimitive)];
      }
      return [key, normalizePrimitive(value)];
    })
  );
}

function normalizeError(error: unknown): NormalizedClientError {
  if (error instanceof Error) {
    const digest =
      'digest' in error && typeof error.digest === 'string' ? error.digest : undefined;
    const requestId =
      'requestId' in error && typeof error.requestId === 'string'
        ? error.requestId
        : 'request_id' in error && typeof error.request_id === 'string'
          ? error.request_id
          : undefined;
    return {
      name: error.name || 'Error',
      message: error.message,
      stack: error.stack,
      digest,
      request_id: requestId,
    };
  }

  return {
    name: 'NonErrorThrown',
    message: typeof error === 'string' ? error : 'A non-Error value was thrown.',
  };
}

export function configureObservabilitySink(sink: ObservabilitySink | null): void {
  activeSink = sink;
}

export function reportClientError(
  error: unknown,
  context: ObservabilityContext = {}
): void {
  activeSink?.captureError(normalizeError(error), sanitizeContext(context));
}

export function reportUnexpectedClientError(
  error: unknown,
  context: ObservabilityContext = {}
): void {
  if (error instanceof Error) {
    if (['AbortError', 'ApiError', 'UserFacingUploadError'].includes(error.name)) {
      return;
    }
    if (['FILE_NOT_FOUND', 'practice_realtime_audio_unsupported'].includes(error.message)) {
      return;
    }
  }

  reportClientError(error, context);
}

export function reportClientEvent(
  event: string,
  context: ObservabilityContext = {}
): void {
  activeSink?.captureEvent(event, sanitizeContext(context));
}

export function reportClientPerformance(
  metric: string,
  value: number,
  context: ObservabilityContext = {}
): void {
  activeSink?.capturePerformance(metric, value, sanitizeContext(context));
}
