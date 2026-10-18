/** Accept either decimal separator, independent of the current UI language. */
export function parseWorkHours(value: string): number | null {
  const input = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(input)) return null;
  const hours = Number(input.replace(',', '.'));
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : null;
}
