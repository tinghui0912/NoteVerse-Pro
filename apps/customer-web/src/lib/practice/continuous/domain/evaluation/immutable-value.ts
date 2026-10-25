export function immutableContinuousValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) immutableContinuousValue(item);
    Object.freeze(value);
  }
  return value;
}
