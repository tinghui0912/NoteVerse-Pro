const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1
  );
  const value = bytes / 1024 ** exponent;
  const maximumFractionDigits = exponent === 0 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toLocaleString(undefined, { maximumFractionDigits })} ${UNITS[exponent]}`;
}
