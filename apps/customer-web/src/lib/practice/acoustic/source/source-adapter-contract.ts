import { SOURCE_ADAPTER_CONTRACTS } from '../generated/runtime-contract';
import { fail } from '../errors';

export type SourceRate =
  (typeof SOURCE_ADAPTER_CONTRACTS)[keyof typeof SOURCE_ADAPTER_CONTRACTS]['sourceRateHz'];
export function sourceRate(value: number): SourceRate {
  const entry = Object.values(SOURCE_ADAPTER_CONTRACTS).find(
    (contract) => contract.sourceRateHz === value,
  );
  if (!entry) fail('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
  return entry.sourceRateHz;
}
export function sourceAdapterContract(rate: SourceRate) {
  return SOURCE_ADAPTER_CONTRACTS[
    String(rate) as keyof typeof SOURCE_ADAPTER_CONTRACTS
  ];
}
