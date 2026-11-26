// 活動的報名時間以 datetime-local（未帶時區）儲存，代表臺灣時間
export function parseTaipeiDateTime(value: string | null | undefined): number {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const normalized = raw.replace(' ', 'T');
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00` : normalized;
  return Date.parse(hasTimezone ? withTime : `${withTime}+08:00`);
}
