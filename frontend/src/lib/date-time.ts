export function parseApiDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

export function formatApiDateTime(value: string | null | undefined, _locale?: string) {
  const date = parseApiDate(value);
  if (!date) return '-';
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-') + ` ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}
