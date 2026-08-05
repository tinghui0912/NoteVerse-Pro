export type ObservabilityPrimitive = string | number | boolean | null | undefined;

export type ObservabilityContext = Record<
  string,
  ObservabilityPrimitive | ObservabilityPrimitive[]
>;

export interface NormalizedClientError {
  name: string;
  message: string;
  stack?: string;
  digest?: string;
  request_id?: string;
}

export interface ObservabilitySink {
  captureError(error: NormalizedClientError, context: ObservabilityContext): void;
  captureEvent(event: string, context: ObservabilityContext): void;
  capturePerformance(metric: string, value: number, context: ObservabilityContext): void;
}
